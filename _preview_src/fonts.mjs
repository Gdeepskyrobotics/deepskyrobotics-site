// fonts.mjs: fetches the latin woff2 files and OFL texts for the preview's three families. CI only.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400..900&family=Montserrat:wght@700..900&family=JetBrains+Mono:wght@400..700&display=swap';
const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const GOOGLE_FONTS_SHA = 'bd8f81ddb5c74d5c8897b36ad88b440266245103';
export const OFL = { Inter: 'ofl/inter/OFL.txt', Montserrat: 'ofl/montserrat/OFL.txt', 'JetBrains Mono': 'ofl/jetbrainsmono/OFL.txt' };

export function parseFontCss(css) {
  const out = [];
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const body = m[2];
    const get = (k) => { const r = new RegExp(`${k}\\s*:\\s*([^;]+);`).exec(body); return r ? r[1].trim() : undefined; };
    const url = /url\(([^)]+)\)/.exec(body);
    out.push({ subset: m[1], family: get('font-family')?.replace(/['"]/g, ''), style: get('font-style'), weight: get('font-weight'), url: url ? url[1] : undefined, unicodeRange: get('unicode-range') });
  }
  return out;
}
export const slug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export function fontFaceCss(faces) {
  return faces.map((f) => `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${f.file}) format('woff2');unicode-range:${f.unicodeRange}}`).join('\n') + '\n';
}

async function get(url, binary) {
  const res = await fetch(url, { headers: { 'User-Agent': CHROME_UA } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function main() {
  const args = process.argv.slice(2);
  const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const out = val('--out', 'preview/fonts'), summary = val('--summary', null);
  mkdirSync(out, { recursive: true });
  const faces = parseFontCss(await get(FONT_CSS_URL)).filter((f) => f.subset === 'latin' && f.style === 'normal');
  for (const fam of Object.keys(OFL)) if (!faces.some((f) => f.family === fam)) throw new Error(`no latin face for ${fam}`);
  const rows = [];
  for (const f of faces) {
    f.file = `${slug(f.family)}-${f.weight.replace(/\s+/g, '-')}-latin.woff2`;
    const buf = await get(f.url, true);
    writeFileSync(join(out, f.file), buf);
    rows.push(`| ${f.file} | ${f.url} | ${buf.length} | ${sha(buf)} |`);
  }
  writeFileSync(join(out, 'fonts.css'), fontFaceCss(faces));
  for (const [fam, path] of Object.entries(OFL)) {
    const url = `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_SHA}/${path}`;
    const buf = await get(url, true);
    writeFileSync(join(out, `OFL-${slug(fam)}.txt`), buf);
    rows.push(`| OFL-${slug(fam)}.txt | ${url} | ${buf.length} | ${sha(buf)} |`);
  }
  const table = ['| file | source | bytes | sha256 |', '|---|---|---:|---|', ...rows].join('\n');
  writeFileSync(join(out, 'FONTS.md'), `# Self-hosted fonts\n\nFetched by \`_preview_src/fonts.mjs\` in CI. SIL Open Font License 1.1: see the OFL-*.txt files.\n\n${table}\n`);
  for (const r of rows) console.log(`summary: ${r}`);
  if (summary) appendFileSync(summary, `### Fonts\n\n${table}\n\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
