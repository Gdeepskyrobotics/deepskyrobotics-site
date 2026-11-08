import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNIPPET = /<script data-ga="mailto">([\s\S]*?)<\/script>/;
const PAGES = ['index.html', 'nfo.html', 'preview/index.html'].filter((p) => existsSync(join(root, p)));

function snippetFrom(file) {
  const m = SNIPPET.exec(readFileSync(join(root, file), 'utf8'));
  assert.ok(m, `${file} has no <script data-ga="mailto"> block`);
  // index.html and nfo.html are stored with CRLF in git and new files with LF, so compare the code, not the line ends.
  return m[1].replace(/\r\n/g, '\n');
}

function harness(code, { withGtag = true } = {}) {
  const calls = [];
  let handler = null;
  const context = { document: { addEventListener(type, fn) { if (type === 'click') handler = fn; } } };
  // JSON round-trip: objects built inside the vm carry its realm's prototypes, which deepStrictEqual rejects.
  if (withGtag) context.gtag = (...args) => calls.push(JSON.parse(JSON.stringify(args)));
  vm.createContext(context);
  vm.runInContext(code, context);
  const click = (href) => {
    const anchor = { getAttribute: (n) => (n === 'href' ? href : null) };
    const target = { closest: (sel) => (sel === 'a[href^="mailto:"]' && href.startsWith('mailto:') ? anchor : null) };
    handler({ target });
  };
  return { calls, click };
}

test('index.html and nfo.html carry the snippet, byte-identical', () => {
  assert.ok(PAGES.includes('index.html') && PAGES.includes('nfo.html'));
  const first = snippetFrom(PAGES[0]);
  for (const p of PAGES) assert.equal(snippetFrom(p), first, `${p} differs`);
});

test('sends mailto_click with the decoded subject', () => {
  const h = harness(snippetFrom('index.html'));
  h.click('mailto:info@deepskyrobotics.com?subject=Demo%20request');
  assert.deepEqual(h.calls, [['event', 'mailto_click', { link_subject: 'Demo request' }]]);
});

test('no subject is reported as "none"', () => {
  const h = harness(snippetFrom('index.html'));
  h.click('mailto:info@deepskyrobotics.com');
  assert.deepEqual(h.calls, [['event', 'mailto_click', { link_subject: 'none' }]]);
});

test('a non-mailto link sends nothing', () => {
  const h = harness(snippetFrom('index.html'));
  h.click('/nfo.html');
  assert.deepEqual(h.calls, []);
});

test('a malformed escape is sent raw, without throwing', () => {
  const h = harness(snippetFrom('index.html'));
  h.click('mailto:info@deepskyrobotics.com?subject=%E0%A4%A');
  assert.deepEqual(h.calls, [['event', 'mailto_click', { link_subject: '%E0%A4%A' }]]);
});

test('a blocked gtag is a silent no-op', () => {
  const h = harness(snippetFrom('index.html'), { withGtag: false });
  assert.doesNotThrow(() => h.click('mailto:info@deepskyrobotics.com?subject=Founding%20pilot'));
});
