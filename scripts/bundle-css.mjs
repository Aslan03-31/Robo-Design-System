/**
 * Concatenates tokens + base + components into one drop-in stylesheet.
 *
 * No bundler, no PostCSS, no build chain to keep alive. The output is readable
 * CSS that a designer can open and search, which matters more here than the
 * few hundred bytes minification would save.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'css');
const COMPONENTS = join(SRC, 'components');

const tokensPath = join(ROOT, 'dist', 'css', 'tokens.css');
if (!existsSync(tokensPath)) {
  console.error('dist/css/tokens.css is missing — run `node scripts/build-tokens.mjs` first.');
  process.exit(1);
}

const banner = `/*!
 * Robo Co-op Design System
 * Tokens, base layer and components for Robo Co-op, Robo Lab, Co-op Lab and
 * Robo University.
 *
 * GENERATED FILE — do not edit. Sources live in tokens/ and src/css/.
 * Rebuild with: npm run build
 *
 * Usage:
 *   <html data-brand="robo-lab">                  light, follows OS for dark
 *   <html data-brand="coop-lab" data-theme="dark"> forced dark
 */
`;

const parts = [banner, readFileSync(tokensPath, 'utf8'), readFileSync(join(SRC, 'base.css'), 'utf8')];

const componentFiles = readdirSync(COMPONENTS).filter((f) => f.endsWith('.css')).sort();
for (const f of componentFiles) parts.push(readFileSync(join(COMPONENTS, f), 'utf8'));

parts.push(readFileSync(join(SRC, 'utilities.css'), 'utf8'));

mkdirSync(join(ROOT, 'dist', 'css'), { recursive: true });
const out = parts.join('\n');
writeFileSync(join(ROOT, 'dist', 'css', 'robo-design-system.css'), out, 'utf8');

/* Shipped alongside, never inside. An @import has to be the first rule in a
   stylesheet, and folding a blocking font request into the main bundle takes
   that choice away from whoever consumes this. */
copyFileSync(join(SRC, 'fonts.css'), join(ROOT, 'dist', 'css', 'fonts.css'));

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log(`Bundled tokens + base + ${componentFiles.length} components + utilities -> dist/css/robo-design-system.css (${kb} KB)`);
console.log(`  components: ${componentFiles.map((f) => basename(f, '.css')).join(', ')}`);
console.log('  fonts:      dist/css/fonts.css (optional, link separately)');
