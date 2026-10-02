// eSSL / ZKTeco ADMS ("PUSH") protocol helpers — pure, no I/O.
//
// Device → server:
//   GET  /iclock/cdata?SN=..&options=all        handshake; we reply with upload options
//   POST /iclock/cdata?SN=..&table=ATTLOG       body: "PIN\tYYYY-MM-DD HH:MM:SS\tstatus\tverify\tworkcode..." per line
//   POST /iclock/cdata?SN=..&table=OPERLOG      body: "USER PIN=..\tName=..", "FP PIN=..\tFID=..\tTMP=..", "OPLOG ..." lines
//   GET  /iclock/getrequest?SN=..               poll; we reply "C:<id>:<command>\n" lines or "OK"
//   POST /iclock/devicecmd?SN=..                body: "ID=<id>&Return=<code>&CMD=<verb>" per line
//   POST /iclock/querydata?SN=..&tablename=..   answers to DATA QUERY (newer firmware)

export interface AttPunch {
  pin: string;
  time: string;      // device wall clock 'YYYY-MM-DD HH:MM:SS'
  status: number | null;
  verify: number | null;
}

export function parseAttlog(body: string): AttPunch[] {
  const out: AttPunch[] = [];
  for (const raw of body.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    // Some firmwares/bridges prefix the table name.
    if (line.startsWith('ATTLOG')) line = line.replace(/^ATTLOG\s*/, '');
    const parts = line.split('\t');
    const pin = parts[0]?.trim();
    const time = parts[1]?.trim();
    if (!pin || !time || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(time)) continue;
    out.push({ pin, time, status: toInt(parts[2]), verify: toInt(parts[3]) });
  }
  return out;
}

const toInt = (v?: string) => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Parse "KEY=value\tKEY2=value2" (keys case-insensitive). */
export function parseKv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split('\t')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

export interface OperUser { pin: string; name: string; pri: number | null; card: string; grp: string }
export interface OperFp { pin: string; fid: number; size: number | null; valid: number; tmp: string }

/** OPERLOG / querydata upload: USER, FP, BIODATA lines. Unknown lines are ignored. */
export function parseOperlog(body: string): { users: OperUser[]; fps: OperFp[] } {
  const users: OperUser[] = [];
  const fps: OperFp[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sp = line.indexOf(' ');
    const head = (sp > 0 ? line.slice(0, sp) : line).toUpperCase();
    const kv = parseKv(sp > 0 ? line.slice(sp + 1) : '');
    if ((head === 'USER' || head === 'USERINFO' || head.startsWith('USERINFO')) && kv.pin) {
      users.push({ pin: kv.pin, name: kv.name ?? '', pri: toInt(kv.pri), card: kv.card ?? '', grp: kv.grp ?? '' });
    } else if ((head === 'FP' || head === 'FINGERTMP' || head.startsWith('FINGERTMP')) && kv.pin && kv.tmp) {
      fps.push({ pin: kv.pin, fid: Number(kv.fid ?? kv.fingerid ?? 0), size: toInt(kv.size), valid: Number(kv.valid ?? 1), tmp: kv.tmp });
    } else if (head === 'BIODATA' && kv.pin && kv.tmp && (kv.type ?? '1') === '1') {
      // BIODATA Type=1 is fingerprint (newer firmware)
      fps.push({ pin: kv.pin, fid: Number(kv.no ?? 0), size: null, valid: Number(kv.valid ?? 1), tmp: kv.tmp });
    }
  }
  return { users, fps };
}

export interface CmdReply { id: number; ret: number; cmd: string }

export function parseDeviceCmd(body: string): CmdReply[] {
  const out: CmdReply[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.includes('ID=')) continue;
    const p = new URLSearchParams(line);
    const id = Number(p.get('ID'));
    if (!Number.isFinite(id)) continue;
    out.push({ id, ret: Number(p.get('Return') ?? '-1'), cmd: p.get('CMD') ?? '' });
  }
  return out;
}

/**
 * The device sets its clock from the server (UTC) plus this time zone. The push protocol reads
 * -12…12 as hours and values beyond ±60 as minutes, so a half-hour zone must go as minutes:
 * India (+5:30) = 330. Sending 5.5 made the X990 keep itself exactly 30 minutes slow.
 */
export const tzOption = (offsetMin: number) => (offsetMin % 60 === 0 ? offsetMin / 60 : offsetMin);

/** Handshake response. Stamp=9999 → device only sends *new* records; set to 0 to re-upload all. */
export function handshake(sn: string, tzOffsetMin: number): string {
  return [
    `GET OPTION FROM: ${sn}`,
    'ATTLOGStamp=None',
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP',
    `TimeZone=${tzOption(tzOffsetMin)}`,
    'Realtime=1',
    'Encrypt=None',
    '',
  ].join('\n');
}

// ── Command rendering ───────────────────────────────────────────────────
const clean = (s: string) => s.replace(/[\t\r\n]/g, ' ').slice(0, 24);

export interface UserSpec { pin: string; name: string; card?: string | null; grp?: string | number }

export function userInfoLine(u: UserSpec): string {
  return `DATA UPDATE USERINFO PIN=${u.pin}\tName=${clean(u.name)}\tPri=0\tPasswd=\tCard=${u.card ?? ''}\tGrp=${u.grp ?? 1}`;
}

export function fingerLine(pin: string, t: { fid: number; valid: number; tmp: string }): string {
  // In the push protocol Size is the length of the base64 TMP string (verified on the X990:
  // a 1280-byte template is reported as Size=1708). Agent backups store raw byte size, so
  // always derive it from the string being sent.
  return `DATA UPDATE FINGERTMP PIN=${pin}\tFID=${t.fid}\tSize=${t.tmp.length}\tValid=${t.valid}\tTMP=${t.tmp}`;
}

export const deleteUserLine = (pin: string) => `DATA DELETE USERINFO PIN=${pin}`;
export const queryFingerLine = (pin: string) => `DATA QUERY FINGERTMP PIN=${pin}`;
export const queryUsersLine = () => 'DATA QUERY USERINFO';

export const isSafePin = (pin: string) => /^[A-Za-z0-9_-]{1,24}$/.test(pin);
