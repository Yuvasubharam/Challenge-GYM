// Loads seed/fitness/*.sql into D1 in order.   node scripts/load-fitness-seed.mjs local|remote [foods]
// 'foods' loads only foods-cg.sql (curated dishes + one-time INDB cleanup) — cheap enough for a live DB.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const where = process.argv[2] === 'remote' ? ['--remote'] : ['--local', '--persist-to', '.wrangler/state'];
const dir = join(root, 'seed', 'fitness');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql') && (process.argv[3] !== 'foods' || f === 'foods-cg.sql')).sort();
for (const f of files) {
  process.stdout.write(`loading ${f} … `);
  const out = execFileSync(process.execPath, [join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'execute', 'challenge-gym',
    '-c', 'wrangler.device.toml', ...where, '--file', join('seed', 'fitness', f), '--yes'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!/executed successfully|"success": true/.test(out)) { console.log('FAILED'); console.log(out.slice(-800)); process.exit(1); }
  console.log('ok');
}
console.log(`done: ${files.length} file(s)`);
