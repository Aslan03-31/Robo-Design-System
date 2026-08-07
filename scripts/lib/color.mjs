/** Minimal colour maths. No dependencies — this repo stays installable offline. */

export function hexToRgb(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a hex colour: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * Blend two colours in sRGB, matching CSS `color-mix(in srgb, ...)` and the
 * blending designers see in Figma/Illustrator.
 * @param t weight of `b` — mix(a, b, 0) === a, mix(a, b, 1) === b
 */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t));
}

/** WCAG 2.1 relative luminance. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1..21. */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const round2 = (n) => Math.round(n * 100) / 100;

/** `#RRGGBB` -> `R G B`, for use inside rgb()/rgba() with a slash alpha. */
export const toRgbChannels = (hex) => hexToRgb(hex).join(' ');

export const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(', ')}, ${a})`;

/**
 * Nudge `color` toward black (or white) by the smallest amount that reaches
 * `target` contrast against `against`. Returns the original when it already
 * passes, so brand colours are left alone unless they genuinely fail.
 */
export function adjustForContrast(color, against, target = 4.5, direction = 'auto') {
  if (contrast(color, against) >= target) return { color, adjusted: false, steps: 0 };

  const dir = direction === 'auto'
    ? (luminance(against) > 0.5 ? 'darken' : 'lighten')
    : direction;
  const anchor = dir === 'darken' ? '#000000' : '#FFFFFF';

  // 1% steps: fine enough to be imperceptible, coarse enough to terminate fast.
  for (let t = 0.01; t <= 1.0001; t += 0.01) {
    const candidate = mix(color, anchor, t);
    if (contrast(candidate, against) >= target) {
      return { color: candidate, adjusted: true, steps: Math.round(t * 100) };
    }
  }
  return { color: anchor, adjusted: true, steps: 100 };
}

/** Flatten `rgba(...)` (or a plain hex) onto an opaque backdrop. */
export function compositeOver(value, backdropHex) {
  const m = String(value).match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (!m) return value;
  const [, r, g, b, a = '1'] = m;
  const fg = [Number(r), Number(g), Number(b)];
  const bg = hexToRgb(backdropHex);
  const alpha = Number(a);
  return rgbToHex([0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)));
}

/**
 * Shift `color` until it clears `target` against *every* backdrop it will be
 * seen on. Direction is chosen from the backdrops themselves, so this works
 * unchanged in light and dark themes.
 */
export function accessibleAgainstAll(color, backdrops, target = 4.5) {
  const beds = backdrops.filter(Boolean);
  if (!beds.length) return { color, adjusted: false, steps: 0 };

  const worst = () => Math.min(...beds.map((b) => contrast(color, b)));
  if (worst() >= target) return { color, adjusted: false, steps: 0 };

  // Backdrops are light -> go darker; dark -> go lighter.
  const meanL = beds.reduce((s, b) => s + luminance(b), 0) / beds.length;
  const anchor = meanL > 0.5 ? '#000000' : '#FFFFFF';

  for (let t = 0.01; t <= 1.0001; t += 0.01) {
    const candidate = mix(color, anchor, t);
    if (Math.min(...beds.map((b) => contrast(candidate, b))) >= target) {
      return { color: candidate, adjusted: true, steps: Math.round(t * 100) };
    }
  }
  return { color: anchor, adjusted: true, steps: 100 };
}

/** WCAG AA/AAA verdict for a foreground/background pair. */
export function grade(ratio, { large = false } = {}) {
  const aa = large ? 3 : 4.5;
  const aaa = large ? 4.5 : 7;
  if (ratio >= aaa) return 'AAA';
  if (ratio >= aa) return 'AA';
  return 'FAIL';
}
