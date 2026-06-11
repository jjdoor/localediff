'use strict';

/**
 * localediff core — pure locale-comparison logic. No fs, no clock, no network.
 *
 * Given a base locale object (the source of truth, e.g. en.json) and a target
 * locale object (e.g. fr.json), find where they have drifted apart:
 *
 *   - missing keys   the base has a key the target never translated
 *   - extra keys     the target still has a key the base has dropped
 *   - plural gaps    the target is missing a CLDR plural form its own language
 *                    requires (i18next `_one` / `_other` / `_few` ... suffixes)
 *   - empty values   the key exists in the target but its string is blank
 *
 * Comparison is structural and framework-agnostic: nested objects/arrays are
 * flattened to dot-paths, so it works for next-intl, react-intl, i18next,
 * vue-i18n, or any plain JSON message catalog.
 *
 * The plural check is CLDR-aware on purpose. A naive "the target must have every
 * form the base has" rule false-positives on languages with fewer plural
 * categories than English — Chinese/Japanese/Korean only ever need `other`, so
 * an `items_other`-only zh.json is *correct*, while the same shape in fr.json is
 * a real bug. We resolve the required categories from the target's language.
 */

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL_RE = /^(.+)_(zero|one|two|few|many|other)$/;

/**
 * CLDR cardinal plural categories needed for everyday integer counts, keyed by
 * language. Conservative on purpose — only languages we're confident about are
 * listed; anything else falls back to parity with the base (see
 * requiredCategories). Decimal-only categories (e.g. Romance "many" for compact
 * millions) are deliberately omitted to avoid noisy false positives.
 */
const LANG_PLURALS = {
  // no count distinction — `other` is the only form
  zh: ['other'], ja: ['other'], ko: ['other'], vi: ['other'],
  th: ['other'], id: ['other'], ms: ['other'], lo: ['other'],
  km: ['other'], my: ['other'], yo: ['other'],
  // one / other (the large majority)
  en: ['one', 'other'], de: ['one', 'other'], nl: ['one', 'other'],
  sv: ['one', 'other'], da: ['one', 'other'], nb: ['one', 'other'],
  nn: ['one', 'other'], no: ['one', 'other'], fi: ['one', 'other'],
  es: ['one', 'other'], it: ['one', 'other'], pt: ['one', 'other'],
  fr: ['one', 'other'], ca: ['one', 'other'], gl: ['one', 'other'],
  el: ['one', 'other'], hu: ['one', 'other'], tr: ['one', 'other'],
  fa: ['one', 'other'], hi: ['one', 'other'], bg: ['one', 'other'],
  et: ['one', 'other'], eu: ['one', 'other'], af: ['one', 'other'],
  // Slavic & friends: one / few / many / other
  ru: ['one', 'few', 'many', 'other'], uk: ['one', 'few', 'many', 'other'],
  pl: ['one', 'few', 'many', 'other'], be: ['one', 'few', 'many', 'other'],
  lt: ['one', 'few', 'many', 'other'],
  // one / few / other
  cs: ['one', 'few', 'other'], sk: ['one', 'few', 'other'],
  hr: ['one', 'few', 'other'], sr: ['one', 'few', 'other'],
  ro: ['one', 'few', 'other'],
  // smaller sets
  lv: ['zero', 'one', 'other'], sl: ['one', 'two', 'few', 'other'],
  // all six
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
  cy: ['zero', 'one', 'two', 'few', 'many', 'other'],
};

/**
 * Normalize a locale tag to its base language code: "zh-Hans-CN" -> "zh",
 * "pt_BR" -> "pt", "EN" -> "en".
 * @param {string} tag
 * @returns {string}
 */
function normalizeLang(tag) {
  return String(tag || '').toLowerCase().split(/[-_]/)[0];
}

/**
 * Flatten a nested object/array into an ordered list of leaf entries, in
 * document order (depth-first). `{a:{b:1}, c:[2,3]}` becomes
 * [{path:'a.b',value:1}, {path:'c.0',value:2}, {path:'c.1',value:3}].
 * Empty objects/arrays are kept as leaves so their key still participates.
 * @param {*} obj
 * @returns {Array<{path:string, value:*}>}
 */
function flatten(obj) {
  const out = [];
  walk(obj, '', out);
  return out;
}

function walk(value, prefix, out) {
  if (value !== null && typeof value === 'object') {
    const isArr = Array.isArray(value);
    const keys = isArr ? value.map((_, i) => String(i)) : Object.keys(value);
    if (keys.length === 0) { out.push({ path: prefix, value }); return; }
    for (const k of keys) {
      const child = isArr ? value[Number(k)] : value[k];
      walk(child, prefix === '' ? k : `${prefix}.${k}`, out);
    }
  } else {
    out.push({ path: prefix, value });
  }
}

/**
 * If `path` ends with a CLDR plural suffix, return {stem, category}; else null.
 * "items_one" -> {stem:'items', category:'one'}.
 * @param {string} path
 */
function splitPlural(path) {
  const m = PLURAL_RE.exec(path);
  return m ? { stem: m[1], category: m[2] } : null;
}

/**
 * Group plural-suffixed leaf paths by stem. Only stems whose category set
 * includes `other` (the form i18next always requires) count as real plural
 * groups — this keeps ordinary keys like `step_one` from being mistaken for a
 * plural. Returns Map<stem, Set<category>> in first-seen order.
 * @param {Array<{path:string}>} entries
 */
function pluralGroups(entries) {
  const groups = new Map();
  for (const { path } of entries) {
    const sp = splitPlural(path);
    if (!sp) continue;
    if (!groups.has(sp.stem)) groups.set(sp.stem, new Set());
    groups.get(sp.stem).add(sp.category);
  }
  for (const [stem, cats] of groups) {
    if (!cats.has('other')) groups.delete(stem);
  }
  return groups;
}

function orderCats(catSet) {
  return PLURAL_CATEGORIES.filter((c) => catSet.has(c));
}

/**
 * The plural categories a target file should define for a count-based key,
 * given its language. Falls back to the base's own categories when the language
 * is unknown (parity), which is the right default for the common en->X case.
 * @param {string} lang  normalized language code (may be empty)
 * @param {Set<string>} baseCats
 * @returns {string[]}
 */
function requiredCategories(lang, baseCats) {
  const table = LANG_PLURALS[lang];
  return table ? table.slice() : orderCats(baseCats);
}

function isBlank(value) {
  return typeof value === 'string' && value.trim() === '';
}

/**
 * Compare a target locale against the base. Returns a structured drift report.
 *
 * @param {object} base    parsed base locale (source of truth)
 * @param {object} target  parsed target locale
 * @param {object} [opts]  { lang, ignoreMissing, ignoreExtra, ignorePlural, ignoreEmpty }
 * @returns {{missing:string[], extra:string[],
 *            plural:Array<{stem:string, required:string[], have:string[], missing:string[]}>,
 *            empty:string[], counts:object, inSync:boolean}}
 */
function compare(base, target, opts = {}) {
  const baseEntries = flatten(base);
  const targetEntries = flatten(target);

  const basePlurals = pluralGroups(baseEntries);
  const targetPlurals = pluralGroups(targetEntries);
  const pluralStems = new Set(basePlurals.keys());

  // Members of a base plural group are handled by the plural analysis, not the
  // plain key diff — so a missing `_one` surfaces as a plural gap, not a raw
  // missing key. Target members of those same stems are likewise excluded.
  const inBasePluralStem = (path) => {
    const sp = splitPlural(path);
    return !!sp && pluralStems.has(sp.stem);
  };

  const basePlain = baseEntries.filter((e) => !inBasePluralStem(e.path));
  const targetPlain = targetEntries.filter((e) => !inBasePluralStem(e.path));

  const targetPlainPaths = new Set(targetPlain.map((e) => e.path));
  const basePlainPaths = new Set(basePlain.map((e) => e.path));
  const baseValue = new Map(baseEntries.map((e) => [e.path, e.value]));

  const missing = basePlain.filter((e) => !targetPlainPaths.has(e.path)).map((e) => e.path);
  const extra = targetPlain.filter((e) => !basePlainPaths.has(e.path)).map((e) => e.path);

  // Plural gaps: per base plural stem, which CLDR categories does the target's
  // language require that the target is missing? `have:[]` means fully missing.
  const lang = normalizeLang(opts.lang);
  const plural = [];
  for (const [stem, baseCats] of basePlurals) {
    const tCats = targetPlurals.get(stem) || new Set();
    const required = requiredCategories(lang, baseCats);
    const missingCats = required.filter((c) => !tCats.has(c));
    if (missingCats.length > 0) {
      plural.push({ stem, required, have: orderCats(tCats), missing: missingCats });
    }
  }

  // Empty values: key present in target with a blank string, where the base has
  // real text — i.e. the slot exists but nobody filled it in.
  const empty = [];
  for (const e of targetEntries) {
    const bv = baseValue.get(e.path);
    if (isBlank(e.value) && typeof bv === 'string' && !isBlank(bv)) empty.push(e.path);
  }

  const report = {
    missing: opts.ignoreMissing ? [] : missing,
    extra: opts.ignoreExtra ? [] : extra,
    plural: opts.ignorePlural ? [] : plural,
    empty: opts.ignoreEmpty ? [] : empty,
  };
  report.counts = {
    missing: report.missing.length,
    extra: report.extra.length,
    plural: report.plural.length,
    empty: report.empty.length,
  };
  report.inSync = report.counts.missing === 0 && report.counts.extra === 0
    && report.counts.plural === 0 && report.counts.empty === 0;
  return report;
}

module.exports = {
  flatten, splitPlural, pluralGroups, requiredCategories, normalizeLang,
  compare, PLURAL_CATEGORIES, LANG_PLURALS,
};
