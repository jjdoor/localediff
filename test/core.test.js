'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  flatten, splitPlural, pluralGroups, requiredCategories, normalizeLang, compare,
} = require('../src/core.js');

test('flatten produces dot-paths in document order', () => {
  const entries = flatten({ a: { b: 1, c: 2 }, d: 3 });
  assert.deepEqual(entries, [
    { path: 'a.b', value: 1 },
    { path: 'a.c', value: 2 },
    { path: 'd', value: 3 },
  ]);
});

test('flatten indexes arrays and keeps empty containers as leaves', () => {
  const entries = flatten({ list: ['x', 'y'], blank: {}, none: [] });
  assert.deepEqual(entries.map((e) => e.path), ['list.0', 'list.1', 'blank', 'none']);
});

test('splitPlural recognizes CLDR suffixes only', () => {
  assert.deepEqual(splitPlural('items_one'), { stem: 'items', category: 'one' });
  assert.deepEqual(splitPlural('a.b.count_many'), { stem: 'a.b.count', category: 'many' });
  assert.equal(splitPlural('items'), null);
  assert.equal(splitPlural('step_two_factor'), null); // suffix must be the tail
});

test('pluralGroups keeps only groups containing "other"', () => {
  const entries = flatten({
    items_one: 'a', items_other: 'b', // real plural
    step_one: 'x', step_two: 'y',     // NOT a plural (no `other`)
  });
  const groups = pluralGroups(entries);
  assert.deepEqual([...groups.keys()], ['items']);
  assert.deepEqual([...groups.get('items')], ['one', 'other']);
});

test('normalizeLang strips region/script subtags', () => {
  assert.equal(normalizeLang('zh-Hans-CN'), 'zh');
  assert.equal(normalizeLang('pt_BR'), 'pt');
  assert.equal(normalizeLang('FR'), 'fr');
  assert.equal(normalizeLang(''), '');
});

test('requiredCategories uses the CLDR table, falls back to base parity', () => {
  assert.deepEqual(requiredCategories('zh', new Set(['one', 'other'])), ['other']);
  assert.deepEqual(requiredCategories('ru', new Set(['one', 'other'])), ['one', 'few', 'many', 'other']);
  // unknown language -> parity with base categories
  assert.deepEqual(requiredCategories('xx', new Set(['one', 'other'])), ['one', 'other']);
});

test('compare: missing and extra plain keys', () => {
  const base = { a: '1', b: '2', nested: { c: '3' } };
  const target = { a: 'uno', nested: { c: 'tres', d: 'cuatro' } };
  const r = compare(base, target, { lang: 'es' });
  assert.deepEqual(r.missing, ['b']);
  assert.deepEqual(r.extra, ['nested.d']);
  assert.equal(r.inSync, false);
});

test('compare: empty values flagged only when base has real text', () => {
  const base = { a: 'hello', b: 'world', c: '' };
  const target = { a: '', b: '   ', c: '' };
  const r = compare(base, target, { lang: 'de' });
  // a and b are blank in target while base has text; c is blank in both -> ignored
  assert.deepEqual(r.empty, ['a', 'b']);
});

test('compare: plural gap respects target language (the headline feature)', () => {
  const base = { items_one: '{{count}} item', items_other: '{{count}} items' };

  // Chinese only needs `other` — an `_other`-only file is CORRECT, no gap.
  const zh = compare(base, { items_other: '件' }, { lang: 'zh' });
  assert.equal(zh.plural.length, 0);
  assert.equal(zh.inSync, true);

  // French needs one+other — the same `_other`-only shape IS a bug.
  const fr = compare(base, { items_other: 'articles' }, { lang: 'fr' });
  assert.equal(fr.plural.length, 1);
  assert.deepEqual(fr.plural[0], { stem: 'items', required: ['one', 'other'], have: ['other'], missing: ['one'] });

  // Russian needs four forms — flags few+many even though the base lacks them.
  const ru = compare(base, { items_one: 'товар', items_other: 'товара' }, { lang: 'ru' });
  assert.deepEqual(ru.plural[0].missing, ['few', 'many']);
});

test('compare: plural members do not double-report as missing keys', () => {
  const base = { items_one: 'a', items_other: 'b' };
  const target = {}; // target has neither form
  const r = compare(base, target, { lang: 'fr' });
  assert.deepEqual(r.missing, []);            // not reported as raw missing keys
  assert.equal(r.plural.length, 1);
  assert.deepEqual(r.plural[0].have, []);     // fully untranslated
});

test('compare: ordinary _one/_two keys are treated as plain keys, not plurals', () => {
  const base = { step_one: 'First', step_two: 'Second' };
  const target = { step_one: 'Premier' };
  const r = compare(base, target, { lang: 'fr' });
  assert.equal(r.plural.length, 0);
  assert.deepEqual(r.missing, ['step_two']);
});

test('compare: ignore flags suppress their category and can reach inSync', () => {
  const base = { a: '1', b: '2' };
  const target = { a: 'uno', c: 'tres' };
  const full = compare(base, target, { lang: 'es' });
  assert.equal(full.inSync, false);
  const r = compare(base, target, { lang: 'es', ignoreMissing: true, ignoreExtra: true });
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.extra, []);
  assert.equal(r.inSync, true);
});

test('compare: identical locales are in sync', () => {
  const base = { a: '1', nested: { b: '2' }, items_one: 'x', items_other: 'y' };
  const r = compare(base, JSON.parse(JSON.stringify(base)), { lang: 'en' });
  assert.equal(r.inSync, true);
  assert.deepEqual(r.counts, { missing: 0, extra: 0, plural: 0, empty: 0 });
});
