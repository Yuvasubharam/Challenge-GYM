"""
Challenge Gym — gym-PC bridge agent
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Runs on the front-desk PC (same LAN as the eSSL X990). Outbound HTTPS only —
no port forwarding, no public IP.

  • Executes queued device commands (block / unblock / add user …) over TCP 4370
    when the device is not reachable via ADMS, or faster than the ADMS poll.
  • Backs up fingerprint templates to the cloud so expired members can be removed
    from the device and restored on renewal without re-enrolling.
  • Uploads new punches from the device (backfill / ADMS outage safety net).
  • Mirrors the eTimeTrack Lite employee roster (read-only) for reconciliation.

Finds the X990 by itself: tries the last known IP, then scans the PC's local
network for port 4370 and checks the serial number. When the PC is not on the
gym network (e.g. a laptop at home) it waits quietly and syncs everything the
moment the device is reachable again. install_autostart.ps1 starts it at logon.

Config: agent/.env (see .env.example).  Run: python agent.py   (or --once for a single cycle)
"""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import logging
import os
import socket
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from logging.handlers import RotatingFileHandler
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

import requests
from zk import ZK, const
from zk.finger import Finger

# ── Config ──────────────────────────────────────────────────────────────
def load_env(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

load_env(Path(__file__).with_name(".env"))

CLOUD_URL = os.environ.get("CLOUD_URL", "http://127.0.0.1:8790").rstrip("/")
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "")
DEVICE_IP = os.environ.get("DEVICE_IP", "192.168.0.215")
DEVICE_PORT = int(os.environ.get("DEVICE_PORT", "4370"))
DEVICE_PASSWORD = int(os.environ.get("DEVICE_PASSWORD", "0"))
COMMAND_POLL_SEC = int(os.environ.get("COMMAND_POLL_SEC", "15"))
ATTENDANCE_EVERY_MIN = int(os.environ.get("ATTENDANCE_EVERY_MIN", "5"))
ROSTER_EVERY_MIN = int(os.environ.get("ROSTER_EVERY_MIN", "30"))
ROSTER_FORCE_HOURS = int(os.environ.get("ROSTER_FORCE_HOURS", "12"))  # upload an unchanged roster at least this often
ETTL_EVERY_MIN = int(os.environ.get("ETTL_EVERY_MIN", "60"))
ETTL_DB = os.environ.get("ETTL_DB", r"C:\Program Files (x86)\eSSL\eTimeTrackLite\eTimeTrackLite1.mdb")
BACKFILL_DAYS = int(os.environ.get("BACKFILL_DAYS", "3"))  # first run: how far back to upload punches

DEVICE_SN = os.environ.get("DEVICE_SN", "CUB7252100258")      # auto-discovery accepts only this device
AUTO_DISCOVER = os.environ.get("AUTO_DISCOVER", "1") != "0"
SCAN_EVERY_SEC = int(os.environ.get("SCAN_EVERY_SEC", "60"))   # how often to look while the device is away
SCAN_SUBNETS = [s.strip() for s in os.environ.get("SCAN_SUBNETS", "").split(",") if s.strip()]  # extra, e.g. 192.168.1.0/24
STATE_FILE = Path(__file__).with_name("agent_state.json")
VERSION = "1.1"

_handlers: list[logging.Handler] = [RotatingFileHandler(Path(__file__).with_name("agent.log"), maxBytes=2_000_000, backupCount=3, encoding="utf-8")]
if sys.stdout is not None and sys.stdout.isatty():  # pythonw (auto-start) has no console
    _handlers.append(logging.StreamHandler())
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", handlers=_handlers)
log = logging.getLogger("agent")


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(**kw):
    s = load_state()
    s.update(kw)
    try:
        STATE_FILE.write_text(json.dumps(s, indent=2), encoding="utf-8")
    except OSError:
        pass

session = requests.Session()
session.headers.update({"Authorization": f"Bearer {AGENT_TOKEN}", "User-Agent": "challenge-gym-agent/1.0"})


def api(path: str, body: dict | None = None, method: str = "POST") -> dict:
    r = session.request(method, f"{CLOUD_URL}/agent{path}", json=body if method != "GET" else None, timeout=30)
    r.raise_for_status()
    return r.json()


# ── Finding the device on the LAN ───────────────────────────────────────
class Net:
    """Where the device is right now. `ip` is None while it is not reachable from this PC."""
    ip: str | None = None
    sn: str | None = None
    status = "searching"          # connected | searching | not_found
    last_scan = 0.0
    scanned: list[str] = []


net = Net()


def local_networks() -> list[ipaddress.IPv4Network]:
    """/24 networks of this PC's private IPv4 addresses (+ SCAN_SUBNETS)."""
    ips: set[str] = set()
    try:  # primary interface (no packet is sent)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    nets: list[ipaddress.IPv4Network] = []
    for ip in ips:
        a = ipaddress.IPv4Address(ip)
        if a.is_private and not a.is_loopback and not a.is_link_local:
            n = ipaddress.IPv4Network(f"{ip}/24", strict=False)
            if n not in nets:
                nets.append(n)
    for extra in SCAN_SUBNETS:
        try:
            n = ipaddress.IPv4Network(extra, strict=False)
            if n.num_addresses <= 1024 and n not in nets:
                nets.append(n)
        except ValueError:
            log.warning("ignoring bad SCAN_SUBNETS entry %r", extra)
    return nets


def port_open(ip: str, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((ip, DEVICE_PORT), timeout=timeout):
            return True
    except OSError:
        return False


def serial_at(ip: str) -> str | None:
    """Serial number of the ZK device at ip, or None if it isn't one / is busy."""
    try:
        conn = ZK(ip, port=DEVICE_PORT, timeout=8, password=DEVICE_PASSWORD, force_udp=False, ommit_ping=True).connect()
        try:
            return str(conn.get_serialnumber()).strip()
        finally:
            conn.disconnect()
    except Exception:
        return None


def accept(ip: str, sn: str | None) -> bool:
    return bool(sn) and (not DEVICE_SN or sn == DEVICE_SN)


def locate_device(force_scan: bool = False) -> str | None:
    """Quick check of known IPs; full LAN scan at most every SCAN_EVERY_SEC."""
    known = [ip for ip in dict.fromkeys([net.ip, load_state().get("device_ip"), DEVICE_IP]) if ip]
    for ip in known:
        if port_open(ip, 1.0):
            sn = serial_at(ip)
            if accept(ip, sn):
                return found(ip, sn)
            if sn:
                log.info("ignoring other ZK device %s at %s (want %s)", sn, ip, DEVICE_SN)
    if not AUTO_DISCOVER:
        return lost()
    if not force_scan and time.time() - net.last_scan < SCAN_EVERY_SEC:
        return lost(scanned=False)
    nets = local_networks()
    net.last_scan = time.time()
    net.scanned = [str(n) for n in nets]
    hosts = [str(h) for n in nets for h in n.hosts() if str(h) not in known]
    if not hosts:
        return lost()
    with ThreadPoolExecutor(max_workers=128) as pool:
        candidates = [ip for ip, ok in zip(hosts, pool.map(port_open, hosts)) if ok]
    for ip in candidates:
        sn = serial_at(ip)
        if accept(ip, sn):
            return found(ip, sn)
        if sn:
            log.info("ignoring other ZK device %s at %s (want %s)", sn, ip, DEVICE_SN)
    return lost()


def found(ip: str, sn: str | None) -> str:
    if net.ip != ip or net.status != "connected":
        log.info("device %s found at %s", sn, ip)
    if load_state().get("device_ip") != ip:
        save_state(device_ip=ip, device_sn=sn)
    net.ip, net.sn, net.status = ip, sn, "connected"
    return ip


def lost(scanned: bool = True) -> None:
    was = net.status
    if was == "connected":
        log.warning("device no longer reachable — will keep looking every %ss", SCAN_EVERY_SEC)
    net.ip = None
    if scanned:
        net.status = "not_found"
        if was != "not_found":  # log once, not every minute
            log.info("device not on this network (scanned %s)", ", ".join(net.scanned) or "no private network")
    elif was == "connected":
        net.status = "searching"
    return None


# ── Device ──────────────────────────────────────────────────────────────
@contextmanager
def device(write: bool = False):
    """One TCP session. For writes the device keypad is paused briefly (disable_device)."""
    if not net.ip:
        raise ConnectionError("device not on this network")
    zk = ZK(net.ip, port=DEVICE_PORT, timeout=15, password=DEVICE_PASSWORD, force_udp=False, ommit_ping=True)
    conn = zk.connect()
    try:
        if write:
            conn.disable_device()
        yield conn
    finally:
        try:
            if write:
                conn.enable_device()
        finally:
            conn.disconnect()


def find_user(conn, pin: str, users=None):
    users = users if users is not None else conn.get_users()
    return next((u for u in users if str(u.user_id) == str(pin)), None), users


def read_templates(conn, user) -> list[dict]:
    out = []
    for fid in range(10):
        t = conn.get_user_template(uid=user.uid, temp_id=fid)
        if t and t.template:
            out.append({"fid": fid, "size": len(t.template), "valid": int(t.valid or 1),
                        "tmp": base64.b64encode(t.template).decode()})
    return out


def upsert_on_device(conn, pin: str, name: str, users=None):
    user, users = find_user(conn, pin, users)
    if user:
        conn.set_user(uid=user.uid, name=name[:24], privilege=user.privilege, password=user.password or "",
                      group_id=user.group_id or "", user_id=user.user_id, card=user.card or 0)
        return user.uid, users
    uid = max((u.uid for u in users), default=0) + 1
    conn.set_user(uid=uid, name=name[:24], privilege=const.USER_DEFAULT, password="", group_id="", user_id=pin, card=0)
    return uid, users


def execute(conn, cmd: dict, users) -> dict:
    action = cmd["action"]
    pin = cmd.get("essl_id") or (cmd.get("payload") or {}).get("pin_raw")  # pin_raw: junk PINs with spaces
    name = cmd.get("name") or pin

    if action in ("block", "delete_user"):
        user, users = find_user(conn, pin, users)
        if not user:
            return {"ok": True, "result": "not on device (already removed)", "method": "remove"}
        templates = read_templates(conn, user)
        # On this firmware group changes do NOT deny access, so blocking = backup + remove.
        conn.delete_user(uid=user.uid)
        return {"ok": True, "result": f"removed uid {user.uid}, {len(templates)} fingerprint(s) backed up",
                "templates": templates, "method": "remove"}

    if action in ("unblock", "upsert_user"):
        uid, users = upsert_on_device(conn, pin, name, users)
        restored = 0
        tpls = cmd.get("templates") or []
        if action == "unblock" and tpls:
            user, _ = find_user(conn, pin, conn.get_users())
            fingers = [Finger(uid=uid, fid=int(t["fid"]), valid=int(t.get("valid", 1)), template=base64.b64decode(t["tmp"])) for t in tpls]
            conn.save_user_template(user, fingers)
            restored = len(fingers)
        return {"ok": True, "result": f"user {pin} on device (uid {uid}), {restored} fingerprint(s) restored"}

    if action == "backup_templates":
        user, users = find_user(conn, pin, users)
        if not user:
            return {"ok": False, "result": "not on device"}
        tpls = read_templates(conn, user)
        return {"ok": True, "result": f"{len(tpls)} template(s) backed up", "templates": tpls}

    if action == "query_users":
        sync_roster(conn, force=True)
        return {"ok": True, "result": "roster uploaded"}

    if action == "reboot":
        conn.restart()
        return {"ok": True, "result": "restarting"}

    return {"ok": False, "result": f"action '{action}' not supported by agent"}


def process_commands() -> int:
    cmds = api("/commands/claim", {"max": 10}).get("commands", [])
    if not cmds:
        return 0
    log.info("claimed %d command(s)", len(cmds))
    try:
        with device(write=True) as conn:
            users = conn.get_users()
            for cmd in cmds:
                try:
                    res = execute(conn, cmd, users)
                    users = conn.get_users() if cmd["action"] in ("block", "unblock", "upsert_user", "delete_user") else users
                except Exception as e:  # one bad command must not stop the batch
                    log.exception("command %s failed", cmd["id"])
                    res = {"ok": False, "result": f"agent error: {e}"}
                api(f"/commands/{cmd['id']}/result", res)
                log.info("#%s %s %s → %s", cmd["id"], cmd["action"], cmd.get("essl_id"), res["result"])
    except Exception as e:
        # Device busy (eTimeTrack downloading) or offline: give the commands back.
        log.warning("device unavailable, requeueing %d command(s): %s", len(cmds), e)
        for cmd in cmds:
            try:
                api(f"/commands/{cmd['id']}/result", {"requeue": True, "result": f"device unavailable: {e}"})
            except Exception:
                pass
    return len(cmds)


# ── Periodic syncs ──────────────────────────────────────────────────────
def device_info(conn) -> dict:
    conn.read_sizes()
    return {"sn": conn.get_serialnumber(), "platform": conn.get_platform(), "firmware": conn.get_firmware_version(),
            "ip": net.ip, "users": conn.users, "fingers": conn.fingers, "records": conn.records}


def sync_roster(conn=None, force: bool = False):
    """Upload the full device user list + finger counts, and back up any missing templates."""
    def run(c):
        users = c.get_users()
        templates = c.get_templates()  # one bulk read of every fingerprint on the device
        by_uid = {u.uid: u for u in users}
        counts: dict[str, int] = {}
        for t in templates:
            u = by_uid.get(t.uid)
            if u:
                counts[str(u.user_id)] = counts.get(str(u.user_id), 0) + 1
        roster = [{"pin": str(u.user_id), "name": u.name, "privilege": u.privilege, "card": str(u.card or ""),
                   "group": u.group_id or "", "fingers": counts.get(str(u.user_id), 0)} for u in users]
        # Uploading ~700 users costs ~1,400 database writes: skip it when nothing changed,
        # but still refresh at least every ROSTER_FORCE_HOURS so the cloud copy can't drift.
        digest = hashlib.sha256(json.dumps(roster, sort_keys=True).encode()).hexdigest()
        st = load_state()
        if not force and st.get("roster_hash") == digest and time.time() - st.get("roster_at", 0) < ROSTER_FORCE_HOURS * 3600:
            log.info("roster unchanged (%d users) — skipped upload", len(users))
            return
        api("/device-users", {"complete": True, "users": roster})
        save_state(roster_hash=digest, roster_at=time.time())
        missing = set(api("/templates/missing", method="GET").get("pins", []))
        batch = []
        for t in templates:
            u = by_uid.get(t.uid)
            if u and str(u.user_id) in missing:
                batch.append({"pin": str(u.user_id), "fid": t.fid, "size": len(t.template), "valid": int(t.valid or 1),
                              "tmp": base64.b64encode(t.template).decode()})
            if len(batch) >= 50:
                api("/templates", {"templates": batch}); batch = []
        if batch:
            api("/templates", {"templates": batch})
        log.info("roster: %d users, %d templates on device, backed up templates for %d member(s)", len(users), len(templates), len(missing))

    if conn is not None:
        run(conn)
    else:
        with device() as c:
            run(c)


def sync_attendance(last_punch: str | None):
    since = None
    if last_punch:
        since = datetime.fromisoformat(last_punch[:19])
    else:
        since = datetime.now() - timedelta(days=BACKFILL_DAYS)
    with device() as conn:
        sn = conn.get_serialnumber()
        records = conn.get_attendance()
    new = [a for a in records if a.timestamp > since]
    for i in range(0, len(new), 500):
        chunk = new[i:i + 500]
        r = api("/attendance", {"sn": sn, "punches": [
            {"pin": str(a.user_id), "time": a.timestamp.strftime("%Y-%m-%d %H:%M:%S"), "status": a.status, "verify": a.punch}
            for a in chunk]})
        log.info("attendance: uploaded %d (inserted %s)", len(chunk), r.get("inserted"))


def sync_etimetrack():
    if not Path(ETTL_DB).exists():
        return
    try:
        import pyodbc
    except ImportError:
        log.warning("pyodbc not installed — skipping eTimeTrack sync")
        return
    cn = pyodbc.connect(rf"Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};Dbq={ETTL_DB};ReadOnly=1;", readonly=True)
    try:
        rows = cn.cursor().execute(
            "SELECT EmployeeCode, EmployeeName, Status, DOJ, ContactNo, EmployeeDeviceGroup FROM Employees WHERE RecordStatus=1").fetchall()
    finally:
        cn.close()
    emps = [{"code": str(r[0]), "name": r[1], "status": r[2], "doj": r[3].strftime("%Y-%m-%d") if r[3] else None,
             "contact": r[4], "device_group": str(r[5] or "")} for r in rows if r[0]]
    for i in range(0, len(emps), 500):
        api("/etimetrack", {"employees": emps[i:i + 500]})
    log.info("eTimeTrack: mirrored %d employees", len(emps))


# ── Main loop ───────────────────────────────────────────────────────────
def single_instance():
    """Auto-start + a manual run must not both talk to the device."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 47990))
        s.listen(1)
    except OSError:
        log.info("another agent is already running on this PC — exiting")
        sys.exit(0)
    return s  # keep a reference so the port stays held


def read_device() -> dict:
    """Connect to the known IP; if that fails (IP changed, PC moved), look for the device again."""
    if net.ip:
        try:
            with device() as conn:
                return device_info(conn)
        except Exception as e:
            log.info("device at %s did not answer (%s) — searching", net.ip, e)
            net.ip = None
    if locate_device():
        try:
            with device() as conn:
                return device_info(conn)
        except Exception as e:  # e.g. eTimeTrack is downloading and the device is busy
            log.info("device found but busy: %s", e)
            return {"error": str(e)}
    return {}


def main(once: bool = False):
    if not AGENT_TOKEN:
        sys.exit("AGENT_TOKEN missing — set it in agent/.env")
    _lock = single_instance()
    log.info("agent %s starting → cloud %s, device serial %s (auto-discover %s)", VERSION, CLOUD_URL, DEVICE_SN, "on" if AUTO_DISCOVER else "off")
    next_att = next_roster = next_ettl = 0.0
    connected_before = False
    cloud_ok = True
    net.last_scan = -SCAN_EVERY_SEC  # scan immediately on start
    while True:
        now = time.time()
        info = read_device()
        connected = net.status == "connected" and "sn" in info
        if connected and not connected_before:
            log.info("device on the network — running a full sync now")
            next_att = next_roster = 0.0
        connected_before = connected

        try:
            hb = api("/heartbeat", {"device": info if connected else None, "agent": {
                "version": VERSION, "host": os.environ.get("COMPUTERNAME"), "device_status": net.status if not connected else "connected",
                "device_ip": net.ip, "scanned": net.scanned, "error": info.get("error")}})
            if not cloud_ok:
                log.info("cloud reachable again")
            cloud_ok = True
        except Exception as e:
            if cloud_ok:
                log.warning("cloud not reachable (%s) — will retry", e)
            cloud_ok = False
            hb = None

        if hb is not None:
            if connected:
                try:
                    process_commands()
                except Exception as e:
                    log.error("commands failed: %s", e)
                if now >= next_roster:
                    try:
                        sync_roster(); next_roster = now + ROSTER_EVERY_MIN * 60
                    except Exception as e:
                        log.error("roster sync failed: %s", e); next_roster = now + 60
                if now >= next_att:
                    try:
                        sync_attendance(hb.get("last_punch")); next_att = now + ATTENDANCE_EVERY_MIN * 60
                    except Exception as e:
                        log.error("attendance sync failed: %s", e); next_att = now + 60
            if now >= next_ettl:  # local .mdb file — works even while the device is away
                try:
                    sync_etimetrack()
                except Exception as e:
                    log.error("eTimeTrack sync failed: %s", e)
                next_ettl = now + ETTL_EVERY_MIN * 60
        if once:
            return
        time.sleep(COMMAND_POLL_SEC)


if __name__ == "__main__":
    main(once="--once" in sys.argv)
