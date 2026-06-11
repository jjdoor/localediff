#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../src/core.js');
const report = require('../src/report.js');

const VERSION = require('../package.json').version;

// ----- tiny color helpers (no dep) -----
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const col = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const COLORS = {
  red: (s) => col('31', s), green: (s) => col('32', s), yellow: (s) => col('33', s),
  cyan: (s) => col('36', s), dim: (s) => col('2', s), bold: (s) => col('1', s),
};
const red = COLORS.red;

const HELP = `${COLORS.bold('localediff')} — find drift between i18n locale files. Framework-agnostic, zero deps.

${COLORS.bold('Usage')}
  localediff --base en.json --check fr.json zh.json   compare files explicitly
  localediff ./locales                                scan a dir (base: en.json)
  localediff ./locales --base de                      scan a dir, base de.json
  localediff en.json fr.json zh.json                  first file is the base

${COLORS.bold('What it finds')}
  missing  key in the base, never translated in the target
  plural   pluralized key missing a CLDR form the target language needs
  empty    key present in the target but its value is blank
  extra    key in the target the base no longer has

${COLORS.bold('Options')}
  --base <file|lang>    base/source locale (a file, or a lang stem in dir mode)
  --check <files...>    one or more target locales to compare against the base
  --dir <dir>           scan a directory of *.json locales
  --lang <code>         force the target language for plural rules (else inferred
                        from each file name, e.g. fr.json -> fr)
  --format text|json    output format (default: text)
  --ignore-missing      don't report missing keys
  --ignore-extra        don't report extra keys
  --ignore-plural       don't report plural gaps
  --ignore-empty        don't report empty values
  -v, --version
  -h, --help

${COLORS.bold('Exit')}  0 in sync · 1 drift found · 2 error
`;

function fail(msg) {
  process.stderr.write(red(`localediff: ${msg}\n`));
  process.exit(2);
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return fail(`cannot read ${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return fail(`invalid JSON in ${file}: ${e.message}`);
  }
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}
function has(args, name) { return args.includes(name); }

// Values after --check up to the next --flag.
function collectCheck(args) {
  const i = args.indexOf('--check');
  if (i === -1) return [];
  const out = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]);
  return out;
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function langStem(file) {
  return path.basename(file).replace(/\.json$/i, '');
}

// Resolve { baseFile, checkFiles, opts, format } from argv.
function resolveInputs(args) {
  const opts = {
    ignoreMissing: has(args, '--ignore-missing'),
    ignoreExtra: has(args, '--ignore-extra'),
    ignorePlural: has(args, '--ignore-plural'),
    ignoreEmpty: has(args, '--ignore-empty'),
  };
  const format = flag(args, '--format') || 'text';
  if (!['text', 'json'].includes(format)) fail('--format must be text or json');
  const forcedLang = flag(args, '--lang');

  // Mark consumed indices so the leftovers are true positionals.
  const consumed = new Set();
  for (const f of ['--base', '--format', '--dir', '--lang']) {
    const i = args.indexOf(f);
    if (i !== -1) { consumed.add(i); consumed.add(i + 1); }
  }
  const ci = args.indexOf('--check');
  if (ci !== -1) {
    consumed.add(ci);
    for (let j = ci + 1; j < args.length && !args[j].startsWith('--'); j++) consumed.add(j);
  }
  const positionals = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));

  const baseArg = flag(args, '--base');
  const checkArgs = collectCheck(args);
  let dir = flag(args, '--dir');
  if (!dir && positionals.length === 1 && isDir(positionals[0])) dir = positionals[0];

  let baseFile, checkFiles;
  if (dir) {
    if (!isDir(dir)) fail(`not a directory: ${dir}`);
    const jsons = fs.readdirSync(dir).filter((f) => /\.json$/i.test(f)).sort();
    if (jsons.length === 0) fail(`no .json locale files in ${dir}`);
    const baseLang = baseArg ? langStem(baseArg) : 'en';
    const baseName = jsons.find((f) => langStem(f) === baseLang);
    if (!baseName) fail(`base locale "${baseLang}.json" not found in ${dir} (have: ${jsons.join(', ')})`);
    baseFile = path.join(dir, baseName);
    checkFiles = jsons.filter((f) => f !== baseName).map((f) => path.join(dir, f));
    if (checkFiles.length === 0) fail(`only the base locale is present in ${dir}; nothing to compare`);
  } else if (baseArg && checkArgs.length) {
    baseFile = baseArg;
    checkFiles = checkArgs;
  } else if (positionals.length >= 2) {
    baseFile = positionals[0];
    checkFiles = positionals.slice(1);
  } else {
    fail('nothing to compare. Try:  localediff --base en.json --check fr.json   or   localediff ./locales');
  }
  return { baseFile, checkFiles, opts, format, forcedLang };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (args[0] === '-v' || args[0] === '--version') {
    process.stdout.write(VERSION + '\n');
    process.exit(0);
  }

  const { baseFile, checkFiles, opts, format, forcedLang } = resolveInputs(args);
  const base = readJson(baseFile);

  const results = checkFiles.map((file) => {
    const lang = forcedLang || core.normalizeLang(langStem(file));
    return {
      file,
      base: baseFile,
      lang,
      report: core.compare(base, readJson(file), { ...opts, lang }),
    };
  });

  if (format === 'json') {
    process.stdout.write(report.formatJson(results) + '\n');
  } else {
    process.stdout.write(report.formatText(results, useColor ? COLORS : report.PLAIN) + '\n');
  }

  process.exit(results.some((r) => !r.report.inSync) ? 1 : 0);
}

main();
