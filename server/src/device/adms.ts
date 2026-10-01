// /iclock/* — eSSL X990 in ADMS (Cloud Server) mode talks to these endpoints directly.
// Devices cannot authenticate, so only serial numbers approved by an admin (or listed in
// DEVICE_SN_ALLOWLIST) may upload data or receive commands.
import { Hono } from 'hono';
import type { AppEnv, Env } from '../env';
import { tzOffset } from '../env';
import { first, nowIso, run } from '../lib/db';
import { handshake, parseAttlog, parseDeviceCmd, parseOperlog } from './protocol';
import { applyAdmsReplies, claimForAdms, ingestOperlog, ingestPunches } from './queue';

const text = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/plain' } });

async function touchDevice(env: Env, sn: string, ip: string | null, extra: Record<string, string | null> = {}): Promise<boolean> {
  const allow = (env.DEVICE_SN_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // The device polls every few seconds: only write when something changed or every 30 s
  // (D1 bills per row written; "online" needs minute precision, not second).
  await run(
    env.DB,
    `INSERT INTO devices (sn, approved, last_ip, last_seen_at, last_seen_via, push_version) VALUES (?, ?, ?, ?, 'adms', ?)
     ON CONFLICT(sn) DO UPDATE SET last_ip=excluded.last_ip, last_seen_at=excluded.last_seen_at, last_seen_via='adms',
       approved=MAX(devices.approved, excluded.approved), push_version=COALESCE(excluded.push_version, devices.push_version)
     WHERE devices.last_seen_at IS NULL OR devices.last_seen_at < ? OR devices.last_seen_via <> 'adms'
       OR devices.last_ip IS NOT excluded.last_ip OR devices.approved < excluded.approved
       OR (excluded.push_version IS NOT NULL AND devices.push_version IS NOT excluded.push_version)`,
    sn, allow.includes(sn) ? 1 : 0, ip, nowIso(), extra.pushver ?? null, new Date(Date.now() - 30_000).toISOString(),
  );
  const d = await first<{ approved: number }>(env.DB, `SELECT approved FROM devices WHERE sn=?`, sn);
  return !!d?.approved;
}

export const adms = new Hono<AppEnv>();

adms.use('*', async (c, next) => {
  const sn = c.req.query('SN') ?? c.req.query('sn');
  const t0 = Date.now();
  if (!sn || !/^[A-Za-z0-9]{4,32}$/.test(sn)) return text('OK');
  await next();
  const q = new URL(c.req.url).search.replace(/SN=[^&]+&?/, '').slice(0, 80);
  console.log(`adms ${sn} ${c.req.method} ${c.req.path}${q ? ' ' + q : ''} → ${c.res.status} ${Date.now() - t0}ms`);
});

// Handshake / options
adms.get('/cdata', async (c) => {
  const sn = c.req.query('SN')!;
  await touchDevice(c.env, sn, c.req.header('cf-connecting-ip') ?? null, { pushver: c.req.query('pushver') ?? null });
  return text(handshake(sn, tzOffset(c.env) / 60));
});

// Uploads: ATTLOG (punches), OPERLOG (users, fingerprints), others acknowledged
adms.post('/cdata', async (c) => {
  const sn = c.req.query('SN')!;
  const table = (c.req.query('table') ?? '').toUpperCase();
  const body = await c.req.text();
  const approved = await touchDevice(c.env, sn, c.req.header('cf-connecting-ip') ?? null);
  if (!approved) return text('OK');

  if (table === 'ATTLOG' || (!table && body.startsWith('ATTLOG'))) {
    const punches = parseAttlog(body);
    const r = await ingestPunches(c.env, punches, 'adms', sn);
    return text(`OK: ${punches.length}`);
  }
  if (table === 'OPERLOG' || table === 'USERINFO' || table === 'FINGERTMP' || table === 'BIODATA') {
    const parsed = parseOperlog(body);
    await ingestOperlog(c.env, parsed, 'adms');
    return text(`OK: ${parsed.users.length + parsed.fps.length}`);
  }
  return text('OK');
});

// Answers to "DATA QUERY ..." on newer firmware
adms.post('/querydata', async (c) => {
  const sn = c.req.query('SN')!;
  if (!(await touchDevice(c.env, sn, c.req.header('cf-connecting-ip') ?? null))) return text('OK');
  const parsed = parseOperlog(await c.req.text());
  await ingestOperlog(c.env, parsed, 'adms');
  return text(`${c.req.query('tablename') ?? 'data'}=${parsed.users.length + parsed.fps.length}`);
});

// Command poll
adms.get('/getrequest', async (c) => {
  const sn = c.req.query('SN')!;
  const approved = await touchDevice(c.env, sn, c.req.header('cf-connecting-ip') ?? null);
  const info = c.req.query('INFO');
  if (info) {
    // INFO=FirmwareVer,UserCount,FPCount,AttCount,DeviceIP,...
    const [fw, users, fps, atts] = info.split(',');
    const infoJson = JSON.stringify({ info });
    await run(c.env.DB, `UPDATE devices SET firmware=?, user_count=?, fp_count=?, att_count=?, info=? WHERE sn=? AND info IS NOT ?`,
      fw ?? null, Number(users) || null, Number(fps) || null, Number(atts) || null, infoJson, sn, infoJson);
  }
  if (!approved) return text('OK');
  return text(await claimForAdms(c.env, sn));
});

// Command results
adms.post('/devicecmd', async (c) => {
  const sn = c.req.query('SN')!;
  if (!(await touchDevice(c.env, sn, c.req.header('cf-connecting-ip') ?? null))) return text('OK');
  await applyAdmsReplies(c.env, parseDeviceCmd(await c.req.text()));
  return text('OK');
});

// Newer push protocol probes
adms.all('/registry', (c) => text('RegistryCode=None'));
adms.all('/ping', (c) => text('OK'));
adms.all('/push', async (c) => text(handshake(c.req.query('SN')!, tzOffset(c.env) / 60)));
adms.all('/*', (c) => text('OK'));
