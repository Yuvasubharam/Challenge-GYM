"""
Read-only check: can fingerprint templates be read for one PIN, and what do recent punches look like?
Usage: python probe_templates.py <PIN> [ip]
"""
import base64
import sys
from collections import Counter

from zk import ZK

PIN = sys.argv[1] if len(sys.argv) > 1 else "CGA5"
IP = sys.argv[2] if len(sys.argv) > 2 else "192.168.0.215"

conn = ZK(IP, port=4370, timeout=15, ommit_ping=True).connect()
try:
    users = conn.get_users()
    u = next((x for x in users if str(x.user_id) == PIN), None)
    if not u:
        print(f"PIN {PIN} not on device")
    else:
        print(f"user uid={u.uid} pin={u.user_id} name={u.name!r} priv={u.privilege} group={u.group_id!r}")
        found = 0
        for fid in range(10):
            t = conn.get_user_template(uid=u.uid, temp_id=fid)
            if t and t.template:
                found += 1
                print(f"  finger {fid}: {len(t.template)} bytes, valid={t.valid}, b64 prefix={base64.b64encode(t.template)[:24].decode()}")
        print(f"  templates readable: {found}")

    att = conn.get_attendance()
    print(f"\nattendance records: {len(att)}")
    if att:
        att.sort(key=lambda a: a.timestamp)
        print("oldest:", att[0].timestamp, " newest:", att[-1].timestamp)
        for a in att[-5:]:
            print(f"  {a.user_id}\t{a.timestamp}\tstatus={a.status}\tpunch={a.punch}")
        days = Counter(a.timestamp.date().isoformat() for a in att[-3000:])
        print("last days (punches/day):", sorted(days.items())[-7:])
finally:
    conn.disconnect()
