// Downloads one freely-licensed photo per curated dish (seed/data/cg_foods.mjs) from Wikimedia Commons
// and writes compressed WebP files into the member app's static assets:
//   member-app/public/food/<slug>.webp     480×360, ≤ 50 KB (details sheet)
//   member-app/public/food/<slug>-t.webp   120×90 thumbnail (food search list)
// Credits (author + licence, required by CC BY / BY-SA) go to seed/data/cg_food_images.json,
// which build-fitness-seed.mjs copies into foods.image / foods.image_credit.
//   node scripts/fetch-food-images.mjs            fetch missing images only
//   node scripts/fetch-food-images.mjs --force    search again for every dish (drops hand-picked files)
//   node scripts/fetch-food-images.mjs --reencode re-download the files already chosen in the manifest
//   node scripts/fetch-food-images.mjs slug=idli "file=File:Idli Sambar.JPG"   pin a specific Commons file
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CG_FOODS } from '../seed/data/cg_foods.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '..', 'member-app', 'public', 'food');
const manifestPath = join(root, 'seed', 'data', 'cg_food_images.json');
mkdirSync(outDir, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).map((a) => (a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, true])));
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const UA = { 'User-Agent': 'ChallengeGymFoodImages/1.0 (https://challengegym.in; admin@challengegym.in)' };
const FREE = /^(cc0|public domain|pd\b|cc[- ]by(-sa)?[- ]\d(\.\d)?|cc[- ]by(-sa)?$)/i;
const strip = (html = '') => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function api(host, params) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...params })}`;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.json();
    } catch { /* network blip: retry */ }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new Error(`${host} API failed: ${url}`);
}

const INFO = { prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '800' };

/** Commons files for a title (from a Wikipedia article's lead image) or a search. */
async function candidates(spec) {
  if (spec.startsWith('File:')) {
    return (await api('commons.wikimedia.org', { titles: spec, ...INFO })).query?.pages ?? [];
  }
  if (spec.startsWith('w:')) {
    const q = await api('en.wikipedia.org', { titles: spec.slice(2), prop: 'pageimages', piprop: 'name', redirects: '1' });
    const name = q.query?.pages?.[0]?.pageimage;
    if (!name) return [];
    return (await api('commons.wikimedia.org', { titles: `File:${name}`, ...INFO })).query?.pages ?? [];
  }
  const q = await api('commons.wikimedia.org', { generator: 'search', gsrsearch: `filetype:bitmap ${spec.slice(2)}`, gsrnamespace: '6', gsrlimit: '10', ...INFO });
  return (q.query?.pages ?? []).sort((a, b) => a.index - b.index);
}

function usable(p) {
  const ii = p.imageinfo?.[0];
  if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime)) return null;
  if (ii.width < 400 || ii.height < 300 || ii.width / ii.height > 2.2 || ii.height / ii.width > 1.6) return null;
  const m = ii.extmetadata ?? {};
  const license = strip(m.LicenseShortName?.value);
  if (!FREE.test(license)) return null;
  const artist = strip(m.Artist?.value).slice(0, 80) || 'Unknown author';
  return { title: p.title, url: ii.thumburl ?? ii.url, page: ii.descriptionurl, license, credit: `${artist} · ${license} · Wikimedia Commons` };
}

async function encode(buf, w, h, maxBytes) {
  for (const quality of [82, 74, 66, 58, 50, 42, 34]) {
    const out = await sharp(buf).rotate().resize(w, h, { fit: 'cover', position: sharp.strategy.attention }).webp({ quality, effort: 6 }).toBuffer();
    if (out.length <= maxBytes || quality === 34) return out;
  }
}

let done = 0, skipped = 0;
const missing = [];
const only = args.slug;
for (const food of CG_FOODS) {
  if (only && food.slug !== only) continue;
  const reencode = args['--reencode'] && manifest[food.slug];
  if (!args['--force'] && !reencode && !args.file && manifest[food.slug] && existsSync(join(outDir, `${food.slug}.webp`))) { skipped++; continue; }
  const specs = args.file ? [args.file] : reencode ? [manifest[food.slug].file] : [food.image, ...(food.image.startsWith('w:') ? [`c:${food.name.replace(/\(.*?\)/g, '').trim()}`] : [])];
  let pick = null;
  for (const spec of specs) {
    for (const p of await candidates(spec)) { pick = usable(p); if (pick) break; }
    if (pick) break;
  }
  if (!pick) { missing.push(food.slug); console.log(`✗ ${food.slug}: no free image for ${specs.join(' / ')}`); continue; }
  const r = await fetch(pick.url, { headers: UA }).catch((e) => ({ ok: false, status: e.message }));
  if (!r.ok) { missing.push(food.slug); console.log(`✗ ${food.slug}: download ${r.status}`); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  const big = await encode(buf, 480, 360, 50_000);
  const thumb = await encode(buf, 120, 90, 6_000);
  writeFileSync(join(outDir, `${food.slug}.webp`), big);
  writeFileSync(join(outDir, `${food.slug}-t.webp`), thumb);
  manifest[food.slug] = { file: pick.title, page: pick.page, license: pick.license, credit: pick.credit, bytes: big.length };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  done++;
  console.log(`✓ ${food.slug}  ${(big.length / 1024).toFixed(1)} KB  ${pick.title}  (${pick.license})`);
}
console.log(`\nfetched ${done}, already had ${skipped}, missing ${missing.length}${missing.length ? `: ${missing.join(', ')}` : ''}`);
