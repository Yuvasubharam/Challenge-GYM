// Generates a VAPID key pair for phone (web-push) notifications.
//   node scripts/gen-vapid.mjs
// Then:
//   VAPID_PUBLIC  → [vars] in wrangler.admin.toml AND wrangler.member.toml (it is public)
//   VAPID_PRIVATE → wrangler secret put VAPID_PRIVATE -c wrangler.admin.toml   (admin worker only)
//   Local dev: add both lines to server/.dev.vars
const { subtle } = globalThis.crypto;
const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
const jwk = await subtle.exportKey('jwk', kp.privateKey);
const b64u = (b) => Buffer.from(b).toString('base64url');
console.log(`VAPID_PUBLIC=${b64u(raw)}`);
console.log(`VAPID_PRIVATE=${jwk.d}`);
