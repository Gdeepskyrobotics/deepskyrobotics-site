import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { CLIPS, VARIANTS, selectClips, encodeArgs, posterArgs, frameName, posterIndex } from '../render.mjs';

test('four clips, two variants with the agreed encode settings', () => {
  assert.deepEqual(CLIPS.map((c) => c.id), ['s1-drift', 's2-trace', 's3-console', 's4-fork']);
  assert.deepEqual(VARIANTS.desktop, { suffix: '', w: 1920, h: 1080, crf: 20, g: 8 });
  assert.deepEqual(VARIANTS.mobile, { suffix: '-m', w: 720, h: 1280, crf: 24, g: 4 });
});

test('selectClips: all, a list, and unknown ids', () => {
  assert.equal(selectClips('all').length, 4);
  assert.equal(selectClips(undefined).length, 4);
  assert.deepEqual(selectClips('s4-fork, s1-drift').map((c) => c.id), ['s1-drift', 's4-fork']);
  assert.throws(() => selectClips('s9-nope'), /unknown clip id/);
});

test('encodeArgs: H.264, yuv420p, faststart, no audio, crf and GOP from the variant', () => {
  const a = encodeArgs({ framesDir: 'f', fps: 30, crf: 20, g: 8, out: 'o.mp4' });
  for (const pair of [['-framerate', '30'], ['-c:v', 'libx264'], ['-pix_fmt', 'yuv420p'], ['-crf', '20'], ['-g', '8'], ['-movflags', '+faststart']]) {
    assert.equal(a[a.indexOf(pair[0]) + 1], pair[1], pair[0]);
  }
  assert.ok(a.includes('-an'));
  assert.equal(a[a.indexOf('-i') + 1], join('f', '%05d.png'));
  assert.equal(a.at(-1), 'o.mp4');
  assert.ok(!a.includes('-vf'));
  const b = encodeArgs({ framesDir: 'f', fps: 30, crf: 24, g: 4, vf: 'scale=720:406', out: 'm.mp4' });
  assert.equal(b[b.indexOf('-vf') + 1], 'scale=720:406');
});

test('posterArgs: one webp frame', () => {
  const a = posterArgs({ png: 'p.png', out: 'p.webp' });
  assert.equal(a[a.indexOf('-c:v') + 1], 'libwebp');
  assert.equal(a[a.indexOf('-frames:v') + 1], '1');
  assert.equal(a.at(-1), 'p.webp');
});

test('frameName and posterIndex', () => {
  assert.equal(frameName(7), '00007.png');
  assert.equal(posterIndex(0, 150), 0);
  assert.equal(posterIndex(1, 150), 149);
  assert.equal(posterIndex(0.5, 150), 75);
  assert.equal(posterIndex(2, 150), 149);
});
