// render.mjs: renders the preview's clips and posters. CI only (Chrome + ffmpeg); never run on the workstation.
import { mkdirSync, rmSync, writeFileSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { launch, sleep, waitFor } from './cdp.mjs';

export const CLIPS = [
  { id: 's1-drift', kind: 'scene' },
  { id: 's2-trace', kind: 'scene' },
  // crfOffset: the console recording is the heaviest clip; +3 CRF keeps the desktop page inside its 6 MB budget.
  { id: 's3-console', kind: 'console', seconds: 6, fps: 30, msPerFrame: 200, posterT: 0, crfOffset: 3 },
  { id: 's4-fork', kind: 'scene' },
];
export const VARIANTS = {
  desktop: { suffix: '', w: 1920, h: 1080, crf: 23, g: 8 },
  mobile: { suffix: '-m', w: 720, h: 1280, crf: 26, g: 4 },
};
// Mobile console clip: the centre of the desktop capture as a landscape inset (even height for yuv420p).
export const CONSOLE_MOBILE_VF = 'crop=1600:900:160:90,scale=720:406:flags=lanczos,setsar=1';

export const clipCrf = (clip, v) => v.crf + (clip.crfOffset || 0);

export function selectClips(arg) {
  if (!arg || arg === 'all') return CLIPS;
  const ids = arg.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !CLIPS.some((c) => c.id === id));
  if (unknown.length) throw new Error(`unknown clip id(s): ${unknown.join(', ')}`);
  return CLIPS.filter((c) => ids.includes(c.id));
}
export function encodeArgs({ framesDir, fps, crf, g, vf, out }) {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', join(framesDir, '%05d.png'),
    ...(vf ? ['-vf', vf] : []), '-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p',
    '-crf', String(crf), '-g', String(g), '-movflags', '+faststart', '-an', out];
}
export function posterArgs({ png, vf, out }) {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-i', png, ...(vf ? ['-vf', vf] : []),
    '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', out];
}
export const frameName = (i) => String(i).padStart(5, '0') + '.png';
export const posterIndex = (posterT, n) => Math.round(Math.min(1, Math.max(0, posterT)) * (n - 1));

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg exited ${r.status}: ffmpeg ${args.join(' ')}`);
}

async function renderScene(browser, base, clip, v, work) {
  const page = await browser.newPage({ width: v.w, height: v.h });
  try {
    await page.goto(`${base}/_preview_src/scenes/${clip.id}.html?w=${v.w}&h=${v.h}`);
    const meta = await page.eval('window.__scene || null');
    if (!meta) throw new Error(`${clip.id}: the scene never called defineScene()`);
    const n = Math.round(meta.seconds * meta.fps);
    const dir = join(work, clip.id + v.suffix);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < n; i++) {
      await page.eval(`window.__frame(${n === 1 ? 0 : i / (n - 1)})`);
      writeFileSync(join(dir, frameName(i)), await page.screenshot());
    }
    return { dir, n, fps: meta.fps, posterT: meta.posterT };
  } finally { await page.close(); }
}

const CONSOLE_READY = "(() => { const r = document.getElementById('root'); return !!r && r.querySelectorAll('*').length > 50; })()";

async function openConsole(browser, base) {
  const v = VARIANTS.desktop;
  const page = await browser.newPage({ width: v.w, height: v.h });
  await page.goto(`${base}/console/index.html`, 120000);
  await waitFor(page, CONSOLE_READY, 120000); // in-browser Babel compiles the bundle first
  await sleep(4000); // let the simulated data reach its first steady state
  return page;
}

async function captureConsole(browser, base, clip, work) {
  const n = clip.seconds * clip.fps;
  const dir = join(work, clip.id);
  mkdirSync(dir, { recursive: true });
  let page = await openConsole(browser, base);
  try {
    // Deterministic: pause virtual time, then advance it msPerFrame per frame (a time-lapse of the live console).
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    for (let i = 0; i < n; i++) {
      const expired = page.once('Emulation.virtualTimeBudgetExpired', 10000);
      await page.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: clip.msPerFrame });
      await expired;
      writeFileSync(join(dir, frameName(i)), await page.screenshot());
    }
    return { dir, n, deterministic: true };
  } catch (err) {
    console.warn(`summary: virtual time failed (${err.message}); falling back to real-time capture`);
    await page.close().catch(() => {});
    page = await openConsole(browser, base); // virtual time cannot be switched back off: use a fresh page
    for (let i = 0; i < n; i++) {
      writeFileSync(join(dir, frameName(i)), await page.screenshot());
      await sleep(clip.msPerFrame);
    }
    return { dir, n, deterministic: false };
  } finally { await page.close().catch(() => {}); }
}

function row(file, frames = '', note = '') { return { file, bytes: statSync(file).size, frames, note }; }

function report(rows, summaryFile) {
  const lines = ['| file | bytes | frames | note |', '|---|---:|---:|---|',
    ...rows.map((r) => `| ${r.file} | ${r.bytes} | ${r.frames} | ${r.note} |`)];
  for (const l of lines) console.log(`summary: ${l}`);
  if (summaryFile) appendFileSync(summaryFile, `### Render\n\n${lines.join('\n')}\n\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const base = val('--base'), out = val('--out', 'preview'), summary = val('--summary', null);
  if (!base) throw new Error('--base is required');
  const clips = selectClips(val('--clips', 'all'));
  const work = join(tmpdir(), 'preview-frames');
  rmSync(work, { recursive: true, force: true });
  const mediaDir = join(out, 'media'), posterDir = join(out, 'posters');
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync(posterDir, { recursive: true });
  const rows = [];
  const browser = await launch();
  try {
    for (const clip of clips) {
      if (clip.kind === 'scene') {
        for (const v of Object.values(VARIANTS)) {
          const r = await renderScene(browser, base, clip, v, work);
          const mp4 = join(mediaDir, `${clip.id}${v.suffix}.mp4`), webp = join(posterDir, `${clip.id}${v.suffix}.webp`);
          ffmpeg(encodeArgs({ framesDir: r.dir, fps: r.fps, crf: clipCrf(clip, v), g: v.g, out: mp4 }));
          ffmpeg(posterArgs({ png: join(r.dir, frameName(posterIndex(r.posterT, r.n))), out: webp }));
          rows.push(row(mp4, r.n), row(webp));
          rmSync(r.dir, { recursive: true, force: true });
        }
      } else {
        const r = await captureConsole(browser, base, clip, work);
        for (const v of Object.values(VARIANTS)) {
          const vf = v.suffix ? CONSOLE_MOBILE_VF : null;
          const mp4 = join(mediaDir, `${clip.id}${v.suffix}.mp4`), webp = join(posterDir, `${clip.id}${v.suffix}.webp`);
          ffmpeg(encodeArgs({ framesDir: r.dir, fps: clip.fps, crf: clipCrf(clip, v), g: v.g, vf, out: mp4 }));
          ffmpeg(posterArgs({ png: join(r.dir, frameName(posterIndex(clip.posterT, r.n))), vf, out: webp }));
          rows.push(row(mp4, r.n, r.deterministic ? '' : 'non-deterministic capture'), row(webp));
        }
        rmSync(r.dir, { recursive: true, force: true });
      }
    }
  } finally { await browser.close(); }
  report(rows, summary);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
