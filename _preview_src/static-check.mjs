// static-check.mjs: zero-dependency static rules for the unlisted preview page.
// CLI: node _preview_src/static-check.mjs --root . [--only noindex,claims,...] [--upstream]
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FORBIDDEN = [
  'entirely on-prem', 'installed desktop release', 'read-only, always', 'reads live plc telemetry',
  'days before the failure', "can't be attacked", "only engine you'll ever need", 'integrates with', 'we beat',
  // NFO UI honesty (2026-10-27): no early-warning claim, no fake confidence, no write-back promise.
  'predictive maintenance', 'calibrated confidence', 'write-back is on the roadmap', 'live demo',
];
export const NEW_LINES = [
  'When a line stops, the first question is why.',
  'The Factory Observer console — demo on simulated data.',
];
export const ENGINE_HEADER = '/*! scroll-craft 0.3.1 @75d81f7 | MIT | Copyright (c) 2026 Nate Herk | see LICENSE */';
export const ENGINE_SHA = '75d81f74e83692add18cd7a8a8e078b8a887a579';
export const ENGINE_FILES = {
  'scrollcraft.js': 'plugins/nateherk-design/skills/scroll-craft/engine/scrollcraft.js',
  'scrollcraft.css': 'plugins/nateherk-design/skills/scroll-craft/engine/scrollcraft.css',
};
export const MIN_HOOK_SPAN = 3.2;

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&rsquo;': "'", '&nbsp;': ' ', '&mdash;': '—', '&rarr;': '→', '&middot;': '·' };

export function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function sectionByAct(html, act) {
  const re = new RegExp(`<section\\b[^>]*\\bdata-act="${act}"[^>]*>[\\s\\S]*?<\\/section>`, 'i');
  const m = re.exec(html);
  return m ? m[0] : null;
}

export function checkNoindex(html) {
  return /<meta\s+name="robots"\s+content="noindex,\s*nofollow"\s*\/?>/i.test(html)
    ? [] : ['preview/index.html: missing <meta name="robots" content="noindex, nofollow">'];
}
export function checkSitemap(xml) { return /\/preview/i.test(xml) ? ['sitemap.xml mentions /preview'] : []; }
export function checkRobots(txt) { return /\/preview/i.test(txt) ? ['robots.txt mentions /preview (that would advertise it)'] : []; }

export function checkInboundLinks(pages) {
  return pages.filter((p) => /href\s*=\s*["'][^"']*\bpreview\b/i.test(p.html)).map((p) => `${p.path} links to the preview`);
}

// Whole phrases only: "entirely on-prem" must not match PR #1's design-goal wording "entirely on-premises".
const phraseRe = (p) => new RegExp(`(?<![a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`);

export function checkClaims(path, html) {
  const t = textOf(html).toLowerCase();
  return FORBIDDEN.filter((p) => phraseRe(p).test(t)).map((p) => `${path}: forbidden claim "${p}" (CLAIMS.md, decision 54)`);
}

export function checkCaption(html) {
  const s = sectionByAct(html, '3');
  if (!s) return ['preview: no section data-act="3"'];
  return textOf(s).toLowerCase().includes('simulated data') ? [] : ['preview act 3: the caption must say "simulated data"'];
}

export function checkHookSpan(html) {
  const s = sectionByAct(html, '1');
  if (!s) return ['preview: no section data-act="1"'];
  const m = /data-sc-span="([\d.]+)"/.exec(s);
  const v = m ? parseFloat(m[1]) : 0;
  return v >= MIN_HOOK_SPAN ? [] : [`preview act 1: data-sc-span must be >= ${MIN_HOOK_SPAN} so S2 is not fetched on the first screen (found ${m ? m[1] : 'none'})`];
}

function indexSections(indexHtml) {
  const all = indexHtml.match(/<section\b[^>]*>[\s\S]*?<\/section>/gi) || [];
  return {
    platform: all.find((s) => /\bid="platform"/.test(s)),
    investor: all.find((s) => /Get in before the crowd/.test(s)),
    contact: all.find((s) => /\bid="contact"/.test(s)),
  };
}

export function checkVerbatim(previewHtml, indexHtml) {
  const idx = indexSections(indexHtml);
  const pairs = [
    ['platform', ['4', '4-cards'], idx.platform],
    ['investor + contact', ['5', '5-contact'], idx.investor && idx.contact ? idx.investor + idx.contact : null],
  ];
  const errs = [];
  for (const [name, acts, src] of pairs) {
    if (!src) { errs.push(`index.html: section(s) for ${name} not found`); continue; }
    const got = acts.map((a) => textOf(sectionByAct(previewHtml, a) || '')).join(' ').trim();
    const want = textOf(src);
    if (got !== want) errs.push(`preview acts ${acts.join('+')}: text differs from index.html ${name}\n  want: ${want.slice(0, 200)}\n  got:  ${got.slice(0, 200)}`);
  }
  return errs;
}

export function checkReused(previewHtml, indexHtml) {
  const t = textOf(previewHtml);
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(indexHtml);
  const intro = /<header\b[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(indexHtml);
  const nfo = /Designed to give maintenance teams evidence-backed findings[^.]*\./.exec(textOf(indexHtml));
  const want = [
    ['index H1', h1 && textOf(h1[1])],
    ['index intro paragraph', intro && textOf(intro[1])],
    ['index NFO line', nfo && nfo[0]],
    ...NEW_LINES.map((l) => ['new line', l]),
  ];
  return want.filter(([, s]) => !s || !t.includes(s)).map(([what, s]) => `preview: missing ${what}: "${s}"`);
}

export function checkRootLinks(html) {
  const bad = html.match(/(?:href|src)="(?:(?:nfo|nephes|index)\.html|(?:dsr-)?logo\.png)"/g) || [];
  return bad.map((b) => `preview: ${b} must be root-absolute (it would resolve under /preview/)`);
}

export function checkSceneDeterminism(name, src) {
  const bad = [/Math\.random/, /Date\.now/, /new Date\b/, /performance\.now/, /\bfetch\s*\(/, /XMLHttpRequest/, /requestAnimationFrame/];
  return bad.filter((r) => r.test(src)).map((r) => `${name}: non-deterministic call /${r.source}/`);
}

export function bodySha(buf) {
  const head = Buffer.from(ENGINE_HEADER + '\n');
  if (!buf || buf.length < head.length || !buf.subarray(0, head.length).equals(head)) return null;
  return createHash('sha256').update(buf.subarray(head.length)).digest('hex');
}

export function checkVendor(files, vendorMd) {
  const errs = [];
  if (!files.license || !/Copyright \(c\) 2026 Nate Herk/.test(files.license)) errs.push('vendor: LICENSE missing or lacks "Copyright (c) 2026 Nate Herk"');
  if (!vendorMd.includes(ENGINE_SHA)) errs.push('vendor: VENDOR.md does not record the pinned SHA');
  for (const [key, name] of [['js', 'scrollcraft.js'], ['css', 'scrollcraft.css']]) {
    const h = bodySha(files[key]);
    if (!h) { errs.push(`vendor: ${name} missing or lacks the /*! */ header line`); continue; }
    if (!vendorMd.includes(h)) errs.push(`vendor: ${name} body sha256 ${h} is not the one VENDOR.md records`);
  }
  return errs;
}

async function upstreamErrors(root) {
  const errs = [];
  for (const [name, path] of Object.entries(ENGINE_FILES)) {
    const url = `https://raw.githubusercontent.com/nateherkai/scroll-craft/${ENGINE_SHA}/${path}`;
    const res = await fetch(url);
    if (!res.ok) { errs.push(`upstream: ${url} returned ${res.status}`); continue; }
    const up = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
    const local = bodySha(readFileSync(join(root, 'preview/vendor/scrollcraft', name)));
    if (up !== local) errs.push(`upstream: ${name} differs from ${ENGINE_SHA} (upstream ${up}, local ${local})`);
  }
  return errs;
}

export async function run(root, { only = null, upstream = false } = {}) {
  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
  const on = (name) => !only || only.includes(name);
  const preview = read('preview/index.html');
  const index = read('index.html');
  const errs = [];
  const needPreview = ['noindex', 'caption', 'span', 'verbatim', 'reused', 'rootlinks'].some(on);
  if (needPreview && preview == null) errs.push('preview/index.html is missing');
  if (preview != null) {
    if (on('noindex')) errs.push(...checkNoindex(preview));
    if (on('caption')) errs.push(...checkCaption(preview));
    if (on('span')) errs.push(...checkHookSpan(preview));
    if (on('verbatim')) errs.push(...checkVerbatim(preview, index || ''));
    if (on('reused')) errs.push(...checkReused(preview, index || ''));
    if (on('rootlinks')) errs.push(...checkRootLinks(preview));
  }
  if (on('sitemap')) errs.push(...checkSitemap(read('sitemap.xml') || ''));
  if (on('robots')) errs.push(...checkRobots(read('robots.txt') || ''));
  const others = ['index.html', 'nfo.html', 'nephes.html', 'console/index.html']
    .map((path) => ({ path, html: read(path) })).filter((p) => p.html != null);
  if (on('inbound')) errs.push(...checkInboundLinks(others));
  if (on('claims')) for (const p of [...others, ...(preview ? [{ path: 'preview/index.html', html: preview }] : [])]) errs.push(...checkClaims(p.path, p.html));
  if (on('scenes') && existsSync(join(root, '_preview_src/scenes'))) {
    for (const f of readdirSync(join(root, '_preview_src/scenes'))) errs.push(...checkSceneDeterminism(f, read(`_preview_src/scenes/${f}`)));
  }
  if (on('vendor')) {
    const v = (f) => (existsSync(join(root, 'preview/vendor/scrollcraft', f)) ? readFileSync(join(root, 'preview/vendor/scrollcraft', f)) : undefined);
    errs.push(...checkVendor({ js: v('scrollcraft.js'), css: v('scrollcraft.css'), license: v('LICENSE')?.toString('utf8') }, read('preview/vendor/scrollcraft/VENDOR.md') || ''));
    if (upstream) errs.push(...(await upstreamErrors(root)));
  }
  return errs;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const errs = await run(val('--root') || '.', { only: val('--only')?.split(','), upstream: args.includes('--upstream') });
  for (const e of errs) console.log(`static-check: ${e}`);
  console.log(`static-check: ${errs.length} problem(s)`);
  process.exit(errs.length ? 1 : 0);
}
