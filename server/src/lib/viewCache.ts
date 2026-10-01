// Short-lived, per-isolate cache for the admin app's heavy read screens (members list, dashboard,
// renewals, attendance stats). D1 bills and rate-limits by rows read; these screens re-read the same
// few thousand rows on every page open, although the data changes a few times an hour.
//
// Correctness:
//  • Every successful admin write bumps settings.admin_v (see workers/admin.ts). Each cached read
//    checks that one-row counter, so an admin's own change (renewal, payment, edit) shows at once,
//    in every Worker instance.
//  • Changes made elsewhere (door punches, member app, device results) are covered by the TTL:
//    each entry says how stale it may get (20 s for today's check-ins … 5 min for 30-day stats).
import type { Env } from '../env';
import { first, run } from './db';

const VERSION_KEY = 'admin_v';
const MAX_ENTRIES = 50;

type Entry = { at: number; v: string; value: unknown; loading?: Promise<unknown> };
const store = new Map<string, Entry>();

/** Called after every successful admin write (1 row written). */
export async function bumpAdminVersion(env: Env) {
  await run(env.DB, `INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`, VERSION_KEY);
}

/** One row per cached read — the price of never showing an admin their own stale data. */
const currentVersion = async (env: Env) =>
  (await first<{ value: string }>(env.DB, `SELECT value FROM settings WHERE key=?`, VERSION_KEY))?.value ?? '0';

export async function cachedView<T>(env: Env, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const v = await currentVersion(env);
  const hit = store.get(key);
  if (hit && hit.v === v && Date.now() - hit.at < ttlMs) return (hit.loading ?? hit.value) as T;
  const loading = load();
  store.set(key, { at: Date.now(), v, value: hit?.value, loading });
  try {
    const value = await loading;
    store.set(key, { at: Date.now(), v, value });
    if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
    return value;
  } catch (e) {
    store.delete(key);
    throw e;
  }
}
