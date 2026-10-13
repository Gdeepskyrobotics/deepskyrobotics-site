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

test('a reader already down the page keeps their place when the engine mounts', () => {
  // Four acts, one screen each before the mount; the mount stretches them to their spans (3.2, 2.6, 2.6, 1.8 x 900).
  const vh = 900, post = [2880, 2340, 2340, 1620];
  let heights = [900, 900, 900, 900], y = 2000;
  const scrolls = [], listeners = {};
  const topOf = (i) => heights.slice(0, i).reduce((a, b) => a + b, 0);
  const sections = heights.map((_, i) => ({
    getAttribute: (n) => (n === 'data-act' ? String(i + 1) : null),
    getBoundingClientRect: () => ({ top: topOf(i) - y, bottom: topOf(i) + heights[i] - y, height: heights[i] }),
  }));
  const ctx = vm.createContext({
    document: { body: {}, documentElement: { classList: { add() {} } }, querySelectorAll: (sel) => (sel === 'section[data-act]' ? sections : []) },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    innerHeight: vh,
    scrollTo: (o) => { scrolls.push(JSON.parse(JSON.stringify(o))); y = o.top; },
    ScrollCraft: { mount: () => { heights = post; } },
  });
  Object.defineProperty(ctx, 'scrollY', { get: () => y });
  ctx.window = ctx;
  vm.runInContext(CODE, ctx);
  listeners.scroll.forEach((fn) => fn({ type: 'scroll' }));
  // Mid-screen (2450) was 650/900 through act 3; after the mount it is the same fraction through act 3's 2340 px.
  const want = 2880 + 2340 + (650 / 900) * 2340 - vh / 2;
  assert.equal(scrolls.length, 1);
  assert.ok(Math.abs(scrolls[0].top - want) < 1, `scrolled to ${scrolls[0].top}, want ${want}`);
  assert.equal(scrolls[0].behavior, 'instant');
});

test('arriving on a #fragment mounts at once and puts the reader on that element', () => {
  // The engine's html{scroll-behavior:smooth} turns a fragment arrival into a glide; mounting on its first scroll
  // event would strand the reader part-way. With a target in the URL the engine mounts immediately instead.
  const mounts = [], intoView = [], listeners = {};
  const contact = { scrollIntoView: (o) => intoView.push(JSON.parse(JSON.stringify(o))) };
  const ctx = vm.createContext({
    location: { hash: '#contact' },
    document: { body: {}, documentElement: { classList: { add() {} } }, getElementById: (id) => (id === 'contact' ? contact : null), querySelectorAll: () => [] },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((g) => g !== fn); },
    scrollY: 0, innerHeight: 900,
    ScrollCraft: { mount: (root) => mounts.push(root) },
  });
  ctx.window = ctx;
  vm.runInContext(CODE, ctx);
  assert.equal(mounts.length, 1);
  assert.deepEqual(intoView, [{ block: 'start', behavior: 'instant' }]);
  (listeners.scroll || []).forEach((fn) => fn({ type: 'scroll' }));
  assert.equal(mounts.length, 1);
});

test('a fragment that names no element, or a malformed one, waits for the reader as usual', () => {
  for (const hash of ['#nope', '#%E0%A4%A']) {
    const mounts = [];
    const ctx = vm.createContext({
      location: { hash },
      document: { body: {}, documentElement: { classList: { add() {} } }, getElementById: () => null, querySelectorAll: () => [] },
      addEventListener() {}, removeEventListener() {},
      ScrollCraft: { mount: (root) => mounts.push(root) },
    });
    ctx.window = ctx;
    assert.doesNotThrow(() => vm.runInContext(CODE, ctx), hash);
    assert.equal(mounts.length, 0, hash);
  }
});
