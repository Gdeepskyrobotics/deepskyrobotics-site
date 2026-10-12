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
  // A 1366x768 laptop's browser window: short screens are where Act 3's console frame can meet the nav and its caption.
  'desktop-short': { width: 1366, height: 657, dpr: 1, mobile: false, touch: false, reduced: false, js: true, budget: { full: 6.0 * MB, first: 1.5 * MB } },
};
export const ALL_CLIPS = ['s1-drift', 's2-trace', 's3-console', 's4-fork'];
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
  if (p.js && m.mounted !== true) errs.push('the engine did not mount after the first scroll');
  if (m.framesTimedOut) errs.push(`${m.framesTimedOut} animation-frame wait(s) timed out: the page did not render`);
  if (p.js && !p.reduced) {
    const missing = ALL_CLIPS.filter((c) => !m.allClips.includes(c));
    if (missing.length) errs.push(`clips never fetched with motion on: ${missing.join(', ')}`);
  }
  if (m.firstScreenActs && !m.firstScreenActs.includes('1')) errs.push('first screen does not show act 1 copy');
  if (p.js && (m.anchorMounted === false || (m.anchorTop != null && Math.abs(m.anchorTop) > 0.5))) {
    errs.push(`a reader on #contact lost their place when the engine mounted (contact top at ${m.anchorTop} viewports, mounted ${m.anchorMounted})`);
  }
  if (m.consoleFrame && !m.consoleFrame.ok) errs.push(`act 3: the console frame meets the nav or its caption (${m.consoleFrame.detail})`);
  const stray = (m.firstScreenActs || []).filter((a) => a !== '1');
  if (stray.length) errs.push(`first screen shows copy from act(s) ${stray.join(', ')}: stages overlap before the engine mounts`);
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

// After a scroll: two frames let scroll handlers, the engine's tick and observer callbacks run (timeout-guarded).
const FRAMES = 'Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), new Promise((r) => setTimeout(() => r(false), 2000))])';
const ANIMATING = "document.getAnimations().some((a) => a.playState === 'running')";

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

// Acts whose copy is on the first screen, before any scroll (no JS, or before the engine mounts). Only act 1 belongs there.
const FIRST_SCREEN_ACTS = `(() => {
  const eff = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && eff(e) > 0.05 && getComputedStyle(e).visibility !== 'hidden'; };
  return [...document.querySelectorAll('section[data-act]')].filter((s) => [...s.querySelectorAll('h1,h2,h3,p')].some(shown)).map((s) => s.dataset.act);
})()`;

// Act 3's frame must sit below the sticky nav and above its caption.
const CONSOLE_FRAME = `(() => {
  const s = document.querySelector('section[data-act="3"]');
  const nav = document.querySelector('nav');
  const fr = s.querySelector('.sc-stage__poster').getBoundingClientRect();
  const cap = s.querySelector('.console-caption').getBoundingClientRect();
  const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
  return { ok: fr.height > 0 && fr.top >= navBottom - 1 && cap.top >= fr.bottom - 1,
    detail: 'nav ' + Math.round(navBottom) + ', frame ' + Math.round(fr.top) + '-' + Math.round(fr.bottom) + ', caption ' + Math.round(cap.top) };
})()`;
const MOUNTED = "!!(window.ScrollCraft && ScrollCraft.instances.length === 1 && document.documentElement.classList.contains('sc-js'))";

const ARRIVED = `(() => { const i = window.ScrollCraft && ScrollCraft.instances[0]; if (!i) return true;
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
    // Reveal transitions (flow sections, 620 ms plus stagger) must finish before the copy is judged.
    const calm = async (timeoutMs = 5000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) { if (!(await page.eval(ANIMATING))) return; await sleep(100); }
    };
    let framesTimedOut = 0;
    const frames = async () => { if (!(await page.eval(FRAMES))) framesTimedOut++; };
    const overflowNow = () => page.eval('document.documentElement.scrollWidth - innerWidth');

    mkdirSync(shots, { recursive: true });
    await page.goto(base);
    console.log(`diag: page ${await page.eval("document.visibilityState + ' focus=' + document.hasFocus()")}`);
    await idle();
    const firstBytes = bytes, firstClips = [...new Set(clips)];
    // A touch profile only tests what it claims if the page really sees a coarse pointer (the engine's mobile switch).
    const emulationOk = !p.touch || (await page.eval("matchMedia('(pointer: coarse)').matches"));
    let overflow = await overflowNow();
    writeFileSync(join(shots, '00-top.png'), await page.screenshot());
    const firstScreenActs = await page.eval(FIRST_SCREEN_ACTS);

    // preview.js mounts the engine on the reader's first interaction, and mounting sizes the pinned acts. Make that
    // first scroll (1 px and back) before reading any act geometry, or every scroll target uses the pre-mount layout.
    if (p.js) {
      for (const top of [1, 0]) { await page.eval(`window.scrollTo({ top: ${top}, behavior: 'instant' })`); await frames(); }
      await idle();
    }
    const mounted = p.js ? await page.eval(MOUNTED) : false;

    const acts = await page.eval(`[...document.querySelectorAll('section[data-act]')].map((s) => ({ act: s.dataset.act, top: s.getBoundingClientRect().top + scrollY, height: s.offsetHeight, pinned: ['scrub', 'pin'].includes(s.getAttribute('data-sc-act')) }))`);
    const results = [];
    let consoleFrame = null;
    for (const [i, a] of acts.entries()) {
      const y = Math.max(0, Math.round(a.pinned ? a.top + (a.height - p.height) / 2 : a.top + a.height / 2 - p.height / 2));
      await page.eval(`window.scrollTo({ top: ${y}, behavior: 'instant' })`);
      // idle() only waits for the network, which is already quiet on most acts: let the page react to the scroll first.
      if (p.js) await frames();
      await idle();
      if (p.js && !p.reduced) await settle();
      if (p.js) await calm();
      const probe = await page.eval(PROBE(a.act));
      if (a.act === '3') consoleFrame = await page.eval(CONSOLE_FRAME);
      writeFileSync(join(shots, `${String(i + 1).padStart(2, '0')}-act-${a.act}.png`), await page.screenshot());
      // Pinning is asserted only with motion on: under reduced motion the engine may collapse pins.
      results.push({ act: a.act, textLen: probe.textLen, copyVisible: p.js ? probe.visible >= 1 : probe.allVisible, pinnedOk: p.js && !p.reduced && a.pinned ? Math.abs(probe.stageTop) <= 1 : null });
      if (!results.at(-1).copyVisible) console.log(`diag: act ${a.act} target y=${y} ${await page.eval(DIAG(a.act))}`);
      overflow = Math.max(overflow, await overflowNow());
    }
    await page.eval(`window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })`);
    await idle();
    const fullBytes = bytes, allClips = [...new Set(clips)];

    // A reader who arrives down the page (a #contact link, a reload, Back) must keep their place when the engine mounts
    // on their first scroll. The query string forces a real load rather than a same-document fragment jump.
    let anchorTop = null, anchorMounted = null;
    if (p.js) {
      await page.goto(`${base}?anchor=1#contact`);
      await idle();
      await page.eval("window.scrollBy({ top: 1, behavior: 'instant' })");
      await frames(); await idle(); await frames();
      anchorMounted = await page.eval(MOUNTED);
      anchorTop = +(await page.eval("document.getElementById('contact').getBoundingClientRect().top / innerHeight")).toFixed(2);
      writeFileSync(join(shots, '90-anchor-contact.png'), await page.screenshot());
    }
    return { firstBytes, fullBytes, firstClips, allClips, errors, failed, overflow, emulationOk, firstScreenActs, mounted, framesTimedOut, consoleFrame, anchorTop, anchorMounted, acts: results };
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
