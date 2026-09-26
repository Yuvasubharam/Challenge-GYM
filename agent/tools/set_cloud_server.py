"""
Point the eSSL X990 "Cloud Server" (ADMS) at a server — run from a PC on the gym LAN.

  python set_cloud_server.py show
  python set_cloud_server.py cloud challenge-gym-device.<sub>.workers.dev   # production (domain, port 80)
  python set_cloud_server.py lan 192.168.0.106 8790                         # local testing (IP mode)
  python set_cloud_server.py restore                                        # values saved before the first change

Verified on firmware Ver 6.60 / push 8.0.4.6: keys ICLOCKSVRURL, IclockSvrPort, WebServerURLModel
(1 = domain, 0 = IP), WebServerIP, WebServerPort; a restart is required to apply. In domain mode the
device must reach a DNS server — the gym unit had DNS 192.168.1.1 on the wrong subnet, so this
script sets DNS to the gateway (or 8.8.8.8) when switching to the cloud.

The restart takes the door scanner offline for ~45 seconds.
"""
import json
import os
import sys

from zk import ZK, const

DEVICE_IP = os.environ.get("DEVICE_IP", "192.168.0.215")
SAVE = os.path.join(os.path.dirname(__file__), "cloud_server_original.json")
KEYS = ["ICLOCKSVRURL", "IclockSvrPort", "WebServerURLModel", "WebServerIP", "WebServerPort", "IclockSvrFun", "DNS", "GATEIPAddress"]


def read(c, k):
    c._ZK__send_command(const.CMD_OPTIONS_RRQ, k.encode() + b"\x00", 1024)
    d = c._ZK__data
    return d.split(b"=", 1)[-1].split(b"\x00")[0].decode(errors="replace") if d else None


def write(c, k, v):
    ok = c._ZK__send_command(const.CMD_OPTIONS_WRQ, f"{k}={v}".encode() + b"\x00", 1024).get("status")
    print(f"  {k} = {v}  {'ok' if ok else 'FAILED'}")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    c = ZK(DEVICE_IP, port=4370, timeout=10, ommit_ping=True).connect()
    try:
        current = {k: read(c, k) for k in KEYS}
        print("current:", json.dumps(current, indent=2))
        if cmd == "show":
            return
        if not os.path.exists(SAVE):
            json.dump(current, open(SAVE, "w"), indent=2)
            print(f"saved original settings to {SAVE}")
        if cmd == "cloud":
            host = sys.argv[2]
            gw = current.get("GATEIPAddress") or "192.168.0.1"
            target = {"ICLOCKSVRURL": host, "IclockSvrPort": "80", "WebServerURLModel": "1", "IclockSvrFun": "1", "DNS": gw}
        elif cmd == "lan":
            ip, port = sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "8790"
            target = {"ICLOCKSVRURL": ip, "IclockSvrPort": port, "WebServerURLModel": "0", "WebServerIP": ip, "WebServerPort": port, "IclockSvrFun": "1"}
        elif cmd == "restore":
            target = {k: v for k, v in json.load(open(SAVE)).items() if v is not None}
        else:
            sys.exit(__doc__)
        print("writing:")
        for k, v in target.items():
            write(c, k, v)
        c._ZK__send_command(const.CMD_REFRESHOPTION)
        if input("Restart the device now to apply (door offline ~45s)? [y/N] ").strip().lower() == "y":
            c.restart()
            print("restart sent — the device will call the new server within a minute of booting")
        else:
            print("not restarted — settings apply on the next restart")
    finally:
        try:
            c.disconnect()
        except Exception:
            pass


if __name__ == "__main__":
    main()
