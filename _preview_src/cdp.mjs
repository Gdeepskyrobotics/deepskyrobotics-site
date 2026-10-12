// cdp.mjs: a zero-dependency Chrome DevTools client. Chrome reads commands on fd 3 and writes on fd 4
// (--remote-debugging-pipe), one JSON message per NUL. CI only: the workstation never launches Chrome.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createFramer(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let i;
    while ((i = buf.indexOf(0)) !== -1) {
      const text = buf.subarray(0, i).toString('utf8');
      buf = buf.subarray(i + 1);
      if (text) onMessage(JSON.parse(text));
    }
  };
}

export async function waitFor(page, expression, timeoutMs, everyMs = 250) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await page.eval(expression)) return;
    await sleep(everyMs);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for: ${expression}`);
}

export async function launch({ chrome = process.env.CHROME || 'google-chrome', args = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
  const proc = spawn(chrome, [
    '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--user-data-dir=${profile}`, ...args, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const toChrome = proc.stdio[3];
  const fromChrome = proc.stdio[4];
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  const key = (method, sessionId) => `${sessionId || ''}|${method}`;

  fromChrome.on('data', createFramer((msg) => {
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message} (${msg.error.code})`)); else resolve(msg.result);
      return;
    }
    const set = listeners.get(key(msg.method, msg.sessionId));
    if (set) for (const fn of [...set]) fn(msg.params);
  }));
  const exited = new Promise((r) => proc.on('exit', r));
  proc.on('exit', () => { for (const { reject, method } of pending.values()) reject(new Error(`${method}: Chrome exited`)); pending.clear(); });

  function send(method, params = {}, sessionId) {
    const id = nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      toChrome.write(JSON.stringify(payload) + '\0');
    });
  }
  function on(method, fn, sessionId) {
    const k = key(method, sessionId);
    if (!listeners.has(k)) listeners.set(k, new Set());
    listeners.get(k).add(fn);
    return () => listeners.get(k).delete(fn);
  }
  function once(method, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const off = on(method, (p) => { clearTimeout(timer); off(); resolve(p); }, sessionId);
      const timer = setTimeout(() => { off(); reject(new Error(`timed out waiting for ${method}`)); }, timeoutMs);
    });
  }

  async function newPage({ width, height, dpr = 1, mobile = false, touch = false, userAgent, reducedMotion = false }) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    await Promise.all([s('Page.enable'), s('Runtime.enable'), s('Network.enable'), s('Log.enable')]);
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
    if (touch) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (userAgent) await s('Emulation.setUserAgentOverride', { userAgent });
    await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
    return {
      send: s,
      on: (m, fn) => on(m, fn, sessionId),
      once: (m, t) => once(m, sessionId, t),
      async goto(url, timeoutMs = 60000) {
        const loaded = once('Page.loadEventFired', sessionId, timeoutMs);
        const r = await s('Page.navigate', { url });
        if (r.errorText) throw new Error(`navigate ${url}: ${r.errorText}`);
        await loaded;
      },
      async eval(expression) {
        const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
        return r.result.value;
      },
      async screenshot() {
        const { data } = await s('Page.captureScreenshot', { format: 'png' });
        return Buffer.from(data, 'base64');
      },
      async close() { await send('Target.closeTarget', { targetId }); },
    };
  }

  async function close() {
    try { await send('Browser.close'); } catch { /* already gone */ }
    await Promise.race([exited, sleep(3000)]);
    proc.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true });
  }

  return { send, on, once, newPage, close };
}
