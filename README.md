# localediff

**Find drift between your i18n locale files — before your users do.** You add a
string to `en.json`, ship it, and three weeks later notice `fr.json` and
`zh.json` were never updated. `localediff` catches that in CI: missing keys,
plural forms a language actually needs, and keys that exist but were left blank.
Framework-agnostic, **zero dependencies**.

```bash
npx localediff ./locales
```

```
✗ fr.json
  missing (1): auth.errors.locked
  plural  cart.items — has {other}, missing {one}
  empty   (1): footer.copyright
  extra   (1): legacy.banner

✓ zh.json — in sync

✗ 1 of 2 file(s) drifted — 1 missing, 1 plural gap(s), 1 empty, 1 extra
```

## Why another i18n tool

Most existing tools are tied to one framework (i18next-cli only reads i18next),
need an account (Locize), or are heavy AST-based linters. `localediff` just reads
JSON. It compares **structure**, so it works for next-intl, react-intl, i18next,
vue-i18n, or any plain message catalog — and it ships for **both npm and PyPI**
with identical behavior.

### It understands plurals per language

This is the part naive "diff two JSON files" scripts get wrong. English has two
plural forms (`one`, `other`); Chinese has one (`other`); Russian has four
(`one`, `few`, `many`, `other`). A file with only `items_other` is **correct for
Chinese** but **broken for French**. `localediff` resolves the required CLDR
categories from each target's language, so it flags the real bug without crying
wolf on `zh.json`.

```bash
# en base: items_one + items_other
zh.json  →  items_other only   →  ✓ in sync   (Chinese needs only `other`)
fr.json  →  items_other only   →  ✗ missing {one}
ru.json  →  items_one + _other →  ✗ missing {few, many}
```

## Usage

```bash
# Scan a folder. The base defaults to en.json; everything else is checked.
localediff ./locales

# Pick a different base language in the folder.
localediff ./locales --base de

# Compare specific files explicitly.
localediff --base en.json --check fr.json zh.json

# Shorthand: first file is the base.
localediff en.json fr.json zh.json

# Machine-readable output for CI gates.
localediff ./locales --format json
```

This repo ships a set of sample locales (`examples/locales/`) you can run it
against after cloning:

```bash
node bin/cli.js ./examples/locales
```

## What it checks

| Check | Meaning |
|-------|---------|
| **missing** | a key in the base that the target never translated |
| **plural** | a pluralized key (`key_one`, `key_other`, …) missing a CLDR form the **target language** requires |
| **empty** | a key present in the target whose value is a blank string — the slot exists but nobody filled it in |
| **extra** | a key in the target the base no longer has (usually a leftover after a rename/delete) |

Nested objects are flattened to dot-paths (`auth.errors.locked`); arrays are
indexed (`steps.0`). Plural keys use the i18next suffix convention
(`_zero`, `_one`, `_two`, `_few`, `_many`, `_other`).

## Plural language support

The plural check resolves required categories from the target file's language
(inferred from its name — `fr.json` → `fr`, `pt-BR.json` → `pt` — or forced with
`--lang`). Languages covered include CJK + SEA (`other` only), most European
languages (`one`/`other`), the Slavic family (`one`/`few`/`many`/`other`),
Arabic and Welsh (all six forms), and more. **Unknown languages fall back to
parity with the base**, so you never get a confidently-wrong result.

Turn it off entirely with `--ignore-plural`.

## Options

```
--base <file|lang>    base/source locale (a file, or a lang stem in dir mode)
--check <files...>    one or more target locales to compare against the base
--dir <dir>           scan a directory of *.json locales
--lang <code>         force the target language for plural rules
--format text|json    output format (default: text)
--ignore-missing      don't report missing keys
--ignore-extra        don't report extra keys
--ignore-plural       don't report plural gaps
--ignore-empty        don't report empty values
-v, --version
-h, --help
```

## In CI

`localediff` exits non-zero when anything has drifted, so it drops straight into
a pipeline:

```yaml
# .github/workflows/i18n.yml
- run: npx localediff ./locales
```

| Exit code | Meaning |
|-----------|---------|
| `0` | every checked file is in sync |
| `1` | one or more files have drift |
| `2` | error (file not found, invalid JSON, bad arguments) |

## Also available for Python

```bash
pip install localediff
localediff ./locales
```

Same checks, same flags, same exit codes — [localediff-py](https://github.com/jjdoor/localediff-py).

## Scope

JSON locale files only (the common case). YAML/`.properties`/gettext are not
supported — parsing them would mean pulling in a dependency, and zero-dep is the
point. Convert to JSON, or open an issue if you'd like to discuss it.

## License

MIT
