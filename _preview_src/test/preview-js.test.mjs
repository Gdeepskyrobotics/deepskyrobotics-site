import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'preview', 'preview.js'), 'utf8');

function harness({ scrollcraft = true, gtag = true, io = true } = {}) {
  const calls = [], mounts = [];
  let observerCb = null;
  const sections = ['1', '2', '3'].map((act) => ({ getAttribute: (n) => (n === 'data-act' ? act : null) }));
  const body = { tag: 'body' };
  const ctx = vm.createContext({
    document: { body, querySelectorAll: (sel) => (sel === 'section[data-act]' ? sections : []) },
  });
  ctx.window = ctx;
  if (scrollcraft) ctx.ScrollCraft = { mount: (root) => mounts.push(root) };
  // JSON round-trip: objects built inside the vm carry its realm's prototypes, which deepStrictEqual rejects.
  if (gtag) ctx.gtag = (...a) => calls.push(JSON.parse(JSON.stringify(a)));
  if (io) ctx.IntersectionObserver = class { constructor(cb) { observerCb = cb; } observe() {} };
  vm.runInContext(CODE, ctx);
  const enter = (i, isIntersecting = true) => observerCb([{ target: sections[i], isIntersecting }]);
  return { calls, mounts, body, enter };
}

test('mounts the engine once, on document.body', () => {
  const h = harness();
  assert.deepEqual(h.mounts, [h.body]);
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
