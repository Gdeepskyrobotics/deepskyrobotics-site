// check.mjs: browser checks for the unlisted preview, one profile per run. CI only.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const MB = 1e6;
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const TABLET_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const still = { full: 0.8 * MB, first: 0.8 * MB };
export const PROFILES = {
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false, touch: false, reduced: false, js: true, budget: { full: 6.0 * MB, first: 1.5 * MB } },
  mobile: { width: 390, height: 844, dpr: 3, mobile: true, touch: true, reduced: false, js: true, ua: PHONE_UA, budget: { full: 3.0 * MB, first: 0.8 * MB } },
  'desktop-reduced': { width: 1440, height: 900, dpr: 1, mobile: false, touch: false, reduced: true, js: true, budget: still },
  'mobile-reduced': { width: 390, height: 844, dpr: 3, mobile: true, touch: true, reduced: true, js: true, ua: PHONE_UA, budget: still },
  'tablet-touch': { width: 1180, height: 820, dpr: 2, mobile: true, touch: true, reduced: false, js: true, ua: TABLET_UA, budget: { full: 3.0 * MB, first: 0.8 * MB } },
  'desktop-nojs': { width: 1440, height: 900, dpr: 1, mobile: false, touch: false, reduced: false, js: false, budget: still },
};
export const FIRST_SCREEN_CLIPS = ['s1-drift'];

export function clipId(url) {
  const m = /\/media\/([a-z0-9-]+?)(-m)?\.mp4(?:[?#]|$)/.exec(url);
  return m ? m[1] : null;
}
export const fmt = (b) => (b / MB).toFixed(2) + ' MB';

export function evaluate(profileName, m) {
  const p = PROFILES[profileName];
  const errs = [];
  if (m.emulationOk === false) errs.push('touch emulation did not make the pointer coarse: this profile is not testing the mobile path');
  if (m.errors.length) errs.push(`console errors: ${m.errors.join(' | ')}`);
  if (m.failed.length) errs.push(`failed requests: ${m.failed.join(' | ')}`);
  if (m.overflow > 0) errs.push(`horizontal overflow: ${m.overflow}px`);
  if (m.firstBytes > p.budget.first) errs.push(`first screen ${fmt(m.firstBytes)} > budget ${fmt(p.budget.first)}`);
  if (m.fullBytes > p.budget.full) errs.push(`full scroll ${fmt(m.fullBytes)} > budget ${fmt(p.budget.full)}`);
  if (p.reduced || !p.js) {
    if (m.allClips.length) errs.push(`clips fetched without motion: ${m.allClips.join(', ')}`);
  } else {
    const extra = m.firstClips.filter((c) => !FIRST_SCREEN_CLIPS.includes(c));
    if (extra.length) errs.push(`fetched before scrolling: ${extra.join(', ')}`);
  }
  for (const a of m.acts) {
    if (a.textLen < 20) errs.push(`act ${a.act}: copy missing (${a.textLen} chars)`);
    if (!a.copyVisible) errs.push(`act ${a.act}: copy not visible`);
    if (a.pinnedOk === false) errs.push(`act ${a.act}: stage not pinned at mid-act`);
  }
  return errs;
}

const PROBE = (act) => `(() => {
  const s = document.querySelector('section[data-act="${act}"]');
  const eff = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const els = [...s.querySelectorAll('h1,h2,h3,p')];
  const onScreen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
  const stage = s.querySelector('[data-sc-stage]');
  return {
    textLen: (s.textContent || '').replace(/\\s+/g, ' ').trim().length,
    visible: els.filter((e) => onScreen(e) && eff(e) >= 0.5 && getComputedStyle(e).visibility !== 'hidden').length,
    allVisible: els.every((e) => eff(e) >= 0.99 && getComputedStyle(e).visibility !== 'hidden'),
    stageTop: stage ? stage.getBoundingClientRect().top : 0,
  };
})()`;

// Printed when an act's copy is not visible: engine act state plus each text element's box and effective opacity.
const DIAG = (act) => `(() => {
  const s = document.querySelector('section[data-act="${act}"]');
  const i = window.ScrollCraft && ScrollCraft.instances[0];
  const a = i && i.acts.find((x) => x.el === s);
  const eff = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  return JSON.stringify({
    scrollY: Math.round(scrollY), vh: innerHeight, sectionTop: Math.round(s.getBoundingClientRect().top), sectionH: s.offsetHeight,
    engine: a ? { p: +a.p.toFixed(3), raw: +a.raw.toFixed(3), live: a.live, top: Math.round(a.top), height: Math.round(a.height), cues: a.cues.map((q) => q.el.style.opacity) } : null,
    revealed: s.querySelectorAll('.sc-in').length + '/' + s.querySelectorAll('[data-sc-in], [data-sc-stagger] > *').length,
    els: [...s.querySelectorAll('h1,h2,h3,p')].slice(0, 6).map((e) => { const r = e.getBoundingClientRect(); return [e.tagName, Math.round(r.top), Math.round(r.bottom), Math.round(r.width), +eff(e).toFixed(2), getComputedStyle(e).visibility]; }),
  });
})()`;

const ARRIVED =`(() => { const i = window.ScrollCraft && ScrollCraft.instances[0]; if (!i) return true;
  return i.clips.every((c) => !c.live || (c.ready && !c.el.seeking && Math.abs(c.cur - c.target) < 0.002)); })()`;

async function measure(profileName, base, shots) {
  const p = PROFILES[profileName];
  const browser = await launch();
  try {
    const page = await browser.newPage({ width: p.width, height: p.height, dpr: p.dpr, mobile: p.mobile, touch: p.touch, userAgent: p.ua, reducedMotion: p.reduced });
    if (!p.js) await page.send('Emulation.setScriptExecutionDisabled', { value: true });
    const urls = new Map(), clips = [], errors = [], failed = [];
    let bytes = 0, inflight = 0, lastActivity = Date.now();
    const touch = () => { lastActivity = Date.now(); };
    page.on('Network.requestWillBeSent', (e) => { if (!e.redirectResponse) inflight++; touch(); urls.set(e.requestId, e.request.url); const c = clipId(e.request.url); if (c) clips.push(c); });
    page.on('Network.loadingFinished', (e) => { inflight = Math.max(0, inflight - 1); touch(); bytes += e.encodedDataLength; });
    page.on('Network.loadingFailed', (e) => { inflight = Math.max(0, inflight - 1); touch(); if (!e.canceled) failed.push(`${urls.get(e.requestId) || e.requestId}: ${e.errorText}`); });
    page.on('Network.responseReceived', (e) => { if (e.response.status >= 400) failed.push(`${e.response.url}: HTTP ${e.response.status}`); });
    page.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
    page.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') errors.push(e.args.map((a) => a.value ?? a.description).join(' ')); });
    page.on('Log.entryAdded', (e) => { if (e.entry.level === 'error' && e.entry.source !== 'network') errors.push(`${e.entry.source}: ${e.entry.text}`); });

    const idle = async (quietMs = 1500, maxMs = 30000) => {
      const end = Date.now() + maxMs;
      while (Date.now() < end) { if (inflight === 0 && Date.now() - lastActivity >= quietMs) return; await sleep(100); }
    };
    const settle = async (timeoutMs = 20000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) { if (await page.eval(ARRIVED)) return; await sleep(200); }
      errors.push(`playhead did not arrive within ${timeoutMs} ms`);
    };
    const overflowNow = () => page.eval('document.documentElement.scrollWidth - innerWidth');

    mkdirSync(shots, { recursive: true });
    await page.goto(base);
    await idle();
    const firstBytes = bytes, firstClips = [...new Set(clips)];
    // A touch profile only tests what it claims if the page really sees a coarse pointer (the engine's mobile switch).
    const emulationOk = !p.touch || (await page.eval("matchMedia('(pointer: coarse)').matches"));
    let overflow = await overflowNow();
    writeFileSync(join(shots, '00-top.png'), await page.screenshot());

    const acts = await page.eval(`[...document.querySelectorAll('section[data-act]')].map((s) => ({ act: s.dataset.act, top: s.getBoundingClientRect().top + scrollY, height: s.offsetHeight, pinned: ['scrub', 'pin'].includes(s.getAttribute('data-sc-act')) }))`);
    const results = [];
    for (const [i, a] of acts.entries()) {
      const y = Math.max(0, Math.round(a.pinned ? a.top + (a.height - p.height) / 2 : a.top + a.height / 2 - p.height / 2));
      await page.eval(`window.scrollTo({ top: ${y}, behavior: 'instant' })`);
      await idle();
      if (p.js && !p.reduced) await settle();
      const probe = await page.eval(PROBE(a.act));
      writeFileSync(join(shots, `${String(i + 1).padStart(2, '0')}-act-${a.act}.png`), await page.screenshot());
      // Pinning is asserted only with motion on: under reduced motion the engine may collapse pins.
      results.push({ act: a.act, textLen: probe.textLen, copyVisible: p.js ? probe.visible >= 1 : probe.allVisible, pinnedOk: p.js && !p.reduced && a.pinned ? Math.abs(probe.stageTop) <= 1 : null });
      if (!results.at(-1).copyVisible) console.log(`diag: act ${a.act} target y=${y} ${await page.eval(DIAG(a.act))}`);
      overflow = Math.max(overflow, await overflowNow());
    }
    await page.eval(`window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`);
    await idle();
    return { firstBytes, fullBytes: bytes, firstClips, allClips: [...new Set(clips)], errors, failed, overflow, emulationOk, acts: results };
  } finally { await browser.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const profile = val('--profile'), base = val('--base'), shots = val('--shots', 'shots'), summary = val('--summary', null);
  if (!PROFILES[profile]) throw new Error(`unknown profile ${profile}`);
  const m = await measure(profile, base, shots);
  const errs = evaluate(profile, m);
  const lines = [
    `| profile | first screen | full scroll | clips before scroll | clips total | overflow | problems |`,
    `|---|---:|---:|---|---|---:|---:|`,
    `| ${profile} | ${fmt(m.firstBytes)} | ${fmt(m.fullBytes)} | ${m.firstClips.join(' ') || '-'} | ${m.allClips.join(' ') || '-'} | ${m.overflow} | ${errs.length} |`,
  ];
  for (const l of lines) console.log(`summary: ${l}`);
  for (const e of errs) console.log(`problem: ${e}`);
  if (summary) appendFileSync(summary, `### Check: ${profile}\n\n${lines.join('\n')}\n\n${errs.map((e) => `- ${e}`).join('\n')}\n\n`);
  process.exit(errs.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
