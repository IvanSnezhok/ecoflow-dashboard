"""Turn decoded EcoFlow BLE heartbeat packets into a cloud-style quota dict.

The legacy DELTA Pro sends the same fixed-layout heartbeat structs over BLE that the
cloud flattens into `/quota/all` (`pd.wattsInSum`, `ems.maxChargeSoc`, ...). eflib
keeps each field's original firmware name in its annotation, so the dashboard can
consume BLE data with the exact keys it already reads from the cloud.
"""

import dataclasses
import math
from functools import cache
from inspect import get_annotations
from typing import Annotated, Any, get_args, get_origin

# eflib message class -> quota key prefix used by the cloud API
MODULE_PREFIX = {
    "DirectPdHeartbeatPack": "pd",
    "DirectEmsDeltaHeartbeatPack": "ems",
    "DirectInvDeltaHeartbeatPack": "inv",
    "DirectInvDeltaProHeartbeatPack": "inv",
    "DirectMpptHeartbeatPack": "mppt",
    "DirectBmsMDeltaHeartbeatPack": "bmsMaster",
}

# Extra battery slots reported by AllKitDetailData, in kit_base_info order
EXTRA_BATTERY_PREFIXES = ("bmsSlave1", "bmsSlave2")


def _camel(name: str) -> str:
    head, *rest = name.rstrip("_").split("_")
    return head + "".join(part.capitalize() for part in rest)


@cache
def original_names(cls: type) -> dict[str, str]:
    """Python attribute name -> firmware field name, including inherited fields."""
    names: dict[str, str] = {}
    for klass in reversed(cls.__mro__):
        for attr, annotation in get_annotations(klass).items():
            if get_origin(annotation) is not Annotated:
                continue
            metadata = get_args(annotation)[1:]
            names[attr] = metadata[1] if len(metadata) >= 2 else _camel(attr)
    return names


def _value(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else round(value, 3)
    # 4-byte fields (errCode, sysVer, wifiVer) are little-endian integers on the wire;
    # the cloud reports the same value as a plain number.
    if isinstance(value, (bytes, bytearray)) and 0 < len(value) <= 4:
        return int.from_bytes(value, "little")
    return None


def message_to_quota(msg: Any) -> dict[str, int | float]:
    prefix = MODULE_PREFIX.get(type(msg).__name__)
    if prefix is None or not dataclasses.is_dataclass(msg):
        return {}

    names = original_names(type(msg))
    quota: dict[str, int | float] = {}
    for field in dataclasses.fields(msg):
        value = _value(getattr(msg, field.name))
        if value is not None and field.name in names:
            quota[f"{prefix}.{names[field.name]}"] = value
    return quota


def kit_to_quota(kit: Any) -> dict[str, int | float | str]:
    """Extra batteries: only SOC, serial and firmware travel in the kit packet."""
    quota: dict[str, int | float | str] = {}
    for prefix, info in zip(EXTRA_BATTERY_PREFIXES, getattr(kit, "kit_base_info", [])):
        if not info.avai_flag:
            continue
        soc = info.soc if info.soc is not None else info.f32_soc
        if soc is not None:
            quota[f"{prefix}.soc"] = round(soc)
        if info.f32_soc is not None:
            quota[f"{prefix}.f32ShowSoc"] = round(info.f32_soc, 2)
        if info.sn:
            sn = info.sn.strip(b"\x00").decode("ascii", "ignore")
            if sn:
                quota[f"{prefix}.packSn"] = sn
        if info.app_version:
            quota[f"{prefix}.sysVer"] = info.app_version
    return quota


def packet_to_quota(msg: Any) -> dict[str, int | float | str]:
    if type(msg).__name__ == "AllKitDetailData":
        return kit_to_quota(msg)
    return message_to_quota(msg)
