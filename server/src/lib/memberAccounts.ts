// Member-app logins. Every member with a device ID gets one: user ID = member ID, starting
// password = member ID, and the app makes them choose their own password on first sign-in.
import type { Env } from '../env';
import { hashPassword } from './crypto';
import { first } from './db';

/** Create the default login for a member if they have none. Returns the account id (existing or new). */
export async function ensureDefaultLogin(env: Env, memberId: number): Promise<number | null> {
  const m = await first<{ essl_id: string | null; name: string; aid: number | null }>(env.DB,
    `SELECT m.essl_id, m.name, (SELECT id FROM accounts WHERE member_id=m.id) AS aid FROM members m WHERE m.id=? AND m.archived=0`, memberId);
  if (!m) return null;
  if (m.aid) return m.aid;
  if (!m.essl_id) return null;
  const r = await first<{ id: number }>(env.DB,
    `INSERT INTO accounts (role, member_id, display_name, password_hash, must_change_password) VALUES ('member', ?, ?, ?, 1)
     ON CONFLICT(member_id) DO NOTHING RETURNING id`,
    memberId, m.name, await hashPassword(m.essl_id.toUpperCase()));
  return r?.id ?? (await first<{ id: number }>(env.DB, `SELECT id FROM accounts WHERE member_id=?`, memberId))?.id ?? null;
}
