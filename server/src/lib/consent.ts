// Risk-acceptance consent signed at the front desk. The wording lives in the admin app, keyed by
// version (never edited once used), so each row stores only version + language + the signature.
//
// The signature is the pen strokes as a compact SVG path in a 600×200 box with relative moves —
// "M120 80l3 1 4 2 …M300 90l…" — typically 1–4 KB, versus 20–60 KB for a PNG of the same drawing.
export const CONSENT_VERSIONS = ['2026-09-v1'] as const;
export const CONSENT_LANGS = ['en', 'te', 'hi'] as const;

const PATH_RE = /^(?:M\d{1,3} \d{1,3}(?:l-?\d{1,3} -?\d{1,3}(?: -?\d{1,3} -?\d{1,3})*)?)+$/;
const MAX_LEN = 20_000;

/** A real drawing in our path format: well-formed, not too big, and with some ink in it. */
export function isSignaturePath(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > MAX_LEN || !PATH_RE.test(v)) return false;
  const points = (v.match(/-?\d+ -?\d+/g) ?? []).length;
  return points >= 12;
}
