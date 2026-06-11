'use strict';

/**
 * Formatting for localediff reports. Pure: takes the per-file results plus a
 * color palette and returns a string. No IO.
 */

const PLAIN = {
  red: (s) => s, green: (s) => s, yellow: (s) => s,
  cyan: (s) => s, dim: (s) => s, bold: (s) => s,
};

/**
 * Render per-file results as human-readable text.
 * @param {Array<{file:string, lang?:string, report:object}>} results
 * @param {object} [c] color palette (defaults to no color)
 * @returns {string}
 */
function formatText(results, c = PLAIN) {
  const lines = [];
  let driftFiles = 0;
  const totals = { missing: 0, extra: 0, plural: 0, empty: 0 };

  for (const { file, report } of results) {
    if (report.inSync) {
      lines.push(`${c.green('✓')} ${c.bold(file)} ${c.dim('— in sync')}`);
      continue;
    }
    driftFiles++;
    lines.push(`${c.red('✗')} ${c.bold(file)}`);
    if (report.missing.length) {
      lines.push(`  ${c.yellow('missing')} (${report.missing.length}): ${report.missing.join(', ')}`);
    }
    for (const p of report.plural) {
      const detail = p.have.length
        ? `has {${p.have.join(',')}}, missing {${p.missing.join(',')}}`
        : `untranslated, needs {${p.missing.join(',')}}`;
      lines.push(`  ${c.cyan('plural')}  ${p.stem} — ${detail}`);
    }
    if (report.empty.length) {
      lines.push(`  ${c.dim('empty')}   (${report.empty.length}): ${report.empty.join(', ')}`);
    }
    if (report.extra.length) {
      lines.push(`  ${c.dim('extra')}   (${report.extra.length}): ${report.extra.join(', ')}`);
    }
    lines.push('');
    for (const k of Object.keys(totals)) totals[k] += report.counts[k];
  }

  const summary = driftFiles === 0
    ? c.green(`✓ all ${results.length} file(s) in sync`)
    : c.red(`✗ ${driftFiles} of ${results.length} file(s) drifted`)
      + c.dim(` — ${totals.missing} missing, ${totals.plural} plural gap(s), `
        + `${totals.empty} empty, ${totals.extra} extra`);
  lines.push(summary);
  return lines.join('\n');
}

/**
 * Render results as machine-readable JSON for CI consumption.
 * @param {Array<{file:string, base:string, lang?:string, report:object}>} results
 * @returns {string}
 */
function formatJson(results) {
  const files = results.map(({ file, base, lang, report }) => ({
    file,
    base,
    lang: lang || null,
    inSync: report.inSync,
    missing: report.missing,
    plural: report.plural,
    empty: report.empty,
    extra: report.extra,
    counts: report.counts,
  }));
  const drifted = files.filter((f) => !f.inSync).length;
  return JSON.stringify(
    { base: results.length ? results[0].base : null, checked: files.length, drifted, inSync: drifted === 0, files },
    null,
    2,
  );
}

module.exports = { formatText, formatJson, PLAIN };
