import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREVIEW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'preview');
const CODE = readFileSync(join(PREVIEW, 'preview.js'), 'utf8');
const INTERACTIONS = ['scroll', 'wheel', 'touchstart', 'keydown', 'pointerdown'];

function harness({ scrollcraft = true, gtag = true, io = true } = {}) {
  const calls = [], mounts = [], classes = new Set(), listeners = {};
  let observerCb = null;
  const sections = ['1', '2', '3'].map((act) => ({ getAttribute: (n) => (n === 'data-act' ? act : null) }));
  const body = { tag: 'body' };
  const ctx = vm.createContext({
    document: { body, documentElement: { classList: { add: (c) => classes.add(c) } }, querySelectorAll: (sel) => (sel === 'section[data-act]' ? sections : []) },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
  });
  ctx.window = ctx;
  if (scrollcraft) ctx.ScrollCraft = { mount: (root) => mounts.push(root) };
  // JSON round-trip: objects built inside the vm carry its realm's prototypes, which deepStrictEqual rejects.
  if (gtag) ctx.gtag = (...a) => calls.push(JSON.parse(JSON.stringify(a)));
  if (io) ctx.IntersectionObserver = class { constructor(cb) { observerCb = cb; } observe() {} };
  vm.runInContext(CODE, ctx);
  const enter = (i, isIntersecting = true) => observerCb([{ target: sections[i], isIntersecting }]);
  const fire = (type) => (listeners[type] || []).slice().forEach((fn) => fn({ type }));
  return { calls, mounts, body, classes, enter, fire };
}

test('the engine waits for the reader: no mount and no sc-js before the first interaction', () => {
  const h = harness();
  assert.deepEqual(h.mounts, []);
  assert.equal(h.classes.has('sc-js'), false);
});

test('mounts once, on document.body, at the first scroll, wheel, touch, key or pointer', () => {
  for (const type of INTERACTIONS) {
    const h = harness();
    h.fire(type); h.fire('scroll'); h.fire(type);
    assert.equal(h.mounts.length, 1, type);
    assert.equal(h.mounts[0], h.body, type);
    assert.ok(h.classes.has('sc-js'), type);
  }
});

test('engine missing: the first scroll leaves the page in its no-JS state (all copy visible)', () => {
  const h = harness({ scrollcraft: false });
  assert.doesNotThrow(() => h.fire('scroll'));
  assert.equal(h.classes.has('sc-js'), false);
});

test('the page itself never adds sc-js: only preview.js does, at mount', () => {
  assert.doesNotMatch(readFileSync(join(PREVIEW, 'index.html'), 'utf8'), /classList\.add\(['"]sc-js['"]\)/);
});

test('story_act fires once per act, only when it crosses the middle of the viewport', () => {
  const h = harness();
  h.enter(0); h.enter(0); h.enter(1, false); h.enter(2);
  assert.deepEqual(h.calls, [['event', 'story_act', { act: '1' }], ['event', 'story_act', { act: '3' }]]);
});

test('no engine, no gtag, no IntersectionObserver: nothing throws', () => {
  assert.doesNotThrow(() => harness({ scrollcraft: false, gtag: false, io: false }));
  const h = harness({ gtag: false });
  assert.doesNotThrow(() => h.enter(0));
});
