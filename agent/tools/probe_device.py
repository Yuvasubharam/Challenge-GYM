"""
Read-only health probe for the eSSL X990 over the LAN (TCP 4370).

Prints device identity, capacity/counts, and the Cloud Server (ADMS) settings so you can
see whether the device is pushing to the cloud worker. Never writes to the device and does
not call disable_device(), so members can keep punching during the probe.

Usage:  python probe_device.py [ip] [port]
"""
import json
import sys

from zk import ZK, const

IP = sys.argv[1] if len(sys.argv) > 1 else "192.168.0.215"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 4370

# Option keys used by ZKTeco/eSSL push firmware for the Cloud Server (ADMS) link.
ADMS_KEYS = [
    "ICLOCKSVRURL", "WebServerIP", "WebServerPort", "WebServerURL", "IclockSvrFun",
    "ServerPort", "CloudServerIP", "CloudServerPort", "IsSupportPush", "PushProtVer",
    "ProxyServerIP", "ProxyServerPort", "EnableProxyServer", "DNS", "GATEIPAddress",
    "IPAddress", "NetMask", "DeviceName", "~ZKFPVersion", "~DeviceName", "~Platform",
    "TZAdj", "LockFunOn", "~MaxUserCount", "~MaxFingerCount", "~MaxAttLogCount",
]


def read_option(conn, key: str):
    """CMD_OPTIONS_RRQ — the same call pyzk uses internally for serial/platform."""
    try:
        conn._ZK__send_command(const.CMD_OPTIONS_RRQ, key.encode() + b"\x00", 1024)
        data = conn._ZK__data
        if not data:
            return None
        val = data.split(b"=", 1)[-1].split(b"\x00")[0]
        return val.decode(errors="replace")
    except Exception as e:  # unsupported key
        return f"<err {e}>"


def main():
    zk = ZK(IP, port=PORT, timeout=10, password=0, force_udp=False, ommit_ping=True)
    conn = zk.connect()
    try:
        out = {
            "connected": f"{IP}:{PORT}",
            "serial": conn.get_serialnumber(),
            "platform": conn.get_platform(),
            "firmware": conn.get_firmware_version(),
            "device_name": conn.get_device_name(),
            "fp_version": conn.get_fp_version(),
            "face_version": conn.get_face_version(),
            "time": str(conn.get_time()),
        }
        conn.read_sizes()
        out["counts"] = {
            "users": conn.users, "fingers": conn.fingers, "records": conn.records,
            "users_cap": conn.users_cap, "fingers_cap": conn.fingers_cap, "rec_cap": conn.rec_cap,
            "faces": getattr(conn, "faces", None),
        }
        out["options"] = {k: read_option(conn, k) for k in ADMS_KEYS}

        users = conn.get_users()
        groups = {}
        privileged = []
        for u in users:
            groups[u.group_id or "(blank)"] = groups.get(u.group_id or "(blank)", 0) + 1
            if u.privilege != const.USER_DEFAULT:
                privileged.append(f"{u.user_id}:{u.name}")
        out["users_sample"] = [
            {"uid": u.uid, "user_id": u.user_id, "name": u.name, "group": u.group_id, "priv": u.privilege, "card": u.card}
            for u in users[-5:]
        ]
        out["group_distribution"] = groups
        out["admins_on_device"] = privileged
        out["non_numeric_ids"] = [u.user_id for u in users if not str(u.user_id).isdigit()][:40]
        print(json.dumps(out, indent=2, default=str))
    finally:
        conn.disconnect()


if __name__ == "__main__":
    main()
