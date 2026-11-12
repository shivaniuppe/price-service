import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIds, ALLOWED_IDS, MAX_IDS } from '../src/validate.js';

test('accepts allowed ids and normalises them', () => {
  assert.deepEqual(parseIds('bitcoin, Ethereum ,ripple'), {
    ok: true,
    ids: ['bitcoin', 'ethereum', 'ripple'],
  });
});

test('removes duplicate ids', () => {
  assert.deepEqual(parseIds('bitcoin,bitcoin'), { ok: true, ids: ['bitcoin'] });
});

test('accepts every id on the allow-list', () => {
  assert.deepEqual(parseIds(ALLOWED_IDS.join(',')), { ok: true, ids: ALLOWED_IDS });
});

test('rejects missing ids', () => {
  for (const raw of [undefined, null, '', '   ']) {
    const result = parseIds(raw);
    assert.equal(result.ok, false);
    assert.match(result.error, /Missing ids/);
  }
});

test('rejects ids that are not strings', () => {
  assert.equal(parseIds(['bitcoin']).ok, false);
});

test('rejects unknown ids and names them', () => {
  const result = parseIds('bitcoin,shibainu,<script>');
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown ids: shibainu, <script>/);
});

test('rejects empty entries in the list', () => {
  const result = parseIds('bitcoin,,ethereum');
  assert.equal(result.ok, false);
  assert.match(result.error, /Empty id/);
});

test(`rejects more than ${MAX_IDS} ids`, () => {
  const result = parseIds(Array(MAX_IDS + 1).fill('bitcoin').join(','));
  assert.equal(result.ok, false);
  assert.match(result.error, /Too many ids/);
});

test(`accepts exactly ${MAX_IDS} ids`, () => {
  assert.equal(parseIds(Array(MAX_IDS).fill('bitcoin').join(',')).ok, true);
});
