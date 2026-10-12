import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, clipId, evaluate } from '../check.mjs';

const ok = (over = {}) => ({
  firstBytes: 0.5e6, fullBytes: 2e6, firstClips: ['s1-drift'], allClips: ['s1-drift', 's2-trace'],
  errors: [], failed: [], overflow: 0,
  acts: [{ act: '1', textLen: 80, copyVisible: true, pinnedOk: true }],
  ...over,
});

test('six profiles with the agreed budgets', () => {
  assert.deepEqual(Object.keys(PROFILES), ['desktop', 'mobile', 'desktop-reduced', 'mobile-reduced', 'tablet-touch', 'desktop-nojs']);
  assert.deepEqual(PROFILES.desktop.budget, { full: 6e6, first: 1.5e6 });
  assert.deepEqual(PROFILES.mobile.budget, { full: 3e6, first: 0.8e6 });
  assert.equal(PROFILES['desktop-reduced'].budget.full, 0.8e6);
  assert.equal(PROFILES['desktop-nojs'].js, false);
});

test('clipId reads desktop and mobile clip URLs', () => {
  assert.equal(clipId('http://127.0.0.1:8080/preview/media/s1-drift.mp4'), 's1-drift');
  assert.equal(clipId('http://127.0.0.1:8080/preview/media/s3-console-m.mp4'), 's3-console');
  assert.equal(clipId('http://127.0.0.1:8080/preview/posters/s1-drift.webp'), null);
});

test('a clean measurement passes', () => {
  assert.deepEqual(evaluate('desktop', ok()), []);
});

test('each failure is reported', () => {
  assert.equal(evaluate('desktop', ok({ fullBytes: 6.1e6 })).length, 1);
  assert.equal(evaluate('mobile', ok({ firstBytes: 0.9e6 })).length, 1);
  assert.equal(evaluate('desktop', ok({ firstClips: ['s1-drift', 's2-trace'] })).length, 1);
  assert.equal(evaluate('desktop-reduced', ok({ fullBytes: 0.5e6, allClips: ['s1-drift'] })).length, 1);
  assert.equal(evaluate('desktop', ok({ errors: ['TypeError: x'] })).length, 1);
  assert.equal(evaluate('desktop', ok({ failed: ['/x.webp: HTTP 404'] })).length, 1);
  assert.equal(evaluate('mobile', ok({ overflow: 12 })).length, 1);
  assert.equal(evaluate('desktop', ok({ acts: [{ act: '1', textLen: 80, copyVisible: true, pinnedOk: false }] })).length, 1);
  assert.equal(evaluate('desktop', ok({ acts: [{ act: '2', textLen: 3, copyVisible: false, pinnedOk: true }] })).length, 2);
  assert.equal(evaluate('tablet-touch', ok({ emulationOk: false })).length, 1);
});
