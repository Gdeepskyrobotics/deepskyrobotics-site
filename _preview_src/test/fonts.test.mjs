import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFontCss, slug, fontFaceCss } from '../fonts.mjs';

const CSS = `/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/cyr.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/lat.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+2192;
}`;

test('parseFontCss reads every block with its subset', () => {
  const f = parseFontCss(CSS);
  assert.equal(f.length, 2);
  assert.deepEqual(f[1], { subset: 'latin', family: 'Inter', style: 'normal', weight: '400 900', url: 'https://fonts.gstatic.com/s/inter/v20/lat.woff2', unicodeRange: 'U+0000-00FF, U+2192' });
});

test('slug', () => {
  assert.equal(slug('JetBrains Mono'), 'jetbrains-mono');
});

test('fontFaceCss points at local files and keeps the unicode-range', () => {
  const css = fontFaceCss([{ family: 'Inter', style: 'normal', weight: '400 900', file: 'inter-400-900-latin.woff2', unicodeRange: 'U+0000-00FF' }]);
  assert.match(css, /font-family:'Inter'/);
  assert.match(css, /src:url\(inter-400-900-latin\.woff2\) format\('woff2'\)/);
  assert.match(css, /unicode-range:U\+0000-00FF/);
  assert.match(css, /font-display:swap/);
});
