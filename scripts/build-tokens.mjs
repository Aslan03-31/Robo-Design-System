/**
 * Compiles tokens/*.json into CSS custom properties, plus resolved JSON and ESM
 * exports.
 *
 * Two things happen here that are worth knowing about:
 *
 * 1. Token values may be references (`{palette.sky-blue}`), blends
 *    (`{"mix": [a, b, t]}`) or transparencies (`{"alpha": [c, 0.12]}`).
 *    Everything is flattened to literals so consumers never resolve anything.
 *
 * 2. `on-primary` and `primary-strong` are *computed*, not authored. A brand
 *    primary that cannot carry legible text is a bug you find in production;
 *    computing it here means it fails the build instead.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mix, rgba, contrast, round2, toRgbChannels,
  adjustForContrast, compositeOver, accessibleAgainstAll,
} from './lib/color.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = 'rds';                       // custom-property namespace
const AA_NORMAL = 4.5;                 // WCAG 1.4.3 — body copy
const AA_UI = 3;                       // WCAG 1.4.11 — borders, focus rings, icons
const LIGHT_TEXT = '#FFFFFF';
const DARK_TEXT = '#0D0F12';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const core = readJson(join(ROOT, 'tokens', 'core.json'));

/**
 * Brand order is data, not filesystem order. Sorted alphabetically the parent
 * brand landed third, behind Co-op Lab; $meta.order puts Robo Co-op first and
 * the three entities behind it. Everything downstream — the CSS, the switcher,
 * the palettes, the audit — inherits this sequence, so reordering the system
 * is a one-number edit in a token file.
 */
const brandFiles = readdirSync(join(ROOT, 'tokens', 'brands')).filter((f) => f.endsWith('.json'));
const brands = brandFiles
  .map((f) => readJson(join(ROOT, 'tokens', 'brands', f)))
  .sort((a, b) => (a.$meta.order ?? 99) - (b.$meta.order ?? 99)
                  || a.$meta.slug.localeCompare(b.$meta.slug));

const warnings = [];
const textVariantNotes = [];

/* ------------------------------------------------------------------ values */

function resolveColor(value, palette) {
  if (typeof value === 'string') {
    const ref = value.match(/^\{palette\.([\w-]+)\}$/);
    if (ref) {
      const hit = palette[ref[1]];
      if (!hit) throw new Error(`Unknown palette reference: ${value}`);
      return hit.value;
    }
    return value;
  }
  if (value && value.mix) {
    const [a, b, t] = value.mix;
    return mix(resolveColor(a, palette), resolveColor(b, palette), t);
  }
  if (value && value.alpha) {
    const [c, a] = value.alpha;
    return rgba(resolveColor(c, palette), a);
  }
  throw new Error(`Cannot resolve colour value: ${JSON.stringify(value)}`);
}

/* ------------------------------------------------------- computed contrast */

/**
 * Decide what text colour sits on the brand primary, and whether the primary
 * itself needs nudging to carry it at AA.
 */
function deriveInteractive(primaryHex, preference, label, strategy = 'flip') {
  const wanted = preference === 'dark' ? DARK_TEXT : LIGHT_TEXT;
  const other = preference === 'dark' ? LIGHT_TEXT : DARK_TEXT;

  const wantedRatio = contrast(primaryHex, wanted);
  if (wantedRatio >= AA_NORMAL) {
    return { onPrimary: wanted, primaryStrong: primaryHex, ratio: round2(wantedRatio), adjusted: false };
  }

  // The preferred pairing fails. Under the default 'flip' strategy, try the
  // opposite text colour before touching the brand colour — it keeps the hue
  // exact. Brands that would rather hold their text colour and shift the fill
  // (white-on-red reads as a button; black-on-red does not) opt into 'adjust'.
  const otherRatio = contrast(primaryHex, other);
  if (strategy === 'flip' && otherRatio >= AA_NORMAL) {
    warnings.push(
      `${label}: primary ${primaryHex} cannot carry ${preference} text ` +
      `(${round2(wantedRatio)}:1). Using ${other} instead (${round2(otherRatio)}:1).`
    );
    return { onPrimary: other, primaryStrong: primaryHex, ratio: round2(otherRatio), adjusted: false };
  }

  // Keep the hue, shift lightness by the minimum needed to hold the preferred
  // text colour.
  const { color, steps } = adjustForContrast(primaryHex, wanted, AA_NORMAL,
    preference === 'dark' ? 'lighten' : 'darken');
  warnings.push(
    `${label}: primary ${primaryHex} fails AA with ${preference} text ` +
    `(${round2(wantedRatio)}:1${strategy === 'flip' ? `, and the flip side is ${round2(otherRatio)}:1` : ''}). ` +
    `primary-strong shifted ${steps}% to ${color} (${round2(contrast(color, wanted))}:1). ` +
    `The unmodified brand colour is still exported as --${P}-color-primary.`
  );
  return { onPrimary: wanted, primaryStrong: color, ratio: round2(contrast(color, wanted)), adjusted: true, steps };
}

/* ------------------------------------------------------------------- build */

function buildTheme(brand, themeName) {
  const palette = brand.palette;
  const spec = brand.theme[themeName];
  const out = {};

  for (const [key, value] of Object.entries(spec)) {
    if (key.startsWith('$')) continue;
    out[key] = key === 'shadow-rgb'
      ? toRgbChannels(resolveColor(value, palette))
      : resolveColor(value, palette);
  }

  const label = `${brand.$meta.slug}/${themeName}`;
  const surfaces = [out.surface, out['surface-raised'], out['surface-sunken']];

  /* Authored values are intent; these are the floors the build refuses to ship
   * below. Adjustments are minimal (1% steps) and always logged. */
  const enforce = (key, backdrops, target, why) => {
    const { color, adjusted, steps } = accessibleAgainstAll(out[key], backdrops, target);
    if (adjusted) {
      warnings.push(`${label}: ${key} ${out[key]} -> ${color} (+${steps}%) to reach ${target}:1 — ${why}.`);
      out[key] = color;
    }
  };

  enforce('text',         [out.surface, out['surface-raised'], out['surface-sunken']], AA_NORMAL, 'body copy');
  enforce('text-muted',   [out.surface, out['surface-raised']], AA_NORMAL, 'secondary copy');
  enforce('text-subtle',  [out.surface], AA_UI, 'tertiary copy, large sizes only');
  enforce('border-strong',[out.surface], AA_UI, 'input borders must be perceivable (WCAG 1.4.11)');
  enforce('focus',        [out.surface, out['surface-raised']], AA_UI, 'focus ring must be perceivable');

  /* A brand colour that works as a *fill* rarely works as *text*. Lime on
   * white is 2.1:1. So every semantic colour also gets a foreground-safe
   * sibling, checked against the tinted badge background as well as plain
   * surfaces, since that is the harder backdrop. */
  for (const key of ['primary', 'accent', 'success', 'warning', 'danger', 'info']) {
    if (!out[key]) continue;
    const backdrops = [...surfaces];
    const subtle = out[`${key}-subtle`];
    if (subtle) backdrops.push(compositeOver(subtle, out.surface));

    const { color, adjusted, steps } = accessibleAgainstAll(out[key], backdrops, AA_NORMAL);
    out[`${key}-text`] = color;
    if (adjusted) {
      textVariantNotes.push(`${label}: ${key}-text is ${key} shifted ${steps}% (${out[key]} -> ${color}).`);
    }
  }

  const { onPrimary, primaryStrong, ratio, adjusted, steps } = deriveInteractive(
    out.primary,
    brand.$meta.onPrimaryPreference,
    label,
    spec.$onPrimaryStrategy ?? brand.$meta.onPrimaryStrategy ?? 'flip'
  );
  out['on-primary'] = onPrimary;
  out['primary-strong'] = primaryStrong;

  return { tokens: out, meta: { onPrimaryRatio: ratio, primaryAdjusted: adjusted, adjustSteps: steps ?? 0 } };
}

const resolved = { core: {}, brands: {} };

for (const brand of brands) {
  resolved.brands[brand.$meta.slug] = {
    meta: brand.$meta,
    palette: Object.fromEntries(Object.entries(brand.palette).map(([k, v]) => [k, { ...v }])),
    themes: {
      light: buildTheme(brand, 'light'),
      dark: buildTheme(brand, 'dark'),
    },
  };
}

/* --------------------------------------------------------------- CSS emit  */

const px = (n) => (n === 0 ? '0' : `${n}px`);
const lines = [];
const say = (s = '') => lines.push(s);

say('/*');
say(' * Robo Co-op Design System — design tokens');
say(' * GENERATED FILE. Edit tokens/*.json and run `npm run build`.');
say(' *');
say(' * Usage:  <html data-brand="robo-lab">            follows the OS theme');
say(' *         <html data-brand="robo-lab" data-theme="dark">   forced');
say(' */');
say();

/* core -------------------------------------------------------------------- */
say(':root {');
say('  /* Typography */');
for (const [k, v] of Object.entries(core.font.family)) say(`  --${P}-font-${k}: ${v.value};`);
for (const [k, v] of Object.entries(core.font.weight)) say(`  --${P}-weight-${k}: ${v.value};`);
for (const [k, v] of Object.entries(core.font.size)) {
  const val = v.fluid
    ? `clamp(${px(v.fluid.min)}, calc(1.5rem + 1.5vw), ${px(v.fluid.max)})`
    : px(v.value);
  say(`  --${P}-text-${k}: ${val};${v.pt ? `  /* ${v.pt}pt */` : ''}`);
}
/* Each named role also carries its intended weight, so a component can adopt a
   type style wholesale instead of re-deciding weight at every call site. */
for (const [k, v] of Object.entries(core.font.size)) {
  if (v.weight) say(`  --${P}-text-${k}-weight: var(--${P}-weight-${v.weight});`);
}
say();
say('  /* Aliases — these point at the named roles, they are not new sizes. */');
for (const [alias, target] of Object.entries(core.font.sizeAlias ?? {})) {
  say(`  --${P}-text-${alias}: var(--${P}-text-${target});`);
  const w = core.font.size[target]?.weight;
  if (w) say(`  --${P}-text-${alias}-weight: var(--${P}-weight-${w});`);
}
for (const [k, v] of Object.entries(core.font.lineHeight)) say(`  --${P}-leading-${k}: ${v.value};`);
for (const [k, v] of Object.entries(core.font.letterSpacing)) say(`  --${P}-tracking-${k}: ${v.value};`);

say();
say('  /* Space */');
for (const [k, v] of Object.entries(core.space)) if (!k.startsWith('$')) say(`  --${P}-space-${k}: ${px(v)};`);

say();
say('  /* Radius */');
for (const [k, v] of Object.entries(core.radius)) if (!k.startsWith('$')) say(`  --${P}-radius-${k}: ${px(v)};`);

say();
say('  /* Border */');
for (const [k, v] of Object.entries(core.border)) if (!k.startsWith('$')) say(`  --${P}-border-${k}: ${px(v)};`);

say();
say('  /* Motion */');
for (const [k, v] of Object.entries(core.motion.duration)) say(`  --${P}-duration-${k}: ${v};`);
for (const [k, v] of Object.entries(core.motion.easing)) say(`  --${P}-ease-${k}: ${v};`);

say();
say('  /* Elevation */');
for (const [k, v] of Object.entries(core.elevation)) if (!k.startsWith('$')) say(`  --${P}-elevation-${k}: ${v};`);

say();
say('  /* Layout */');
for (const [k, v] of Object.entries(core.container)) if (!k.startsWith('$')) say(`  --${P}-container-${k}: ${px(v)};`);
say(`  --${P}-focus-width: ${px(core.focus.width)};`);
say(`  --${P}-focus-offset: ${px(core.focus.offset)};`);
say('}');
say();

/* brand palettes ---------------------------------------------------------- */
say('/* Raw brand palettes — always available, never theme-dependent. */');
for (const [slug, b] of Object.entries(resolved.brands)) {
  say(`[data-brand="${slug}"] {`);
  for (const [k, v] of Object.entries(b.palette)) say(`  --${P}-palette-${k}: ${v.value};`);
  say('}');
}
say();

const themeBlock = (tokens, indent = '  ') =>
  Object.entries(tokens).map(([k, v]) => `${indent}--${P}-color-${k}: ${v};`).join('\n');

/* light (default) --------------------------------------------------------- */
say('/* Light is the default; dark follows the OS unless data-theme overrides it. */');
for (const [slug, b] of Object.entries(resolved.brands)) {
  say(`[data-brand="${slug}"] {`);
  say(themeBlock(b.themes.light.tokens));
  say('}');
}
say();

/* dark via OS preference -------------------------------------------------- */
/* Both selectors are anchored to :root on purpose. A nested [data-brand]
 * element — a brand-scoped card inside a page — carries no data-theme of its
 * own, so a guard like `[data-brand=x]:not([data-theme=light])` would still
 * match it and hand it dark tokens while the forced-light root stayed light.
 * Asking the root about the theme keeps nested scopes in step with it.
 * Specificity: (0,3,0) here vs (0,1,0) for the base rule above. */
say('@media (prefers-color-scheme: dark) {');
for (const [slug, b] of Object.entries(resolved.brands)) {
  say(`  :root:not([data-theme="light"])[data-brand="${slug}"],`);
  say(`  :root:not([data-theme="light"]) [data-brand="${slug}"] {`);
  say(themeBlock(b.themes.dark.tokens, '    '));
  say('  }');
}
say('}');
say();

/* dark forced ------------------------------------------------------------- */
say('/* Same (0,3,0) specificity as the media rule above, so source order wins. */');
for (const [slug, b] of Object.entries(resolved.brands)) {
  say(`:root[data-theme="dark"][data-brand="${slug}"],`);
  say(`:root[data-theme="dark"] [data-brand="${slug}"] {`);
  say(themeBlock(b.themes.dark.tokens));
  say('}');
}
say();

/* unbranded fallback ------------------------------------------------------ */
const fallback = resolved.brands['robo-coop'];
say('/* No data-brand set: fall back to the parent brand rather than to nothing. */');
say(':root:not([data-brand]) {');
for (const [k, v] of Object.entries(fallback.palette)) say(`  --${P}-palette-${k}: ${v.value};`);
say(themeBlock(fallback.themes.light.tokens));
say('}');
say('@media (prefers-color-scheme: dark) {');
say('  :root:not([data-brand]):not([data-theme="light"]) {');
say(themeBlock(fallback.themes.dark.tokens, '    '));
say('  }');
say('}');
say();

say('@media (prefers-reduced-motion: reduce) {');
say('  :root {');
for (const k of Object.keys(core.motion.duration)) say(`    --${P}-duration-${k}: 0ms;`);
say('  }');
say('}');

/* --------------------------------------------------------------- write out */

mkdirSync(join(ROOT, 'dist', 'css'), { recursive: true });
writeFileSync(join(ROOT, 'dist', 'css', 'tokens.css'), lines.join('\n') + '\n', 'utf8');

resolved.core = core;
writeFileSync(join(ROOT, 'dist', 'tokens.json'), JSON.stringify(resolved, null, 2) + '\n', 'utf8');

const esm =
  '// GENERATED FILE. Edit tokens/*.json and run `npm run build`.\n' +
  `export const tokens = ${JSON.stringify(resolved, null, 2)};\n` +
  'export const brands = Object.keys(tokens.brands);\nexport default tokens;\n';
writeFileSync(join(ROOT, 'dist', 'tokens.js'), esm, 'utf8');

console.log(`Built tokens for ${brands.length} brands -> dist/css/tokens.css, dist/tokens.json, dist/tokens.js`);
if (warnings.length) {
  console.log('\nAccessibility floors enforced during build:');
  for (const w of warnings) console.log('  * ' + w);
}
if (textVariantNotes.length) {
  console.log(`\nForeground-safe siblings derived (${textVariantNotes.length}):`);
  for (const n of textVariantNotes) console.log('  - ' + n);
}
