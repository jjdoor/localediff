'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('../src/core.js');
const { formatText, formatJson } = require('../src/report.js');

const base = { a: '1', b: '2', items_one: 'x', items_other: 'y', footer: 'hi' };

function buildResults() {
  const fr = compare(base, { a: 'uno', items_other: 'y', footer: '', legacy: 'old' }, { lang: 'fr' });
  const zh = compare(base, { a: '1', b: '2', items_other: 'y', footer: 'hi' }, { lang: 'zh' });
  return [
    { file: 'fr.json', base: 'en.json', lang: 'fr', report: fr },
    { file: 'zh.json', base: 'en.json', lang: 'zh', report: zh },
  ];
}

test('formatText labels each drift category and an in-sync file', () => {
  const out = formatText(buildResults());
  assert.match(out, /✗ fr\.json/);
  assert.match(out, /missing \(1\): b/);
  assert.match(out, /plural {2}items — has \{other\}, missing \{one\}/);
  assert.match(out, /empty {3}\(1\): footer/);
  assert.match(out, /extra {3}\(1\): legacy/);
  assert.match(out, /✓ zh\.json/);
});

test('formatText summary counts drifted files', () => {
  const out = formatText(buildResults());
  assert.match(out, /✗ 1 of 2 file\(s\) drifted/);
});

test('formatText reports all-in-sync cleanly', () => {
  const ok = compare(base, base, { lang: 'en' });
  const out = formatText([{ file: 'en2.json', base: 'en.json', report: ok }]);
  assert.match(out, /✓ all 1 file\(s\) in sync/);
});

test('formatJson is valid JSON with per-file detail and totals', () => {
  const parsed = JSON.parse(formatJson(buildResults()));
  assert.equal(parsed.checked, 2);
  assert.equal(parsed.drifted, 1);
  assert.equal(parsed.inSync, false);
  assert.equal(parsed.files[0].file, 'fr.json');
  assert.equal(parsed.files[0].counts.missing, 1);
  assert.equal(parsed.files[1].inSync, true);
});
