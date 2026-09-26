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

Config: agent/.env (see .env.example).  Run: python agent.py   (or --once for a single cycle)
"""
from __future__ import annotations

import base64
import logging
import os
import sys
import time
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
ETTL_EVERY_MIN = int(os.environ.get("ETTL_EVERY_MIN", "60"))
ETTL_DB = os.environ.get("ETTL_DB", r"C:\Program Files (x86)\eSSL\eTimeTrackLite\eTimeTrackLite1.mdb")
BACKFILL_DAYS = int(os.environ.get("BACKFILL_DAYS", "3"))  # first run: how far back to upload punches

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(Path(__file__).with_name("agent.log"), encoding="utf-8"), logging.StreamHandler()],
)
log = logging.getLogger("agent")

session = requests.Session()
session.headers.update({"Authorization": f"Bearer {AGENT_TOKEN}", "User-Agent": "challenge-gym-agent/1.0"})


def api(path: str, body: dict | None = None, method: str = "POST") -> dict:
    r = session.request(method, f"{CLOUD_URL}/agent{path}", json=body if method != "GET" else None, timeout=30)
    r.raise_for_status()
    return r.json()


# ── Device ──────────────────────────────────────────────────────────────
@contextmanager
def device(write: bool = False):
    """One TCP session. For writes the device keypad is paused briefly (disable_device)."""
    zk = ZK(DEVICE_IP, port=DEVICE_PORT, timeout=15, password=DEVICE_PASSWORD, force_udp=False, ommit_ping=True)
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
        sync_roster(conn)
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
            "ip": DEVICE_IP, "users": conn.users, "fingers": conn.fingers, "records": conn.records}


def sync_roster(conn=None):
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
        api("/device-users", {"complete": True, "users": [
            {"pin": str(u.user_id), "name": u.name, "privilege": u.privilege, "card": str(u.card or ""),
             "group": u.group_id or "", "fingers": counts.get(str(u.user_id), 0)} for u in users]})
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
def main(once: bool = False):
    if not AGENT_TOKEN:
        sys.exit("AGENT_TOKEN missing — set it in agent/.env")
    log.info("agent starting → cloud %s, device %s:%s", CLOUD_URL, DEVICE_IP, DEVICE_PORT)
    next_att = next_roster = next_ettl = 0.0
    info: dict = {}
    while True:
        now = time.time()
        try:
            try:
                with device() as conn:
                    info = device_info(conn)
            except Exception as e:
                info = {"error": str(e)}
            hb = api("/heartbeat", {"device": info if "sn" in info else None, "agent": {"version": "1.0", "host": os.environ.get("COMPUTERNAME")}})
            process_commands()
            if now >= next_roster:
                sync_roster(); next_roster = now + ROSTER_EVERY_MIN * 60
            if now >= next_att:
                sync_attendance(hb.get("last_punch")); next_att = now + ATTENDANCE_EVERY_MIN * 60
            if now >= next_ettl:
                sync_etimetrack(); next_ettl = now + ETTL_EVERY_MIN * 60
        except Exception as e:
            log.error("cycle failed: %s", e)
        if once:
            return
        time.sleep(COMMAND_POLL_SEC)


if __name__ == "__main__":
    main(once="--once" in sys.argv)
