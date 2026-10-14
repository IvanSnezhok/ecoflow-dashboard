"""Run with eflib on the path: PYTHONPATH=<dir containing eflib> python -m unittest"""

import asyncio
import unittest

from aiohttp.test_utils import TestClient, TestServer

from eflib.model import (
    AllKitDetailData,
    DirectBmsMDeltaHeartbeatPack,
    DirectEmsDeltaHeartbeatPack,
    DirectInvDeltaHeartbeatPack,
    DirectPdHeartbeatPack,
)
from eflib.model.kit_info import KitBaseInfo

from bridge import Bridge, Config, Session, build_app
from quota import packet_to_quota


class QuotaTest(unittest.TestCase):
    def test_pd_uses_cloud_key_names_and_decodes_versions(self):
        msg = DirectPdHeartbeatPack(
            model=1, err_code=b"\x00\x00\x00\x00", sys_ver=bytes([0x9C, 0x00, 0x02, 0x01]),
            wifi_ver=bytes([2, 0, 3, 0]), soc=82, watts_out_sum=300, watts_in_sum=1200,
        )
        quota = packet_to_quota(msg)
        self.assertEqual(quota["pd.soc"], 82)
        self.assertEqual(quota["pd.wattsInSum"], 1200)
        self.assertEqual(quota["pd.wattsOutSum"], 300)
        # Same packed integer the cloud reports for firmware 1.2.0.156
        self.assertEqual(quota["pd.sysVer"], 16908444)
        self.assertEqual(quota["pd.wifiVer"], 196610)
        self.assertEqual(quota["pd.errCode"], 0)
        # Fields the packet did not carry are left out, not zeroed
        self.assertNotIn("pd.carWatts", quota)

    def test_inherited_fields_keep_their_prefix(self):
        msg = DirectInvDeltaHeartbeatPack(err_code=0, input_watts=1000, output_watts=250,
                                          out_temp=25, cfg_ac_enabled=1, cfg_slow_chg_watts=1800)
        quota = packet_to_quota(msg)
        self.assertEqual(quota["inv.inputWatts"], 1000)
        self.assertEqual(quota["inv.outputWatts"], 250)
        self.assertEqual(quota["inv.cfgAcEnabled"], 1)
        self.assertEqual(quota["inv.cfgSlowChgWatts"], 1800)
        self.assertEqual(quota["inv.outTemp"], 25)

    def test_ems_and_bms(self):
        ems = packet_to_quota(DirectEmsDeltaHeartbeatPack(max_charge_soc=90, min_dsg_soc=10,
                                                           f32_lcd_show_soc=81.5, ems_is_normal_flag=1))
        self.assertEqual(ems, {"ems.maxChargeSoc": 90, "ems.minDsgSoc": 10,
                               "ems.f32LcdShowSoc": 81.5, "ems.emsIsNormalFlag": 1})
        bms = packet_to_quota(DirectBmsMDeltaHeartbeatPack(type_=1, soc=80, vol=52000, temp=24, full_cap=80000))
        self.assertEqual(bms["bmsMaster.type"], 1)
        self.assertEqual(bms["bmsMaster.soc"], 80)
        self.assertEqual(bms["bmsMaster.vol"], 52000)
        self.assertEqual(bms["bmsMaster.fullCap"], 80000)

    def test_kit_maps_extra_batteries(self):
        kit = AllKitDetailData(protocol_version=1, available_data_len=0, support_kit_max_num=2)
        kit.kit_base_info = [
            KitBaseInfo(avai_flag=1, sn=b"E3EBZ5ZEA150101\x00", app_version=16778530, f32_soc=55.4, soc=55),
            KitBaseInfo(avai_flag=0, sn=b"\x00" * 16, f32_soc=0.0, soc=0),
        ]
        self.assertEqual(packet_to_quota(kit), {
            "bmsSlave1.soc": 55,
            "bmsSlave1.f32ShowSoc": 55.4,
            "bmsSlave1.packSn": "E3EBZ5ZEA150101",
            "bmsSlave1.sysVer": 16778530,
        })


class _State:
    authenticated = True
    value = "authenticated"


class FakeDevice:
    connection_state = _State()

    def __init__(self):
        self.calls = []

    async def enable_ac_ports(self, enabled):
        self.calls.append(("ac", enabled))

    async def set_battery_charge_limit_max(self, value):
        self.calls.append(("max", value))


class ApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.bridge = Bridge(Config.from_env())
        self.device = FakeDevice()
        session = Session(sn="DCEBZ5ZE1234567", device=self.device, state="authenticated")
        session.quota = {"pd.soc": 82}
        self.bridge.sessions[session.sn] = session
        self.client = TestClient(TestServer(build_app(self.bridge)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_status_lists_sessions_with_quota(self):
        body = await (await self.client.get("/status")).json()
        self.assertEqual(body["devices"][0]["sn"], "DCEBZ5ZE1234567")
        self.assertTrue(body["devices"][0]["authenticated"])
        self.assertEqual(body["devices"][0]["quota"], {"pd.soc": 82})

    async def test_commands_reach_the_device(self):
        resp = await self.client.post("/devices/dcebz5ze1234567/command", json={"type": "setAcOutput", "enabled": False})
        self.assertEqual(resp.status, 200)
        resp = await self.client.post("/devices/DCEBZ5ZE1234567/command", json={"type": "setMaxChargeSoc", "value": 90})
        self.assertEqual(resp.status, 200)
        self.assertEqual(self.device.calls, [("ac", False), ("max", 90)])

    async def test_command_errors(self):
        resp = await self.client.post("/devices/DCEBZ5ZE1234567/command", json={"type": "setDcOutput", "enabled": True})
        self.assertEqual(resp.status, 501)  # FakeDevice has no DC method
        resp = await self.client.post("/devices/DCEBZ5ZE1234567/command", json={"type": "nope"})
        self.assertEqual(resp.status, 400)
        resp = await self.client.post("/devices/UNKNOWN/command", json={"type": "setAcOutput", "enabled": True})
        self.assertEqual(resp.status, 404)
        self.bridge.sessions["DCEBZ5ZE1234567"].device = None
        resp = await self.client.post("/devices/DCEBZ5ZE1234567/command", json={"type": "setAcOutput", "enabled": True})
        self.assertEqual(resp.status, 409)

    async def test_pause_and_resume(self):
        body = await (await self.client.post("/devices/DCEBZ5ZE1234567/pause", json={"minutes": 10})).json()
        self.assertIsNotNone(self.bridge.sessions["DCEBZ5ZE1234567"].paused_until)
        self.assertIn("pausedUntil", body)
        await self.client.post("/devices/DCEBZ5ZE1234567/resume")
        self.assertIsNone(self.bridge.sessions["DCEBZ5ZE1234567"].paused_until)


class _FlowState:
    def __init__(self, value, authenticated):
        self.value = value
        self.authenticated = authenticated


class FlowDevice:
    """Authenticates, sends one PD heartbeat, then drops the link."""

    instances = []

    def __init__(self):
        self.connection_state = None
        self.disconnected = False
        FlowDevice.instances.append(self)

    def update_from_data(self, data, reset=False):
        pass

    def on_connection_state_change(self, listener):
        self.listener = listener

    def with_disabled_reconnect(self):
        return self

    def with_connection_options(self, options):
        return self

    async def connect(self, user_id=None):
        self.user_id = user_id
        self.connection_state = _FlowState("authenticated", True)
        self.listener(self.connection_state)

    async def wait_until_authenticated_or_error(self, raise_on_error=False):
        # The packet path the bridge wraps: eflib calls update_from_data per message
        self.update_from_data(DirectPdHeartbeatPack(soc=77, watts_in_sum=10))
        return self.connection_state

    async def disconnect(self):
        self.disconnected = True


class SupervisorTest(unittest.IsolatedAsyncioTestCase):
    async def test_session_lifecycle(self):
        import bridge as bridge_module

        bridge = Bridge(Config.from_env())
        bridge.user_id = "123"
        session = Session(sn="DCEBZ5ZE1234567", advertised_at=bridge_module.now_ms())
        bridge.adverts[session.sn] = (object(), object())
        original_new, original_unsupported = bridge_module.eflib.NewDevice, bridge_module.eflib.is_unsupported
        bridge_module.eflib.NewDevice = lambda *_: FlowDevice()
        bridge_module.eflib.is_unsupported = lambda _: False
        try:
            task = asyncio.create_task(bridge.supervise(session))
            await asyncio.sleep(0.1)
            # Authenticated, and the heartbeat landed in this session's quota
            self.assertIsNotNone(session.authenticated_since)
            self.assertEqual(session.quota["pd.soc"], 77)
            self.assertEqual(FlowDevice.instances[-1].user_id, "123")

            # The link drops: the session is torn down and an error recorded
            FlowDevice.instances[-1].connection_state = _FlowState("disconnected", False)
            await asyncio.sleep(2.2)
            self.assertIsNone(session.authenticated_since)
            self.assertIn("session ended", session.error)
            self.assertTrue(FlowDevice.instances[-1].disconnected)
            self.assertEqual(session.state, "reconnecting")
            # Last known values stay available, with their timestamp
            self.assertEqual(session.quota["pd.soc"], 77)
            task.cancel()
        finally:
            bridge_module.eflib.NewDevice, bridge_module.eflib.is_unsupported = original_new, original_unsupported


if __name__ == "__main__":
    unittest.main()
