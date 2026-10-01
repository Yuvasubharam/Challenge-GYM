// One-time backfill: give every member (staff included) who has a member ID but no member-app login
// the default login — user ID = member ID, password = member ID, must change on first sign-in.
// Existing logins are never touched, unless --reset-unused (see below).
//   node scripts/create-member-logins.mjs local|remote [--reset-unused] [--dry-run]
//
// Hashing ~600 passwords (PBKDF2, 100k rounds) is too much CPU for one Worker request, so it runs here
// and only the finished hashes are written to D1 — same format as src/lib/crypto.ts hashPassword().
import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const remote = process.argv[2] === 'remote';
const dryRun = process.argv.includes('--dry-run');
const config = remote && existsSync(join(root, 'wrangler.prod-device.toml')) ? 'wrangler.prod-device.toml' : 'wrangler.device.toml';
const where = remote ? ['--remote'] : ['--local', '--persist-to', '.wrangler/state'];
const wrangler = (...args) => execFileSync(process.execPath, [join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'execute', 'challenge-gym',
  '-c', config, ...where, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const query = (sql) => { const out = wrangler('--json', '--command', sql); return JSON.parse(out.slice(out.indexOf('[')))[0].results; };

const ITERATIONS = 100_000;
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const hashPassword = (pw) => { const salt = randomBytes(16); return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(pbkdf2Sync(pw, salt, ITERATIONS, 32, 'sha256'))}`; };
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const todo = query(`SELECT m.id, m.essl_id, m.name, m.is_staff FROM members m
  WHERE m.archived=0 AND m.essl_id IS NOT NULL AND m.essl_id <> '' AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.member_id=m.id) ORDER BY m.id`);
const noId = query(`SELECT COUNT(*) AS n FROM members m WHERE m.archived=0 AND (m.essl_id IS NULL OR m.essl_id='') AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.member_id=m.id)`)[0].n;
// --reset-unused: logins that exist but have NEVER been used (e.g. temporary desk passwords) go back to
// the standard default — password = member ID, change on first sign-in. Used logins are never touched.
const resetUnused = process.argv.includes('--reset-unused');
const unused = resetUnused ? query(`SELECT a.id, m.essl_id, m.name FROM accounts a JOIN members m ON m.id=a.member_id
  WHERE a.role='member' AND a.last_login_at IS NULL AND m.archived=0 AND m.essl_id IS NOT NULL AND m.essl_id <> '' ORDER BY a.id`) : [];
console.log(`${remote ? 'PRODUCTION' : 'local'} (${config}): ${todo.length} member(s) need a login (${todo.filter((m) => m.is_staff).length} staff); ${noId} without a member ID are skipped`);
if (resetUnused) console.log(`  ${unused.length} existing never-used login(s) will be reset to password = member ID`);
if (dryRun || (!todo.length && !unused.length)) process.exit(0);

const dir = mkdtempSync(join(tmpdir(), 'cg-logins-'));
try {
  for (let i = 0; i < unused.length; i += 100) {
    const sql = unused.slice(i, i + 100).map((a) =>
      `UPDATE accounts SET password_hash=${q(hashPassword(String(a.essl_id).toUpperCase()))}, must_change_password=1 WHERE id=${a.id} AND last_login_at IS NULL;`).join('\n');
    const file = join(dir, `reset-${i}.sql`);
    writeFileSync(file, sql);
    const out = wrangler('--file', file, '--yes');
    if (!/executed successfully|"success": true|Executed \d+ queries/.test(out)) { console.log(out.slice(-800)); throw new Error('reset failed'); }
    console.log(`  reset ${Math.min(i + 100, unused.length)}/${unused.length}`);
  }
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const sql = chunk.map((m) => `INSERT INTO accounts (role, member_id, display_name, password_hash, must_change_password)
      VALUES ('member', ${m.id}, ${q(m.name)}, ${q(hashPassword(String(m.essl_id).toUpperCase()))}, 1) ON CONFLICT(member_id) DO NOTHING;`).join('\n');
    const file = join(dir, `logins-${i}.sql`);
    writeFileSync(file, sql);
    const out = wrangler('--file', file, '--yes');
    if (!/executed successfully|"success": true|Executed \d+ queries/.test(out)) { console.log(out.slice(-800)); throw new Error('write failed'); }
    console.log(`  created ${Math.min(i + 100, todo.length)}/${todo.length}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const left = query(`SELECT COUNT(*) AS n FROM members m WHERE m.archived=0 AND m.essl_id IS NOT NULL AND m.essl_id <> '' AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.member_id=m.id)`)[0].n;
console.log(left === 0 ? 'done: every member with a member ID now has a login' : `WARNING: ${left} still without a login`);
