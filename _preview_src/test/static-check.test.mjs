import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as sc from '../static-check.mjs';
import vm from 'node:vm';

const INDEX = `<header><h1 class="hero-h1" style="x">Reasoning systems for machines that can't afford surprises</h1>
<p style="y">Deep Sky Robotics is building NEPHES, a module designed to watch streams.</p></header>
<section id="platform"><div>THE NEPHES PLATFORM</div><h2>One core, two verticals</h2>
<div class="platform-grid"><p>Designed to deliver predictive maintenance from the PLCs you already run — reasoned findings, tracked episodes, datasheet-cited recommendations. Planned as a desktop product.</p></div></section>
<section><div>FOR EARLY ADOPTERS &amp; ANGEL INVESTORS</div><h2>Get in before the crowd</h2></section>
<section id="contact"><h2>Talk to us</h2><a href="mailto:x">Book a demo</a></section>`;

const PREVIEW_OK = `<meta name="robots" content="noindex, nofollow">
<section data-act="1" data-sc-act="scrub" data-sc-span="3.2"><h1>Reasoning systems for machines that can't afford surprises</h1><p>When a line stops, the first question is why.</p></section>
<section data-act="2" data-sc-act="scrub"><p>Deep Sky Robotics is building NEPHES, a module designed to watch streams.</p><p>Designed to deliver predictive maintenance from the PLCs you already run — reasoned findings, tracked episodes, datasheet-cited recommendations.</p></section>
<section data-act="3" data-sc-act="scrub"><p>The Factory Observer console — live demo on simulated data.</p><a href="/nfo.html">Explore NFO →</a></section>
<section data-act="4" data-sc-act="scrub"><div>THE NEPHES PLATFORM</div><h2>One core, two verticals</h2></section>
<section data-act="4-cards"><div class="platform-grid"><p>Designed to deliver predictive maintenance from the PLCs you already run — reasoned findings, tracked episodes, datasheet-cited recommendations. Planned as a desktop product.</p></div></section>
<section data-act="5"><div>FOR EARLY ADOPTERS &amp; ANGEL INVESTORS</div><h2>Get in before the crowd</h2></section>
<section data-act="5-contact" id="contact"><h2>Talk to us</h2><a href="mailto:x">Book a demo</a></section>`;

test('textOf strips tags, decodes entities and folds whitespace', () => {
  assert.equal(sc.textOf('<p>A &amp; B</p>\n<script>x()</script><b>can’t</b>'), "A & B can't");
});

test('noindex: present passes, missing fails', () => {
  assert.deepEqual(sc.checkNoindex(PREVIEW_OK), []);
  assert.equal(sc.checkNoindex('<title>x</title>').length, 1);
});

test('sitemap and robots must not mention the preview', () => {
  assert.deepEqual(sc.checkSitemap('<loc>https://deepskyrobotics.com/</loc>'), []);
  assert.equal(sc.checkSitemap('<loc>https://deepskyrobotics.com/preview/</loc>').length, 1);
  assert.deepEqual(sc.checkRobots('Disallow: /console/'), []);
  assert.equal(sc.checkRobots('Disallow: /preview/').length, 1);
});

test('no other page may link to the preview', () => {
  assert.deepEqual(sc.checkInboundLinks([{ path: 'index.html', html: '<a href="/nfo.html">x</a>' }]), []);
  assert.equal(sc.checkInboundLinks([{ path: 'nfo.html', html: '<a href="/preview/">x</a>' }]).length, 1);
});

test('claims lint catches every phrase site PR #1 removed, case-insensitively', () => {
  for (const phrase of sc.FORBIDDEN) {
    assert.equal(sc.checkClaims('p.html', `<p>${phrase.toUpperCase()}</p>`).length, 1, phrase);
  }
  assert.deepEqual(sc.checkClaims('p.html', PREVIEW_OK), []);
});

test('claims lint matches whole phrases: PR #1 design-goal wording "entirely on-premises" passes', () => {
  assert.deepEqual(sc.checkClaims('nfo.html', '<p>NFO is being designed to run entirely on-premises, with no cloud tenant.</p>'), []);
  assert.equal(sc.checkClaims('p.html', '<p>Runs entirely on-prem.</p>').length, 1);
});

test('act 3 caption must say "simulated data"', () => {
  assert.deepEqual(sc.checkCaption(PREVIEW_OK), []);
  assert.equal(sc.checkCaption(PREVIEW_OK.replace('simulated data', 'real data')).length, 1);
});

test('act 1 span must be >= 3.2 so S2 is not fetched on the first screen', () => {
  assert.deepEqual(sc.checkHookSpan(PREVIEW_OK), []);
  assert.equal(sc.checkHookSpan(PREVIEW_OK.replace('data-sc-span="3.2"', 'data-sc-span="2.6"')).length, 1);
  assert.equal(sc.checkHookSpan(PREVIEW_OK.replace(' data-sc-span="3.2"', '')).length, 1);
});

test('acts 4 and 5 are word for word with index.html', () => {
  assert.deepEqual(sc.checkVerbatim(PREVIEW_OK, INDEX), []);
  assert.equal(sc.checkVerbatim(PREVIEW_OK.replace('Get in before the crowd', 'Join us'), INDEX).length, 1);
});

test('acts 1-3 reuse the index H1, intro and NFO line, and carry both new lines', () => {
  assert.deepEqual(sc.checkReused(PREVIEW_OK, INDEX), []);
  assert.ok(sc.checkReused(PREVIEW_OK.replace('the first question is why', 'we know why'), INDEX).length >= 1);
});

test('links to site pages and images must be root-absolute', () => {
  assert.deepEqual(sc.checkRootLinks('<a href="/nfo.html"></a><img src="/dsr-logo.png">'), []);
  assert.equal(sc.checkRootLinks('<a href="nfo.html"></a>').length, 1);
  assert.equal(sc.checkRootLinks('<img src="dsr-logo.png">').length, 1);
});

test('scenes may not use time, randomness or the network', () => {
  assert.deepEqual(sc.checkSceneDeterminism('a.html', 'const r = mulberry32(7); r();'), []);
  for (const bad of ['Math.random()', 'Date.now()', 'new Date()', 'performance.now()', 'fetch("x")', 'requestAnimationFrame(f)']) {
    assert.equal(sc.checkSceneDeterminism('a.html', bad).length, 1, bad);
  }
});

test('vendor: header stripped, body hash recorded, LICENSE present', () => {
  const body = Buffer.from('console.log(1)\n');
  const withHeader = Buffer.concat([Buffer.from(sc.ENGINE_HEADER + '\n'), body]);
  const h = createHash('sha256').update(body).digest('hex');
  assert.equal(sc.bodySha(withHeader), h);
  assert.equal(sc.bodySha(body), null);
  const md = `${sc.ENGINE_SHA}\n| scrollcraft.js | x | ${h} |\n| scrollcraft.css | x | ${h} |`;
  const lic = 'MIT License\n\nCopyright (c) 2026 Nate Herk\n';
  assert.deepEqual(sc.checkVendor({ js: withHeader, css: withHeader, license: lic }, md), []);
  assert.equal(sc.checkVendor({ js: body, css: withHeader, license: lic }, md).length, 1);
  assert.equal(sc.checkVendor({ js: withHeader, css: withHeader }, md).length, 1);
  assert.equal(sc.checkVendor({ js: withHeader, css: withHeader, license: lic }, h).length, 1);
});

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('every committed scene file is deterministic, and all three scenes exist', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scenes');
  const files = readdirSync(dir);
  for (const f of ['scene.js', 's1-drift.html', 's2-trace.html', 's4-fork.html']) assert.ok(files.includes(f), `${f} missing`);
  for (const f of files) assert.deepEqual(sc.checkSceneDeterminism(f, readFileSync(join(dir, f), 'utf8')), [], f);
});

test('S4 portrait keeps its core and lanes in the central band (landscape tablets cover-crop portrait clips)', () => {
  // A 720x1280 clip covering a 1180x820 stage shows only scene y 30.5%-69.5%; the plan's scene rule keeps action there.
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scenes');
  const ys = [];
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createRadialGradient' ? () => ({ addColorStop() {} })
    : (...a) => { if (['moveTo', 'lineTo', 'arc'].includes(k)) ys.push(a[1]); }), set: (t, k, v) => { t[k] = v; return true; } });
  const c = { location: { search: '?w=720&h=1280' }, URLSearchParams, Math,
    document: { documentElement: { style: {} }, body: { style: {}, appendChild() {} }, createElement: () => ({ style: {}, getContext: () => ctx2d }) } };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(readFileSync(join(dir, 'scene.js'), 'utf8'), c);
  vm.runInContext(/<script>([\s\S]*?)<\/script>/.exec(readFileSync(join(dir, 's4-fork.html'), 'utf8'))[1], c);
  ys.length = 0;
  c.__frame(1);
  const lo = Math.min(...ys) / 1280, hi = Math.max(...ys) / 1280;
  assert.ok(lo >= 0.31 && hi <= 0.69, `S4 portrait draws from ${lo.toFixed(3)} to ${hi.toFixed(3)} of the height`);
});
