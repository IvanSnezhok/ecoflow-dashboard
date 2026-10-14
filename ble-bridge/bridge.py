"""EcoFlow BLE bridge for the dashboard.

Keeps a BLE session to each nearby EcoFlow device (via eflib from rabits/ha-ef-ble)
and serves the decoded data as a cloud-style quota over a small HTTP API, so the
dashboard can keep working when the device's Wi-Fi/cloud link drops.

The device accepts one BLE connection at a time: while the bridge holds it, the
EcoFlow phone app cannot connect over Bluetooth. `POST /devices/{sn}/pause` frees it.
"""

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web
from bleak import BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData

import eflib
from eflib.connection import Connection
from eflib.login import EcoFlowLogin

from quota import packet_to_quota

log = logging.getLogger("ble-bridge")

ADVERT_TTL_S = 120  # an advertisement older than this is not trusted for connecting
STALE_PACKET_S = 60  # reconnect when an authenticated session goes silent this long
MAX_BACKOFF_S = 60


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Config:
    user_id: str | None
    email: str | None
    password: str | None
    region: str
    allowed_sns: set[str]
    adapter: str | None
    host: str
    port: int
    connect_timeout: int
    data_dir: Path

    @classmethod
    def from_env(cls) -> "Config":
        sns = os.environ.get("ECOFLOW_BLE_DEVICES", "")
        return cls(
            user_id=os.environ.get("ECOFLOW_BLE_USER_ID", "").strip() or None,
            email=os.environ.get("ECOFLOW_BLE_EMAIL", "").strip() or None,
            password=os.environ.get("ECOFLOW_BLE_PASSWORD") or None,
            region=os.environ.get("ECOFLOW_BLE_REGION", "auto"),
            allowed_sns={s.strip().upper() for s in sns.split(",") if s.strip()},
            adapter=os.environ.get("ECOFLOW_BLE_ADAPTER") or None,
            host=os.environ.get("BRIDGE_HOST", "0.0.0.0"),
            port=int(os.environ.get("BRIDGE_PORT", "8765")),
            connect_timeout=int(os.environ.get("ECOFLOW_BLE_CONNECT_TIMEOUT", "30")),
            data_dir=Path(os.environ.get("BRIDGE_DATA_DIR", "/data")),
        )


@dataclass
class Session:
    sn: str
    name: str | None = None
    address: str | None = None
    rssi: int | None = None
    advertised_at: int | None = None
    state: str = "searching"
    supported: bool = True
    authenticated_since: int | None = None
    last_packet_at: int | None = None
    error: str | None = None
    paused_until: int | None = None
    sessions_started: int = 0
    quota: dict[str, Any] = field(default_factory=dict)
    quota_updated_at: int | None = None
    device: Any = None  # eflib.DeviceBase while a session is open
    wake: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def authenticated(self) -> bool:
        state = self.device.connection_state if self.device is not None else None
        return bool(state is not None and state.authenticated)

    def to_json(self) -> dict[str, Any]:
        return {
            "sn": self.sn,
            "name": self.name,
            "address": self.address,
            "rssi": self.rssi,
            "advertisedAt": self.advertised_at,
            "state": self.state,
            "supported": self.supported,
            "authenticated": self.authenticated,
            "authenticatedSince": self.authenticated_since,
            "lastPacketAt": self.last_packet_at,
            "error": self.error,
            "pausedUntil": self.paused_until,
            "sessionsStarted": self.sessions_started,
            "quota": self.quota,
            "quotaUpdatedAt": self.quota_updated_at,
        }


class Bridge:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.sessions: dict[str, Session] = {}
        self.adverts: dict[str, tuple[BLEDevice, AdvertisementData]] = {}
        self.tasks: dict[str, asyncio.Task] = {}
        self.user_id: str | None = config.user_id
        self.scanner_error: str | None = None
        self.scanning = False

    # ---------------------------------------------------------------- user id

    @property
    def _user_id_file(self) -> Path:
        return self.config.data_dir / "user_id"

    async def resolve_user_id(self) -> None:
        """The BLE login needs the numeric user ID of the account the device is bound to."""
        if self.user_id:
            return
        try:
            cached = self._user_id_file.read_text().strip()
            if cached:
                self.user_id = cached
                log.info("Using cached EcoFlow user ID")
                return
        except OSError:
            pass
        if not (self.config.email and self.config.password):
            log.error("Set ECOFLOW_BLE_USER_ID or ECOFLOW_BLE_EMAIL + ECOFLOW_BLE_PASSWORD")
            return

        # Retried until it works: the internet may be down when the bridge starts.
        delay = 10
        while not self.user_id:
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as http:
                    result = await EcoFlowLogin(http).login(
                        self.config.email, self.config.password, self.config.region
                    )
                if result.user_id:
                    self.user_id = str(result.user_id)
                    try:
                        self.config.data_dir.mkdir(parents=True, exist_ok=True)
                        self._user_id_file.write_text(self.user_id)
                    except OSError as exc:
                        log.warning("Could not cache user ID: %s", exc)
                    log.info("Resolved EcoFlow user ID from account login")
                    for session in self.sessions.values():
                        session.wake.set()
                    return
                log.error("EcoFlow login failed: %s", result.error)
            except Exception as exc:  # network errors while offline
                log.warning("EcoFlow login unavailable (%s), retrying in %ss", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 300)

    # ---------------------------------------------------------------- scanning

    def on_advertisement(self, device: BLEDevice, adv: AdvertisementData) -> None:
        raw_sn = eflib.sn_from_advertisement(adv)
        if raw_sn is None:
            return
        sn = raw_sn.decode("ascii", "ignore").upper()
        if not sn or (self.config.allowed_sns and sn not in self.config.allowed_sns):
            return

        self.adverts[sn] = (device, adv)
        session = self.sessions.get(sn)
        if session is None:
            session = self.sessions[sn] = Session(sn=sn)
            log.info("Found EcoFlow device %s at %s", sn, device.address)
        session.address = device.address
        session.name = device.name or session.name
        session.rssi = adv.rssi
        session.advertised_at = now_ms()
        session.wake.set()

        if sn not in self.tasks or self.tasks[sn].done():
            self.tasks[sn] = asyncio.create_task(self.supervise(session), name=f"ble-{sn}")

    async def scan_forever(self) -> None:
        kwargs = {"adapter": self.config.adapter} if self.config.adapter else {}
        while True:
            try:
                async with BleakScanner(detection_callback=self.on_advertisement, **kwargs):
                    self.scanning = True
                    self.scanner_error = None
                    log.info("Scanning for EcoFlow devices")
                    while True:
                        await asyncio.sleep(3600)
            except Exception as exc:
                self.scanning = False
                self.scanner_error = str(exc) or type(exc).__name__
                if "AppArmor" in self.scanner_error:
                    self.scanner_error = (
                        "AppArmor blocks D-Bus for this container; add "
                        "`security_opt: [apparmor:unconfined]` to ble-bridge in compose.yaml. "
                        + self.scanner_error
                    )
                log.error("BLE scanner failed: %s; retrying in 15s", self.scanner_error)
                await asyncio.sleep(15)

    # ---------------------------------------------------------------- sessions

    async def _wait(self, session: Session, seconds: float) -> None:
        session.wake.clear()
        try:
            await asyncio.wait_for(session.wake.wait(), timeout=seconds)
        except TimeoutError:
            pass

    def _capture_packets(self, session: Session, device: Any) -> None:
        # Wrap the instance method that every decoded heartbeat passes through, so
        # each device's packets land in its own quota.
        original = device.update_from_data

        def update_from_data(data: Any, reset: bool = False) -> None:
            original(data, reset)
            values = packet_to_quota(data)
            stamp = now_ms()
            session.last_packet_at = stamp
            if values:
                session.quota.update(values)
                session.quota_updated_at = stamp

        device.update_from_data = update_from_data

    async def supervise(self, session: Session) -> None:
        failures = 0
        while True:
            if session.paused_until and session.paused_until > now_ms():
                session.state = "paused"
                await self._wait(session, (session.paused_until - now_ms()) / 1000)
                continue
            session.paused_until = None

            if not self.user_id:
                session.state = "waiting_for_user_id"
                await self._wait(session, 30)
                continue

            advert = self.adverts.get(session.sn)
            if advert is None or not session.advertised_at or now_ms() - session.advertised_at > ADVERT_TTL_S * 1000:
                session.state = "searching"
                await self._wait(session, 10)
                continue

            device = eflib.NewDevice(*advert)
            if device is None or eflib.is_unsupported(device):
                session.supported = False
                session.state = "unsupported"
                # Not _wait: every advertisement would wake it straight back up.
                await asyncio.sleep(600)
                continue

            session.supported = True
            session.device = device
            self._capture_packets(session, device)
            device.on_connection_state_change(lambda state: setattr(session, "state", state.value))
            clean = False
            try:
                session.state = "connecting"
                device.with_disabled_reconnect().with_connection_options(
                    Connection.Options(timeout=self.config.connect_timeout)
                )
                await device.connect(user_id=self.user_id)
                async with asyncio.timeout(self.config.connect_timeout + 10):
                    await device.wait_until_authenticated_or_error(raise_on_error=True)

                session.authenticated_since = now_ms()
                session.sessions_started += 1
                session.error = None
                failures = 0
                log.info("BLE session to %s authenticated", session.sn)

                while True:
                    await asyncio.sleep(2)
                    if session.paused_until and session.paused_until > now_ms():
                        clean = True
                        break
                    state = device.connection_state
                    if state is None or not state.authenticated:
                        raise ConnectionError(f"session ended ({state.value if state else 'closed'})")
                    if now_ms() - (session.last_packet_at or session.authenticated_since) > STALE_PACKET_S * 1000:
                        raise TimeoutError(f"no data for {STALE_PACKET_S}s")
            except Exception as exc:
                failures += 1
                session.error = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
                log.warning("BLE session to %s failed: %s", session.sn, session.error)
            finally:
                session.authenticated_since = None
                session.device = None
                try:
                    await asyncio.wait_for(device.disconnect(), timeout=15)
                except Exception:
                    pass

            if not clean:
                session.state = "reconnecting"
                await asyncio.sleep(min(MAX_BACKOFF_S, 5 * 2 ** min(failures - 1, 4)))

    # ---------------------------------------------------------------- commands

    async def run_command(self, session: Session, body: dict[str, Any]) -> None:
        device = session.device
        if device is None or not session.authenticated:
            raise web.HTTPConflict(text=json.dumps({"error": "BLE session is not authenticated"}),
                                   content_type="application/json")

        kind = body.get("type")
        calls = {
            "setAcOutput": ("enable_ac_ports", lambda: bool(body["enabled"])),
            "setDcOutput": ("enable_dc_12v_port", lambda: bool(body["enabled"])),
            "setMaxChargeSoc": ("set_battery_charge_limit_max", lambda: int(body["value"])),
            "setMinDischargeSoc": ("set_battery_charge_limit_min", lambda: int(body["value"])),
            "setAcChargingPower": ("set_ac_charging_speed", lambda: int(body["value"])),
        }
        if kind not in calls:
            raise web.HTTPBadRequest(text=json.dumps({"error": f"unknown command {kind!r}"}),
                                     content_type="application/json")
        method_name, arg = calls[kind]
        method = getattr(device, method_name, None)
        if method is None:
            raise web.HTTPNotImplemented(text=json.dumps({"error": f"{kind} is not supported over BLE for this model"}),
                                         content_type="application/json")
        try:
            value = arg()
        except (KeyError, TypeError, ValueError) as exc:
            raise web.HTTPBadRequest(text=json.dumps({"error": f"invalid payload: {exc}"}),
                                     content_type="application/json")
        async with asyncio.timeout(15):
            result = await method(value)
        if result is False:
            raise web.HTTPServiceUnavailable(text=json.dumps({"error": "device rejected the command"}),
                                             content_type="application/json")


# -------------------------------------------------------------------- HTTP API

def build_app(bridge: Bridge) -> web.Application:
    routes = web.RouteTableDef()

    def session_or_404(request: web.Request) -> Session:
        session = bridge.sessions.get(request.match_info["sn"].upper())
        if session is None:
            raise web.HTTPNotFound(text=json.dumps({"error": "device not seen over BLE"}),
                                   content_type="application/json")
        return session

    @routes.get("/health")
    async def health(_: web.Request) -> web.Response:
        return web.json_response({"ok": True, "scanning": bridge.scanning})

    @routes.get("/status")
    async def status(_: web.Request) -> web.Response:
        return web.json_response({
            "scanning": bridge.scanning,
            "scannerError": bridge.scanner_error,
            "userIdConfigured": bool(bridge.user_id),
            "now": now_ms(),
            "devices": [s.to_json() for s in bridge.sessions.values()],
        })

    @routes.post("/devices/{sn}/command")
    async def command(request: web.Request) -> web.Response:
        session = session_or_404(request)
        try:
            body = await request.json()
        except json.JSONDecodeError:
            raise web.HTTPBadRequest(text=json.dumps({"error": "body must be JSON"}),
                                     content_type="application/json")
        await bridge.run_command(session, body)
        return web.json_response({"ok": True})

    @routes.post("/devices/{sn}/pause")
    async def pause(request: web.Request) -> web.Response:
        session = session_or_404(request)
        body = await request.json() if request.can_read_body else {}
        minutes = max(1, min(int(body.get("minutes", 15)), 24 * 60))
        session.paused_until = now_ms() + minutes * 60_000
        session.wake.set()
        return web.json_response({"ok": True, "pausedUntil": session.paused_until})

    @routes.post("/devices/{sn}/resume")
    async def resume(request: web.Request) -> web.Response:
        session = session_or_404(request)
        session.paused_until = None
        session.wake.set()
        return web.json_response({"ok": True})

    app = web.Application()
    app.add_routes(routes)
    return app


async def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    config = Config.from_env()
    bridge = Bridge(config)

    runner = web.AppRunner(build_app(bridge))
    await runner.setup()
    await web.TCPSite(runner, config.host, config.port).start()
    log.info("BLE bridge API on %s:%s", config.host, config.port)

    await asyncio.gather(bridge.resolve_user_id(), bridge.scan_forever())


if __name__ == "__main__":
    asyncio.run(main())
