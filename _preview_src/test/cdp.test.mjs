import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFramer } from '../cdp.mjs';

test('one message per NUL, across and within chunks', () => {
  const got = [];
  const feed = createFramer((m) => got.push(m));
  feed(Buffer.from('{"id":1,"result":{}}\0{"id"'));
  feed(Buffer.from(':2,"result":{"a":"é"}}\0'));
  feed(Buffer.from('\0'));
  assert.deepEqual(got, [{ id: 1, result: {} }, { id: 2, result: { a: 'é' } }]);
});

test('a multi-byte character split across chunks survives', () => {
  const got = [];
  const feed = createFramer((m) => got.push(m));
  const bytes = Buffer.from('{"s":"→"}\0');
  feed(bytes.subarray(0, 7));
  feed(bytes.subarray(7));
  assert.deepEqual(got, [{ s: '→' }]);
});
