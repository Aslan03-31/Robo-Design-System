/**
 * Audits every brand × theme against WCAG 2.1 AA.
 *
 * Runs on the *compiled* tokens, not the authored ones, so it checks what
 * actually ships. Exits non-zero when a required pair fails, which makes it
 * usable as a pre-commit or CI gate.
 *
 *   node scripts/check-contrast.mjs           report + exit code
 *   node scripts/check-contrast.mjs --quiet   exit code only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast, round2, hexToRgb, rgbToHex, grade } from './lib/color.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const tokens = JSON.parse(readFileSync(join(ROOT, 'dist', 'tokens.json'), 'utf8'));

/** Flatten a translucent token onto its backdrop so it can be measured. */
function composite(value, backdropHex) {
  const m = String(value).match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (!m) return value;
  const [, r, g, b, a = '1'] = m;
  const fg = [Number(r), Number(g), Number(b)];
  const bg = hexToRgb(backdropHex);
  const alpha = Number(a);
  return rgbToHex([0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)));
}

/**
 * fg/bg token pairs every theme must satisfy.
 *  level 'text'  -> 4.5:1 (body copy)
 *  level 'large' -> 3:1   (>=24px, or >=18.66px bold)
 *  level 'ui'    -> 3:1   (borders, focus rings, icons — WCAG 1.4.11)
 */
const CHECKS = [
  { fg: 'text',         bg: 'surface',         level: 'text',  severity: 'error', what: 'Body copy on page background' },
  { fg: 'text',         bg: 'surface-raised',  level: 'text',  severity: 'error', what: 'Body copy on cards' },
  { fg: 'text',         bg: 'surface-sunken',  level: 'text',  severity: 'error', what: 'Body copy on sunken wells' },
  { fg: 'text-muted',   bg: 'surface',         level: 'text',  severity: 'error', what: 'Secondary copy on page background' },
  { fg: 'text-muted',   bg: 'surface-raised',  level: 'text',  severity: 'error', what: 'Secondary copy on cards' },
  { fg: 'on-primary',   bg: 'primary-strong',  level: 'text',  severity: 'error', what: 'Button label on primary button' },
  { fg: 'text-inverse', bg: 'surface-inverse', level: 'text',  severity: 'error', what: 'Copy on inverted panels' },

  { fg: 'text-subtle',  bg: 'surface',         level: 'large', severity: 'warn',  what: 'Tertiary copy (large sizes only)' },
  { fg: 'focus',        bg: 'surface',         level: 'ui',    severity: 'error', what: 'Focus ring on page background' },
  { fg: 'focus',        bg: 'surface-raised',  level: 'ui',    severity: 'error', what: 'Focus ring on cards' },
  { fg: 'border-strong',bg: 'surface',         level: 'ui',    severity: 'error', what: 'Input borders (WCAG 1.4.11)' },

  // The `-text` siblings exist precisely to be legible as foreground. If any of
  // these fails, the derivation in build-tokens.mjs is broken.
  { fg: 'primary-text', bg: 'surface',         level: 'text',  severity: 'error', what: 'Brand colour as text / icon' },
  { fg: 'primary-text', bg: 'surface-raised',  level: 'text',  severity: 'error', what: 'Brand colour as text on cards' },
  { fg: 'accent-text',  bg: 'surface',         level: 'text',  severity: 'error', what: 'Accent as text' },
  { fg: 'success-text', bg: 'surface',         level: 'text',  severity: 'error', what: 'Success message text' },
  { fg: 'warning-text', bg: 'surface',         level: 'text',  severity: 'error', what: 'Warning message text' },
  { fg: 'danger-text',  bg: 'surface',         level: 'text',  severity: 'error', what: 'Error message text' },
  { fg: 'info-text',    bg: 'surface',         level: 'text',  severity: 'error', what: 'Info message text' },

  // Badge pattern: the foreground-safe brand colour on a translucent brand tint.
  { fg: 'primary-text', bg: 'primary-subtle', over: 'surface', level: 'text', severity: 'error', what: 'Badge text on tinted badge' },
  { fg: 'accent-text',  bg: 'accent-subtle',  over: 'surface', level: 'text', severity: 'error', what: 'Accent badge text on tint' },
];

const THRESHOLD = { text: 4.5, large: 3, ui: 3 };

const results = [];
let errors = 0, warns = 0;

for (const [slug, brand] of Object.entries(tokens.brands)) {
  for (const themeName of ['light', 'dark']) {
    const t = brand.themes[themeName].tokens;

    for (const check of CHECKS) {
      const backdrop = check.over ? t[check.over] : null;
      const bgRaw = t[check.bg];
      const bg = composite(bgRaw, backdrop ?? '#FFFFFF');
      const fg = composite(t[check.fg], bg);
      if (!fg || !bg) continue;

      const ratio = round2(contrast(fg, bg));
      const need = THRESHOLD[check.level];
      const pass = ratio >= need;
      if (!pass) (check.severity === 'error' ? errors++ : warns++);

      results.push({
        brand: slug, theme: themeName, what: check.what,
        fg: check.fg, bg: check.bg, fgHex: fg, bgHex: bg,
        ratio, need, level: check.level, severity: check.severity, pass,
        grade: grade(ratio, { large: check.level !== 'text' }),
      });
    }
  }
}

writeFileSync(
  join(ROOT, 'dist', 'contrast-report.json'),
  JSON.stringify({ standard: 'WCAG 2.1 AA', errors, warns, results }, null, 2) + '\n',
  'utf8'
);

if (!quiet) {
  const failures = results.filter((r) => !r.pass);
  for (const [slug, brand] of Object.entries(tokens.brands)) {
    console.log(`\n${brand.meta.name}  (${slug})`);
    for (const themeName of ['light', 'dark']) {
      const rows = results.filter((r) => r.brand === slug && r.theme === themeName);
      const bad = rows.filter((r) => !r.pass);
      const worst = rows.reduce((m, r) => Math.min(m, r.ratio), Infinity);
      console.log(`  ${themeName.padEnd(5)}  ${rows.length - bad.length}/${rows.length} pass   lowest ${worst}:1`);
      for (const r of bad) {
        console.log(`      ${r.severity === 'error' ? 'FAIL' : 'warn'}  ${r.what}`);
        console.log(`            ${r.fg} ${r.fgHex} on ${r.bg} ${r.bgHex} = ${r.ratio}:1 (needs ${r.need}:1)`);
      }
    }
  }
  console.log(`\n${results.length} pairs checked — ${errors} failing, ${warns} advisory.`);
  console.log('Report: dist/contrast-report.json');
}

process.exit(errors > 0 ? 1 : 0);
