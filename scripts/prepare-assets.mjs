/**
 * Normalises the four Robo Co-op logo sets into one predictable tree.
 *
 * Source filenames are inconsistent across brands ("Primary" vs "<name>.svg",
 * "NO BG" vs "No BG" vs "Black BG"), and "Black BG" describes the *intended
 * backdrop*, not a black rectangle in the file. This script resolves all of
 * that once, so nothing downstream has to know about it.
 *
 * For each brand it emits three lockups (mark / horizontal / vertical), each in
 * up to three finishes:
 *   <lockup>.svg          brand-coloured, transparent
 *   <lockup>-inverse.svg  for dark surfaces (only where it differs)
 *   <lockup>-boxed.svg    sits on its own white plate, for photos
 *   <lockup>-current.svg  fill:currentColor, inherits from CSS
 *
 * ...plus a manifest.json so consumers resolve by (brand, lockup, theme)
 * instead of guessing filenames.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'C:/Users/aslan/Desktop/Robo/LOGO';

/** The one place that knows about the messy source names. */
const BRANDS = {
  'robo-coop': {
    name: 'Robo Co-op',
    primary: '#000000',
    svgDir: 'ROBO CO_OP LOGO/Robo Co-op SVGs',
    pngDir: 'ROBO CO_OP LOGO/Robo Co-op PNGs',
    // The Robo Co-op mark ships unfilled, so it renders black. It is the only
    // brand whose mark is invisible on a dark surface, hence real inverse art.
    lockups: {
      mark: {
        base: 'Robo Co-op.svg',
        inverse: 'Robo Co-op Black.svg',
      },
      horizontal: {
        base: 'Robo Co-op Horizontal Text No BG.svg',
        inverse: 'Robo Co-op Horizontal Text Black BG.svg',
        boxed: 'Robo Co-op Horizontal Text White BG.svg',
      },
      vertical: {
        base: 'Robo Co-op Vertical text No BG.svg',
        inverse: 'Robo Co-op Vertical text Black BG.svg',
        boxed: 'Robo Co-op Vertical text White BG.svg',
      },
    },
  },
  'robo-lab': {
    name: 'Robo Lab',
    primary: '#007DD1',
    svgDir: 'ROBO LAB/Robo Lab SVGs',
    pngDir: 'ROBO LAB/Robo Lab PNGs',
    lockups: {
      mark: { base: 'Robo Lab Primary.svg', boxed: 'Robo Lab White BG.svg' },
      // Sourced from the White BG master, plate stripped. The "Black BG" file
      // paints a solid black rect behind the artwork, so it is not usable as a
      // transparent lockup.
      horizontal: { base: 'Robo Lab Horizontal Text White BG.svg', boxed: 'Robo Lab Horizontal Text White BG.svg' },
      vertical: { base: 'Robo Lab vertical Text NO BG.svg', boxed: 'Robo Lab vertical Text White BG.svg' },
    },
  },
  'coop-lab': {
    name: 'Co-op Lab',
    primary: '#FF3F33',
    svgDir: 'CO-OP LAB/Co-op Lab SVGs',
    pngDir: 'CO-OP LAB/Co-op Lab PNGs',
    lockups: {
      mark: { base: 'Co-op Lab Primary.svg', boxed: 'Co-op Lab White BG.svg' },
      horizontal: { base: 'Co-op Lab Horizontal Text NO BG.svg', boxed: 'Co-op Lab Horizontal Text White BG.svg' },
      vertical: { base: 'Co-op Lab vertical Text NO BG.svg', boxed: 'Co-op Lab vertical Text White BG.svg' },
    },
  },
  'robo-university': {
    name: 'Robo University',
    primary: '#6EC207',
    svgDir: 'Robo Uni/Robo University SVGs',
    pngDir: 'Robo Uni/Robo University PNGS',
    lockups: {
      mark: { base: 'Robo University.svg' },
      horizontal: { base: 'Robo University Horizontal Text No BG.svg', boxed: 'Robo University Horizontal Text White BG.svg' },
      vertical: { base: 'Robo University Vertical Text No BG.svg', boxed: 'Robo University Vertical Text White BG.svg' },
    },
  },
};

const read = (p) => readFileSync(p, 'utf8');

/** Strip Illustrator's `id="Layer_2"` and any <style>/<defs> cruft, keep geometry. */
function tidy(svg) {
  return svg
    .replace(/<\?xml[^>]*\?>\s*/i, '')
    .replace(/\s+id="Layer_\d+"/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

/**
 * Produce a themable copy: every explicit fill becomes currentColor, and any
 * shape relying on the default black fill is given one explicitly.
 */
function toCurrentColor(svg) {
  let out = svg.replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"');
  // Unfilled shapes default to black; make that inheritance explicit instead.
  out = out.replace(/<(polygon|path|rect|circle|ellipse)((?:(?!fill=)[^>])*?)\/>/g,
    (m, tag, attrs) => `<${tag}${attrs} fill="currentColor"/>`);
  return out;
}

/**
 * Remove any full-bleed background rect, whatever its fill.
 *
 * Critically this includes rects with NO fill attribute — SVG defaults those to
 * BLACK, and most of the "… Black BG" masters use exactly that to paint a solid
 * black plate. An earlier version of this script only matched `fill="#fff"`,
 * so those plates survived into the distributable artwork and shipped a black
 * box behind the logo. Hence `hasFullBleedRect` below, which fails the build
 * rather than trusting this to be right.
 */
function stripPlate(svg) {
  const vb = svg.match(/viewBox="([\d.\s-]+)"/);
  if (!vb) return svg;
  const [, , vw, vh] = vb[1].trim().split(/\s+/).map(Number);

  return svg.replace(/<rect\b[^>]*\/?>/gi, (rect) => {
    const w = Number(rect.match(/\bwidth="([\d.]+)"/)?.[1]);
    const h = Number(rect.match(/\bheight="([\d.]+)"/)?.[1]);
    if (!w || !h) return rect;
    return (w >= vw * 0.95 && h >= vh * 0.95) ? '' : rect;
  });
}

/** Guard: true if a full-bleed rect of any fill survives. */
function hasFullBleedRect(svg) {
  const vb = svg.match(/viewBox="([\d.\s-]+)"/);
  if (!vb) return false;
  const [, , vw, vh] = vb[1].trim().split(/\s+/).map(Number);

  return (svg.match(/<rect\b[^>]*\/?>/gi) ?? []).some((rect) => {
    const w = Number(rect.match(/\bwidth="([\d.]+)"/)?.[1]);
    const h = Number(rect.match(/\bheight="([\d.]+)"/)?.[1]);
    return w >= vw * 0.95 && h >= vh * 0.95;
  });
}

const manifest = { generatedFrom: 'Brand Guidelines UPDATE.pdf + Robo/LOGO', brands: {} };
let written = 0;
const notes = [];

for (const [slug, brand] of Object.entries(BRANDS)) {
  const outDir = join(ROOT, 'assets', 'logos', slug);
  mkdirSync(outDir, { recursive: true });

  const entry = { name: brand.name, primary: brand.primary, lockups: {} };

  for (const [lockup, files] of Object.entries(brand.lockups)) {
    const record = {};

    for (const [finish, srcName] of Object.entries(files)) {
      const srcPath = join(SRC, brand.svgDir, srcName);
      if (!existsSync(srcPath)) {
        notes.push(`MISSING source: ${slug}/${lockup}/${finish} -> ${srcName}`);
        continue;
      }
      const suffix = finish === 'base' ? '' : `-${finish}`;
      const outName = `${slug}-${lockup}${suffix}.svg`;

      /* `boxed` keeps its white plate — that is the whole point of it. Every
       * other finish must be transparent, so the logo can sit on any surface. */
      let out = tidy(read(srcPath));
      if (finish !== 'boxed') out = stripPlate(out);

      if (finish !== 'boxed' && hasFullBleedRect(out)) {
        throw new Error(`${outName}: a full-bleed background rect survived stripping — refusing to ship plated artwork.`);
      }

      writeFileSync(join(outDir, outName), out + '\n', 'utf8');
      record[finish] = `assets/logos/${slug}/${outName}`;
      written++;
    }

    /* One themable file per lockup, kept in inline/ and deliberately away from
     * the distributable artwork. These carry fill="currentColor", which is what
     * lets them follow a CSS theme when embedded in a page — but it also means
     * they render BLACK when opened, downloaded or used in an <img>. They are
     * an embedding mechanism, never something to hand out. */
    if (files.base) {
      const inlineDir = join(outDir, 'inline');
      mkdirSync(inlineDir, { recursive: true });
      const currentName = `${slug}-${lockup}-current.svg`;
      writeFileSync(join(inlineDir, currentName),
        toCurrentColor(stripPlate(tidy(read(join(SRC, brand.svgDir, files.base))))) + '\n', 'utf8');
      record.inline = `assets/logos/${slug}/inline/${currentName}`;
      written++;
    }

    // Resolve (lockup, theme) -> file. Only Robo Co-op's black mark actually
    // needs different art on dark; the coloured marks hold up on both.
    record.onLight = record.base;
    record.onDark = record.inverse ?? record.base;
    record.needsInverse = Boolean(record.inverse);

    /* What may be handed out. Everything here keeps its real colours, so a
     * downloaded file always looks like the brand. */
    record.downloads = [
      record.inverse
        ? { id: 'black', label: 'Black', path: record.base, on: 'light' }
        : { id: 'colour', label: 'Brand colour', path: record.base, on: 'light' },
      ...(record.inverse ? [{ id: 'white', label: 'White', path: record.inverse, on: 'dark' }] : []),
    ];

    entry.lockups[lockup] = record;
  }

  // Raster fallbacks, copied verbatim under their original names.
  const pngSrc = join(SRC, brand.pngDir);
  if (existsSync(pngSrc)) {
    const pngOut = join(outDir, 'png');
    mkdirSync(pngOut, { recursive: true });
    for (const f of readdirSync(pngSrc).filter((f) => f.toLowerCase().endsWith('.png'))) {
      copyFileSync(join(pngSrc, f), join(pngOut, basename(f)));
      written++;
    }
  }

  manifest.brands[slug] = entry;
}

mkdirSync(join(ROOT, 'assets', 'logos'), { recursive: true });
writeFileSync(join(ROOT, 'assets', 'logos', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`Wrote ${written} asset files across ${Object.keys(BRANDS).length} brands.`);
for (const n of notes) console.warn('  ! ' + n);
