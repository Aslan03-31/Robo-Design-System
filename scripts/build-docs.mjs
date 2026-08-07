/**
 * Generates the documentation site from the compiled artefacts.
 *
 * Nothing here is hand-written content that could drift: swatches come from
 * dist/tokens.json, the logo gallery from assets/logos/manifest.json, and the
 * contrast table from dist/contrast-report.json. Change a token, rebuild, and
 * the docs are correct by construction.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast, round2 } from './lib/color.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs');

const tokens = JSON.parse(readFileSync(join(ROOT, 'dist', 'tokens.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'assets', 'logos', 'manifest.json'), 'utf8'));
const report = JSON.parse(readFileSync(join(ROOT, 'dist', 'contrast-report.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Content hash for cache-busting docs.css / docs.js.
 *
 * Without this the browser happily serves a stale docs.js after a rebuild —
 * which silently reverted the download handler to the previous version and
 * made SVG links navigate instead of saving. A hash changes only when the file
 * changes, so caching still works between builds.
 */
const assetHash = (name) =>
  createHash('sha1').update(readFileSync(join(OUT, name))).digest('hex').slice(0, 8);
const BRANDS = Object.entries(tokens.brands);
const DEFAULT_BRAND = 'robo-coop';

/* ------------------------------------------------------- guidelines content */

/**
 * The motif progresses Infinity -> Autonomy -> Plurality (guidelines p.05).
 *
 * Which brand carries which state is easy to get backwards, so read it off the
 * artwork: Robo University's mark is the *two-lobe* loop, so it is Infinity.
 * Robo Lab and Co-op Lab are each a *single* lobe — the two halves standing
 * alone — so they share Autonomy. Robo Co-op is the composite, so it is
 * Plurality.
 */
const MARK_STAGES = [
  {
    state: 'Infinity',
    marks: [{ brand: 'robo-university', lockup: 'vertical' }],
    title: 'Machine × Humanity',
    body: 'The two lobes are Machine and Humanity, locked into one loop. Learning is never solo: two or more, learning cooperatively — the group has always been our unit of education.',
  },
  {
    state: 'Autonomy',
    marks: [
      { brand: 'robo-lab', lockup: 'vertical', caption: 'The Machine lobe stands on its own — pioneering new system implementation.' },
      { brand: 'coop-lab', lockup: 'vertical', caption: 'The Human lobe stands on its own — hacking cooperative entrepreneurship.' },
    ],
  },
  {
    state: 'Plurality',
    marks: [{ brand: 'robo-coop', lockup: 'horizontal' }],
    title: 'Beyond Infinity',
    body: 'Robo Co-op is the composite mark: not one loop but many, overlapping. Plurality is the order above infinity — many minds, many machines, and many ways of owning what they build together.',
  },
];

const MISUSE_RULES = [
  'Rotate or distort the logo',
  'Use a colour other than the brand’s own',
  'Typeset the wordmark in a different font',
  'Disassemble the logo',
  'Reposition or resize the elements of the logo',
  'Pair the logo with a mark other than the official one',
  'Use low-resolution versions of the logo',
  'Place the logo over an image that makes it illegible',
  'Change or alter the text',
  'Use an opacity setting below 50%',
];

const COBRAND_RULES = [
  'Make the partner logo appear more dominant',
  'Overlap the logos',
  'Stagger the logos',
  'Change the partner logo’s colours to match ours',
];

const TYPE_ROLES = [
  { weight: 'bold',    label: 'Roboto Bold',    role: 'Heading' },
  { weight: 'medium',  label: 'Roboto Medium',  role: 'Subheading' },
  { weight: 'regular', label: 'Roboto Regular', role: 'Body copy — clear, direct, and contemporary.' },
  { weight: 'light',   label: 'Roboto Light',   role: 'Caption and annotation' },
];

/* --------------------------------------------------------------- fragments */

const nav = () => `
<nav class="doc-nav" aria-label="Sections">
  <a class="doc-nav__brand" href="#top">
    <span class="doc-nav__mark" data-logo-slot></span>
    <span>Design System</span>
  </a>
  <ol>
    ${[
      ['architecture', 'Brand architecture'],
      ['identity', 'Visual identity'],
      ['marks', 'The mark system'],
      ['logos', 'Logos'],
      ['misuse', 'Logo rules'],
      ['colour', 'Colour'],
      ['tokens', 'Semantic tokens'],
      ['type', 'Typography'],
      ['scales', 'Space & motion'],
      ['components', 'Components'],
      ['accessibility', 'Accessibility'],
      ['code', 'Using it'],
    ].map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`).join('\n    ')}
  </ol>
</nav>`;

const header = () => `
<header class="doc-header" id="top">
  <div class="doc-controls">
    <div class="doc-switch" role="group" aria-label="Brand">
      ${BRANDS.map(([slug, b]) => `
      <button type="button" class="doc-switch__btn" data-set-brand="${slug}"
              aria-pressed="${slug === DEFAULT_BRAND}">
        <span class="doc-switch__dot" style="background:${b.palette.primary.value}"></span>
        ${esc(b.meta.name)}
      </button>`).join('')}
    </div>
    <button type="button" class="doc-theme" data-toggle-theme aria-pressed="false">
      <span data-theme-label>Dark</span>
    </button>
  </div>

  <div class="doc-hero">
    <p class="rds-eyebrow" data-brand-tagline></p>
    <h1 class="rds-display" data-brand-name></h1>
    <p class="rds-lead" data-brand-promise></p>
    <p class="doc-hero__role rds-text-subtle" data-brand-role></p>
  </div>
</header>`;

/**
 * Inline a lockup as SVG source rather than an <img>.
 *
 * The `-current.svg` variants are authored with fill="currentColor", so inlined
 * they take their colour from CSS. That matters most for Robo Co-op, whose mark
 * is black and therefore invisible on a dark surface: pointed at
 * --rds-color-primary it renders black on light and Circuit White on dark,
 * which is the same inversion the brand tokens already describe. An <img>
 * cannot do this — currentColor inside it resolves against the image's own
 * context, so it would come out black on every theme.
 */
function logoSvg(slug, lockup, className = '') {
  const l = manifest.brands[slug].lockups[lockup];
  const path = l.inline ?? l.base;
  const svg = readFileSync(join(ROOT, path), 'utf8').trim();
  return `<span class="${className}" role="img" aria-label="${esc(tokens.brands[slug].meta.name)}">${svg}</span>`;
}

/** One node of the hub-and-spoke architecture diagram. */
function archNode(slug, position) {
  const b = tokens.brands[slug];
  const lockup = slug === 'robo-coop' ? 'horizontal' : 'vertical';
  return `
  <div class="doc-hub__node doc-hub__node--${position}" data-brand="${slug}">
    ${logoSvg(slug, lockup, 'doc-hub__logo')}
    <strong class="doc-hub__together">${esc(b.meta.tagline.split('—')[0].trim())}</strong>
    <span class="doc-hub__descriptor">${esc(b.meta.descriptor)}</span>
    <em class="doc-hub__promise">“${esc(b.meta.promise)}”</em>
  </div>`;
}

const architecture = () => `
<section id="architecture" class="doc-section">
  <h2>Brand architecture</h2>
  <p class="rds-lead">
    <strong>Robo Co-op is the Human−Machine Cooperative OS:</strong> the shared philosophy,
    governance and operating foundation that enables people and machines to create value
    together. It exists to ensure that technological progress expands human agency — not
    only efficiency. Its three entities represent the plurality of
    <strong>learning, building and sharing</strong>.
  </p>

  <p class="doc-triad">
    <strong>Learn</strong> what is changing. <strong>Build</strong> what should exist.
    <strong>Share</strong> what we create.
  </p>
  <p class="doc-triad__sub">
    Together, they connect learning, technology and entrepreneurship into a cooperative
    system for updating humanity.
  </p>

  <div class="doc-hub">
    <div class="doc-hub__frame" aria-hidden="true"></div>
    ${archNode('robo-coop', 'top')}
    ${archNode('robo-lab', 'left')}
    ${archNode('coop-lab', 'right')}
    <div class="doc-hub__connector" aria-hidden="true">
      <span class="doc-hub__cap doc-hub__cap--left"></span>
      <span class="doc-hub__cap doc-hub__cap--right"></span>
      <span class="doc-hub__drop"></span>
    </div>
    ${archNode('robo-university', 'bottom')}
  </div>

  <div class="doc-entities">
    ${['robo-university', 'robo-lab', 'coop-lab'].map((slug) => {
      const b = tokens.brands[slug];
      return `
    <article class="doc-entity" data-brand="${slug}">
      ${logoSvg(slug, 'vertical', 'doc-entity__logo')}
      <strong class="doc-entity__together">${esc(b.meta.tagline.split('—')[0].trim())}</strong>
      <span class="doc-entity__descriptor">${esc(b.meta.descriptor)}</span>
      <em class="doc-entity__promise">${esc(b.meta.promise)}</em>
      <p class="doc-entity__role">${esc(b.meta.role)}</p>
      <ul class="doc-entity__pillars">
        ${b.meta.pillars.map((p) => `<li>${esc(p)}</li>`).join('\n        ')}
      </ul>
      <code class="doc-chip">data-brand="${slug}"</code>
    </article>`;
    }).join('')}
  </div>
</section>`;

const visualIdentity = () => `
<section id="identity" class="doc-section">
  <h2>Visual identity</h2>

  <div class="doc-identity">
    <div>
      <p class="rds-subtitle">Humanity is entering an age when intelligence is no longer exclusively human.</p>
      <p>
        AI, automation and robotics are becoming part of how we learn, work, create and decide.
        Yet technological progress does not automatically become human progress. Without new
        forms of cooperation, it can concentrate power, deepen inequality, and leave people behind.
      </p>
      <p>
        Robo Co-op begins with a different premise: the future is not
        <strong>Human versus Machine</strong>, but <strong>Human with Machine</strong>.
      </p>
      <dl class="doc-glossary">
        <dt>ROBO</dt><dd>intelligence, technology, and machines.</dd>
        <dt>CO-OP</dt><dd>cooperation, solidarity, and shared agency.</dd>
      </dl>
      <p>
        Their intersection creates an infinite loop in which people and machines continuously
        learn, build and improve together — expanding capabilities and possibilities that
        neither could achieve alone.
      </p>
      <p class="doc-identity__claim">
        We do not automate humanity away. We update humanity through solidarity.
      </p>
    </div>

    <figure class="doc-infinity">
      <span class="doc-infinity__axis doc-infinity__axis--top">infinity</span>
      <div class="doc-infinity__row">
        <span class="doc-infinity__axis">Machine</span>
        ${logoSvg('robo-university', 'mark', 'doc-infinity__mark')}
        <span class="doc-infinity__axis">Human</span>
      </div>
      <figcaption>
        <strong class="doc-infinity__equation">ROBO × CO-OP = INFINITY</strong>
        <span class="rds-caption">Robot / Machine × Co-op / Human = infinity</span>
      </figcaption>
    </figure>
  </div>
</section>`;

const marks = () => `
<section id="marks" class="doc-section">
  <h2>The mark system</h2>
  <p class="rds-lead">One motif, four states — from Infinity to Plurality.</p>
  <p>
    ROBO represents intelligence, technology and machines. CO-OP represents cooperation,
    solidarity and shared agency. Their intersection creates an infinite loop in which people
    and machines continuously learn, build and improve together.
    <strong>Infinity is what two create together. Plurality is what many create together.</strong>
  </p>

  <div class="doc-marksystem">
    ${MARK_STAGES.map((stage, i) => `
    ${i > 0 ? '<div class="doc-marksystem__arrow" aria-hidden="true"></div>' : ''}
    <div class="doc-stage">
      <h3 class="doc-stage__state" data-brand="${stage.marks[0].brand}">${stage.state}</h3>
      <div class="doc-stage__marks">
        ${stage.marks.map((m) => `
        <figure class="doc-stage__mark" data-brand="${m.brand}">
          ${logoSvg(m.brand, m.lockup, 'doc-stage__art')}
          ${m.caption ? `<figcaption class="doc-stage__caption">${esc(m.caption)}</figcaption>` : ''}
        </figure>`).join('')}
      </div>
      ${stage.title ? `<h4 class="doc-stage__title">${esc(stage.title)}</h4>` : ''}
      ${stage.body ? `<p class="doc-stage__body">${esc(stage.body)}</p>` : ''}
    </div>`).join('')}
  </div>

  <p class="doc-marksystem__coda">Infinity is what two create together. Plurality is what many create together.</p>
</section>`;

const LOCKUP_LABEL = { mark: 'Mark', horizontal: 'Horizontal', vertical: 'Vertical' };

/**
 * Three lockups per brand. Each shows only artwork that carries its real
 * colours, so anything downloaded looks like the brand. Robo Co-op is the one
 * brand with two finishes — its mark is black, so it needs white artwork for
 * dark surfaces; the three coloured marks hold up on both from one file.
 */
function logoRow(slug, brand) {
  const lockups = manifest.brands[slug].lockups;
  return `
  <div class="doc-logoset" data-brand="${slug}">
    <div class="doc-logoset__head">
      <h3>${esc(brand.meta.name)}</h3>
      ${lockups.mark.needsInverse
        ? '<span class="rds-badge">Black &amp; White versions</span>'
        : '<span class="rds-badge rds-badge--success">One file works on light &amp; dark</span>'}
    </div>

    <div class="doc-logogrid">
      ${['mark', 'horizontal', 'vertical'].filter((k) => lockups[k]).map((k) => {
        const l = lockups[k];
        return `
      <figure class="doc-logo">
        <h4 class="doc-logo__name">${LOCKUP_LABEL[k]}</h4>
        <div class="doc-logo__finishes">
          ${l.downloads.map((d) => `
          <div class="doc-logo__finish">
            <div class="doc-logo__stage doc-logo__stage--${d.on}">
              <img src="../${d.path}" alt="${esc(brand.meta.name)} ${k} lockup, ${d.label.toLowerCase()}" loading="lazy" />
            </div>
            <div class="doc-logo__meta">
              <span class="doc-logo__finishname">${d.label}${
                d.id === 'white'
                  ? ' <abbr class="doc-logo__hint" title="White artwork on a transparent background. Opened over a white page it will look blank — that is correct, not a broken file.">transparent</abbr>'
                  : ''}</span>
              <!-- Opens the file rather than saving it. A new tab keeps the
                   reader's place, and right-click > Save As remains the
                   browser's own download path. The icon says "opens" because a
                   download arrow that opens a tab misdescribes the control. -->
              <a class="rds-btn rds-btn--secondary rds-btn--sm" href="../${d.path}"
                 target="_blank" rel="noopener"
                 title="Open ${d.path.split('/').pop()} in a new tab">
                <svg class="rds-btn__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                     stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M6.5 3H3v10h10V9.5M9.5 2.5h4v4M13 3l-5.5 5.5"/>
                </svg>
                SVG
              </a>
            </div>
          </div>`).join('')}
        </div>
      </figure>`;
      }).join('')}
    </div>
  </div>`;
}

const logos = () => `
<section id="logos" class="doc-section">
  <h2>Logos</h2>
  <p class="rds-lead">
    Three lockups per brand, each in up to four finishes. Every file is vector; PNGs sit
    alongside in <code>assets/logos/&lt;brand&gt;/png/</code> for contexts that cannot take SVG.
  </p>

  <div class="rds-alert rds-alert--info">
    <div class="rds-alert__content">
      <span class="rds-alert__title">Only Robo Co-op has Black and White versions</span>
      <span class="rds-alert__body">
        Its mark is black, so it disappears on a dark surface and needs white artwork.
        Robo Lab, Robo University and Co-op Lab are legible on both and use a single
        brand-coloured file. Every download below keeps its real colours.
      </span>
    </div>
  </div>

  <h3>Logo usage</h3>
  <p>Clear space and minimum size, the two rules that keep the logo legible.</p>

  <div class="doc-usage">
    <figure class="doc-usage__item">
      <div class="doc-usage__plate">
        <!-- A real 3x3 grid: the corner cells ARE 0.5X square and the centre
             cell is exactly the logo's bounding box, so the diagram is
             measured rather than illustrated. -->
        <div class="doc-clearspace" role="img"
             aria-label="Clear space diagram: 0.5X of free space on all four sides of the Robo Co-op logo">
          <span class="doc-clearspace__cell">0.5X</span>
          <span class="doc-clearspace__cell"></span>
          <span class="doc-clearspace__cell">0.5X</span>
          <span class="doc-clearspace__cell"></span>
          <span class="doc-clearspace__art">${readFileSync(join(ROOT, manifest.brands['robo-coop'].lockups.horizontal.base), 'utf8').trim()}</span>
          <span class="doc-clearspace__cell"></span>
          <span class="doc-clearspace__cell">0.5X</span>
          <span class="doc-clearspace__cell"></span>
          <span class="doc-clearspace__cell">0.5X</span>
        </div>
      </div>
      <figcaption class="doc-usage__caption">
        <strong>Clear space — 0.5X</strong>
        <span class="rds-caption">X is the height of the mark. Keep 0.5X free on all four
        sides; no type, rule or image may enter it. <code>.rds-logo</code> applies this as
        padding derived from the logo's own size, so it holds at any scale.</span>
      </figcaption>
    </figure>

    <figure class="doc-usage__item">
      <div class="doc-usage__plate">
        <div class="doc-minsize">
          ${[
            { label: 'Print', w: 200, note: 'Min width 25mm' },
            { label: 'Digital', w: 90, note: 'Min width 90px' },
          ].map((m) => `
          <div class="doc-minsize__row">
            <span class="doc-minsize__label">${m.label}</span>
            <div class="doc-minsize__art">
              <span class="doc-minsize__logo" style="width:${m.w}px">${readFileSync(join(ROOT, manifest.brands['robo-coop'].lockups.horizontal.base), 'utf8').trim()}</span>
              <span class="doc-minsize__rule" style="width:${m.w}px"></span>
              <span class="doc-minsize__note">${m.note}</span>
            </div>
          </div>`).join('')}
        </div>
      </div>
      <figcaption class="doc-usage__caption">
        <strong>Minimum size</strong>
        <span class="rds-caption">A <em>width</em> rule on the full horizontal lockup, not a
        height rule on the mark. <code>.rds-logo--horizontal</code> sets
        <code>min-width: 90px</code>, and <code>25mm</code> under <code>@media print</code>, so
        the floor is structural rather than advisory.</span>
      </figcaption>
    </figure>
  </div>

  ${BRANDS.map(([slug, b]) => logoRow(slug, b)).join('')}
</section>`;

const misuse = () => `
<section id="misuse" class="doc-section">
  <h2>Logo rules</h2>
  <div class="doc-rules">
    <div>
      <h3>Never do this to the logo</h3>
      <ul class="doc-donts">
        ${MISUSE_RULES.map((r) => `<li><span aria-hidden="true">✕</span>${esc(r)}</li>`).join('\n        ')}
      </ul>
    </div>
    <div>
      <h3>Co-branding</h3>
      <ul class="doc-donts">
        ${COBRAND_RULES.map((r) => `<li><span aria-hidden="true">✕</span>${esc(r)}</li>`).join('\n        ')}
      </ul>
    </div>
  </div>

  <!-- Outside .doc-rules on purpose: inside that two-column grid the stage was
       ~525px wide, which wrapped the partner mark onto a second row and made
       the panel demonstrate the stagger it warns against. -->
  <h3>Correct co-branding</h3>
  <div class="doc-cobrand">
    <div class="doc-cobrand__stage">
      <span class="rds-logo rds-logo--horizontal doc-cobrand__ours" data-logo-lockup></span>
      <span class="doc-cobrand__divider"></span>
      <span class="doc-cobrand__partner">Partner logo</span>
    </div>
    <p class="rds-caption">
      Equal optical weight, a fixed divider, no overlap, no stagger. Give both marks the
      same visual height rather than the same pixel height — a wide lockup and a compact
      one at identical heights will not read as equal.
    </p>
  </div>
</section>`;

function paletteSwatches(brand) {
  return Object.entries(brand.palette).map(([key, v]) => {
    const onLight = round2(contrast(v.value, '#FFFFFF'));
    return `
    <button type="button" class="doc-swatch" data-copy="${v.value}" title="Click to copy ${v.value}">
      <span class="doc-swatch__chip" style="background:${v.value}"></span>
      <span class="doc-swatch__meta">
        <strong>${esc(v.name)}</strong>
        <code>${v.value}</code>
        ${v.note ? `<em class="doc-swatch__note" title="${esc(v.note)}">corrected</em>` : ''}
        <span class="rds-caption">${onLight}:1 on white</span>
      </span>
    </button>`;
  }).join('');
}

const colour = () => `
<section id="colour" class="doc-section">
  <h2>Colour</h2>
  <p class="rds-lead">Each brand carries one primary and eight secondaries. Click any swatch to copy its hex.</p>

  <div class="rds-alert rds-alert--warning">
    <div class="rds-alert__content">
      <span class="rds-alert__title">Two values were corrected against the source PDF</span>
      <span class="rds-alert__body">
        Robo University’s <strong>Mint Cream</strong> is printed as <code>#39411E</code>, which is a
        copy-paste of Deep Forest beside it; the real vector swatch is <code>#EFF5E3</code> and is used here.
        Robo Lab’s <strong>Electric Cyan</strong> label reads <code>#00C3FF</code> while its swatch fill is
        <code>#00C3EF</code> — the label was taken as canonical because it matches shipped Robo Lab web work.
      </span>
    </div>
  </div>

  ${BRANDS.map(([slug, b]) => `
  <div class="doc-palette" data-brand="${slug}">
    <h3>${esc(b.meta.name)}</h3>
    <div class="doc-swatches">${paletteSwatches(b)}</div>
  </div>`).join('')}
</section>`;

function tokenTable(slug, brand) {
  const keys = Object.keys(brand.themes.light.tokens);
  return `
  <div class="doc-tokens" data-brand="${slug}">
    <h3>${esc(brand.meta.name)}</h3>
    <div class="rds-table-wrap">
      <table class="rds-table rds-table--hover">
        <thead>
          <tr><th>Token</th><th>Light</th><th>Dark</th></tr>
        </thead>
        <tbody>
          ${keys.map((k) => {
            const l = brand.themes.light.tokens[k];
            const d = brand.themes.dark.tokens[k];
            const cell = (v) => k === 'shadow-rgb'
              ? `<code>${v}</code>`
              : `<span class="doc-dot" style="background:${v}"></span><code>${v}</code>`;
            return `<tr>
            <td><code>--rds-color-${k}</code></td>
            <td>${cell(l)}</td>
            <td>${cell(d)}</td>
          </tr>`;
          }).join('\n          ')}
        </tbody>
      </table>
    </div>
  </div>`;
}

const tokensSection = () => `
<section id="tokens" class="doc-section">
  <h2>Semantic tokens</h2>
  <p class="rds-lead">
    Build against these, not the raw palette. They are the layer that changes when the brand
    or theme changes.
  </p>
  <div class="rds-alert rds-alert--info">
    <div class="rds-alert__content">
      <span class="rds-alert__title">Fill colours and text colours are different tokens</span>
      <span class="rds-alert__body">
        <code>--rds-color-primary</code> is the exact brand colour, for fills and large graphics.
        <code>--rds-color-primary-text</code> is the same colour shifted until it is legible as
        body text, and <code>--rds-color-primary-strong</code> is the fill that can carry a label
        at AA. Robo University’s lime is 2.1:1 on white — unusable as text, perfect as a fill.
        The same pairing exists for accent, success, warning, danger and info.
      </span>
    </div>
  </div>
  ${BRANDS.map(([slug, b]) => tokenTable(slug, b)).join('')}
</section>`;

const type = () => {
  const sizes = tokens.core.font.size;
  return `
<section id="type" class="doc-section">
  <h2>Typography</h2>
  <p class="rds-lead">Roboto for Latin, Noto Sans JP for Japanese. Four weights, each with a defined role.</p>

  <div class="doc-weights">
    ${TYPE_ROLES.map((t) => `
    <div class="doc-weight">
      <span class="doc-weight__sample" style="font-weight:var(--rds-weight-${t.weight})">${esc(t.label)}</span>
      <span class="rds-caption">${esc(t.role)}</span>
    </div>`).join('')}
  </div>

  <h3>Typesetting and hierarchy</h3>
  <p>
    Authored in points, because the guidelines specify print. Screen sizes are
    <code>pt × 96/72</code>, rounded to the nearest pixel — Body at 12pt lands exactly on
    16px and Caption at 9pt on 12px, so the print and screen scales agree rather than
    merely coexisting. Each role carries its weight, so
    <code>--rds-text-heading-weight</code> travels with <code>--rds-text-heading</code>.
  </p>

  <div class="rds-table-wrap">
    <table class="rds-table">
      <thead>
        <tr><th>Style</th><th>Specimen</th><th data-numeric>Print</th><th data-numeric>Screen</th><th>Weight</th><th>Token</th></tr>
      </thead>
      <tbody>
        ${Object.entries(sizes).map(([k, v]) => `
        <tr>
          <td>
            ${esc(v.role.split('—')[0].trim())}
            ${v.extends ? '<span class="rds-badge rds-badge--warning">extends</span>' : ''}
          </td>
          <td>
            <span style="font-size:var(--rds-text-${k});font-weight:var(--rds-weight-${v.weight});${v.style ? `font-style:${v.style};` : ''}line-height:1.15;display:inline-block">
              ${k === 'quote' ? 'Updating humanity' : k.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
          </td>
          <td data-numeric>${v.pt ? `${v.pt} pt` : '—'}</td>
          <td data-numeric>${v.fluid ? `${v.fluid.min}–${v.fluid.max}` : v.value} px</td>
          <td><span class="rds-caption">${v.weight}${v.style ? ` ${v.style}` : ''}</span></td>
          <td><code>--rds-text-${k}</code></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <p class="rds-caption">
    Aliases <code>--rds-text-display</code>, <code>-h1</code>, <code>-h2</code>,
    <code>-h3</code> and <code>-h4</code> point at Title, Heading, Subtitle, Section Header
    and Subheading respectively. They exist so existing markup keeps working; they are not
    separate sizes.
  </p>

  <h3>Quote</h3>
  <blockquote class="rds-blockquote">“Updating Humanity through Solidarity.”</blockquote>

  <h3>Japanese — Noto Sans JP</h3>
  <p>
    Japanese uses <strong>Noto Sans JP</strong> across the same four weight roles and the
    same size scale, so a bilingual page keeps one vertical rhythm. Only the leading
    changes: Japanese sets without word spaces and with full-height glyphs, so Latin
    line-heights read as cramped.
  </p>

  <div class="doc-weights">
    ${TYPE_ROLES.map((t) => `
    <div class="doc-weight" lang="ja">
      <span class="doc-weight__sample" style="font-weight:var(--rds-weight-${t.weight})">見出しの例</span>
      <span class="rds-caption">Noto Sans JP ${t.label.replace('Roboto ', '')} — ${esc(t.role)}</span>
    </div>`).join('')}
  </div>

  <div class="doc-demo">
    <p lang="ja" class="rds-display">連帯によって<br>人間性をアップデートする</p>
    <p lang="ja" style="margin-top:var(--rds-space-4)">
      ロボ・コープは、人間と機械が共に価値を創造するための共有された哲学とガバナンス、
      そして運営基盤です。技術の進歩が効率だけでなく、人間の主体性を広げることを目指しています。
    </p>
  </div>

  <div class="rds-alert rds-alert--info">
    <div class="rds-alert__content">
      <span class="rds-alert__title">How the switch fires</span>
      <span class="rds-alert__body">
        The face changes on a real language declaration — <code>&lt;html lang="ja"&gt;</code> for a
        Japanese page, or <code>&lt;p lang="ja"&gt;</code> for a passage inside an English one. That
        also tells screen readers to switch voice, which a CSS class cannot do. Where you
        genuinely cannot set the attribute, <code>.rds-ja</code> applies the same styling.
        Never mix the two faces inside one sentence.
      </span>
    </div>
  </div>

  <h3>Loading the fonts</h3>
  <p>
    The stylesheet declares the faces but does not fetch them, because that is a hosting
    decision. Link <code>dist/css/fonts.css</code> before the main stylesheet, or self-host —
    preferred for production, and worth it for Japanese, where the full family runs to
    several megabytes if you do not subset it.
  </p>
  <pre class="doc-code"><code>&lt;link rel="stylesheet" href="dist/css/fonts.css"&gt;
&lt;link rel="stylesheet" href="dist/css/robo-design-system.css"&gt;</code></pre>
</section>`;
};

const scales = () => {
  const { space, radius, motion, elevation } = tokens.core;
  return `
<section id="scales" class="doc-section">
  <h2>Space &amp; motion</h2>

  <h3>Space — 4px grid</h3>
  <div class="doc-scale">
    ${Object.entries(space).filter(([k]) => !k.startsWith('$')).map(([k, v]) => `
    <div class="doc-scale__row">
      <code>space-${k}</code>
      <span class="doc-scale__bar" style="width:${v}px"></span>
      <span class="rds-caption">${v}px</span>
    </div>`).join('')}
  </div>

  <h3>Radius</h3>
  <div class="doc-radii">
    ${Object.entries(radius).filter(([k]) => !k.startsWith('$')).map(([k, v]) => `
    <div class="doc-radius">
      <span class="doc-radius__box" style="border-radius:${v}px"></span>
      <code>${k}</code><span class="rds-caption">${v}px</span>
    </div>`).join('')}
  </div>

  <h3>Elevation</h3>
  <div class="doc-elevations">
    ${Object.keys(elevation).filter((k) => !k.startsWith('$')).map((k) => `
    <div class="doc-elevation rds-elevation-${k}"><code>elevation-${k}</code></div>`).join('')}
  </div>

  <h3>Motion</h3>
  <p class="rds-caption">Hover a bar to play it. All durations collapse to 0 under <code>prefers-reduced-motion</code>.</p>
  <div class="doc-motion">
    ${Object.entries(motion.duration).map(([k, v]) => `
    <div class="doc-motion__row">
      <code>${k}</code>
      <span class="doc-motion__track"><span class="doc-motion__dot" style="transition-duration:${v}"></span></span>
      <span class="rds-caption">${v}</span>
    </div>`).join('')}
  </div>
</section>`;
};

const components = () => `
<section id="components" class="doc-section">
  <h2>Components</h2>
  <p class="rds-lead">Framework-free CSS. Every example below re-themes with the switcher above.</p>

  <h3>Buttons</h3>
  <div class="doc-demo rds-row">
    <button class="rds-btn rds-btn--primary">Primary</button>
    <button class="rds-btn rds-btn--secondary">Secondary</button>
    <button class="rds-btn rds-btn--ghost">Ghost</button>
    <button class="rds-btn rds-btn--danger">Danger</button>
    <button class="rds-btn rds-btn--primary" disabled>Disabled</button>
  </div>
  <div class="doc-demo rds-row">
    <button class="rds-btn rds-btn--primary rds-btn--sm">Small</button>
    <button class="rds-btn rds-btn--primary">Default</button>
    <button class="rds-btn rds-btn--primary rds-btn--lg">Large</button>
  </div>

  <h3>Badges</h3>
  <div class="doc-demo rds-row">
    <span class="rds-badge">Default</span>
    <span class="rds-badge rds-badge--eyebrow">Eyebrow</span>
    <span class="rds-badge rds-badge--solid">Solid</span>
    <span class="rds-badge rds-badge--outline">Outline</span>
    <span class="rds-badge rds-badge--success"><span class="rds-badge__dot"></span>Success</span>
    <span class="rds-badge rds-badge--warning"><span class="rds-badge__dot"></span>Warning</span>
    <span class="rds-badge rds-badge--danger"><span class="rds-badge__dot"></span>Danger</span>
    <span class="rds-badge rds-badge--info"><span class="rds-badge__dot"></span>Info</span>
  </div>

  <h3>Cards</h3>
  <div class="doc-demo rds-card-grid">
    <article class="rds-card">
      <h4 class="rds-card__title">Standard card</h4>
      <p class="rds-card__body">Raised surface, hairline border, elevation 1.</p>
    </article>
    <article class="rds-card rds-card--interactive rds-card--accented">
      <h4 class="rds-card__title">Interactive</h4>
      <p class="rds-card__body">Lifts on hover and focus-within. Accent rule on top.</p>
      <div class="rds-card__footer"><button class="rds-btn rds-btn--ghost rds-btn--sm">Open</button></div>
    </article>
    <article class="rds-card rds-card--inverse">
      <h4 class="rds-card__title">Inverse</h4>
      <p>Flips to the inverted surface pair.</p>
    </article>
  </div>

  <h3>Form fields</h3>
  <div class="doc-demo doc-form">
    <div class="rds-field">
      <label class="rds-field__label" for="d-name" data-required>Full name</label>
      <input class="rds-input" id="d-name" placeholder="Aslan Al Ayoubi" />
      <span class="rds-field__hint">As it should appear on the member register.</span>
    </div>
    <div class="rds-field">
      <label class="rds-field__label" for="d-entity">Entity</label>
      <select class="rds-select" id="d-entity">
        ${BRANDS.map(([, b]) => `<option>${esc(b.meta.name)}</option>`).join('')}
      </select>
    </div>
    <div class="rds-field">
      <label class="rds-field__label" for="d-err">Email</label>
      <input class="rds-input" id="d-err" aria-invalid="true" value="not-an-email" />
      <span class="rds-field__error">Enter a valid email address.</span>
    </div>
    <div class="rds-field">
      <label class="rds-check"><input type="checkbox" checked /> <span>Share ownership of what we build</span></label>
      <label class="rds-check"><input type="radio" name="d-r" checked /> <span>Learn together</span></label>
      <label class="rds-check"><input type="radio" name="d-r" /> <span>Work together</span></label>
    </div>
  </div>

  <h3>Alerts</h3>
  <div class="doc-demo rds-stack">
    ${['info', 'success', 'warning', 'danger'].map((v) => `
    <div class="rds-alert rds-alert--${v}">
      <div class="rds-alert__content">
        <span class="rds-alert__title">${v[0].toUpperCase() + v.slice(1)}</span>
        <span class="rds-alert__body">Colour is reinforced by the title and the left rule, never used alone.</span>
      </div>
    </div>`).join('')}
  </div>

  <h3>Table</h3>
  <div class="doc-demo rds-table-wrap">
    <table class="rds-table rds-table--zebra rds-table--hover">
      <thead><tr><th>Entity</th><th>Focus</th><th data-numeric>Primary</th></tr></thead>
      <tbody>
        ${BRANDS.map(([slug, b]) => `
        <tr><td>${esc(b.meta.name)}</td><td>${esc(b.meta.tagline.split('—')[1]?.trim() ?? '')}</td><td data-numeric><code>${b.palette.primary.value}</code></td></tr>`).join('')}
      </tbody>
    </table>
  </div>
</section>`;

const accessibility = () => {
  const rows = report.results.filter((r) => r.theme === 'light');
  return `
<section id="accessibility" class="doc-section">
  <h2>Accessibility</h2>
  <p class="rds-lead">
    ${report.results.length} foreground/background pairs are checked on every build —
    ${BRANDS.length} brands × 2 themes. The build fails if any required pair drops below AA.
  </p>

  <div class="doc-stat-row">
    <div class="doc-stat"><strong>${report.results.length}</strong><span>pairs checked</span></div>
    <div class="doc-stat"><strong>${report.errors}</strong><span>failing</span></div>
    <div class="doc-stat"><strong>${report.warns}</strong><span>advisory</span></div>
    <div class="doc-stat"><strong>AA</strong><span>WCAG 2.1 target</span></div>
  </div>

  <p>Thresholds: 4.5:1 for body copy (1.4.3), 3:1 for large text, borders, focus rings and
  icons (1.4.11). Colour is never the only carrier of meaning (1.4.1), and interactive targets
  are at least 44px (2.5.5).</p>

  <div class="rds-table-wrap">
    <table class="rds-table rds-table--hover">
      <thead><tr><th>Check</th><th>Brand</th><th data-numeric>Light</th><th data-numeric>Dark</th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const d = report.results.find((x) => x.brand === r.brand && x.theme === 'dark' && x.what === r.what);
          const cell = (x) => x
            ? `<span class="doc-ratio ${x.pass ? 'is-pass' : 'is-fail'}">${x.ratio}:1</span>`
            : '—';
          return `<tr>
          <td>${esc(r.what)}</td>
          <td>${esc(tokens.brands[r.brand].meta.name)}</td>
          <td data-numeric>${cell(r)}</td>
          <td data-numeric>${cell(d)}</td>
        </tr>`;
        }).join('\n        ')}
      </tbody>
    </table>
  </div>
</section>`;
};

const code = () => `
<section id="code" class="doc-section">
  <h2>Using it</h2>

  <h3>1. Load the stylesheet</h3>
  <pre class="doc-code"><code>&lt;link rel="stylesheet" href="dist/css/robo-design-system.css"&gt;</code></pre>

  <h3>2. Declare the brand</h3>
  <pre class="doc-code"><code>&lt;html data-brand="robo-lab"&gt;                    &lt;!-- follows the OS for dark --&gt;
&lt;html data-brand="coop-lab" data-theme="dark"&gt;   &lt;!-- forced --&gt;
&lt;html data-brand="robo-university" data-theme="light"&gt;</code></pre>
  <p class="rds-caption">Valid brands: ${BRANDS.map(([s]) => `<code>${s}</code>`).join(', ')}. With no <code>data-brand</code>, the parent brand applies.</p>

  <h3>3. Build with tokens</h3>
  <pre class="doc-code"><code>.my-panel {
  background: var(--rds-color-surface-raised);
  color:      var(--rds-color-text);
  border:     var(--rds-border-hairline) solid var(--rds-color-border);
  border-radius: var(--rds-radius-lg);
  padding:    var(--rds-space-6);
  box-shadow: var(--rds-elevation-2);
}</code></pre>

  <h3>Logos in markup</h3>
  <pre class="doc-code"><code>&lt;!-- fixed brand colour --&gt;
&lt;span class="rds-logo rds-logo--md"&gt;
  &lt;img src="assets/logos/robo-lab/robo-lab-horizontal.svg" alt="Robo Lab"&gt;
&lt;/span&gt;

&lt;!-- inherits CSS color: inline the -current.svg file --&gt;
&lt;span class="rds-logo rds-logo--md rds-logo--brand"&gt;&lt;svg …&gt;&lt;/svg&gt;&lt;/span&gt;</code></pre>

  <h3>Scripts</h3>
  <pre class="doc-code"><code>npm run build            # tokens + bundled CSS
npm run check:contrast   # WCAG audit, non-zero exit on failure
npm run docs             # regenerate this site
npm start                # build, generate docs, serve on :4173</code></pre>
</section>`;

/* ------------------------------------------------------------------- page */

/* Embedded rather than fetched: the docs must work opened straight off disk,
   and file:// blocks XHR. Marks are inlined as source so they inherit
   `color` — an <img> would render currentColor as black on every theme. */
const brandData = Object.fromEntries(BRANDS.map(([slug, b]) => {
  const l = manifest.brands[slug].lockups.mark;
  const markPath = l.inline ?? l.base;
  return [slug, {
    name: b.meta.name,
    tagline: b.meta.tagline,
    promise: b.meta.promise,
    role: b.meta.role,
    primary: b.palette.primary.value,
    markSvg: readFileSync(join(ROOT, markPath), 'utf8').trim(),
    horizontalSvg: readFileSync(
      join(ROOT, manifest.brands[slug].lockups.horizontal.inline
                 ?? manifest.brands[slug].lockups.horizontal.base), 'utf8').trim(),
  }];
}));

const page = `<!doctype html>
<html lang="en" data-brand="${DEFAULT_BRAND}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Robo Co-op — Design System</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Roboto+Mono:wght@400&family=Noto+Sans+JP:wght@300;400;500;700&display=swap">
<link rel="stylesheet" href="../dist/css/robo-design-system.css">
<link rel="stylesheet" href="docs.css?v=${assetHash('docs.css')}">
</head>
<body>
<a class="doc-skip rds-btn rds-btn--primary rds-btn--sm" href="#main">Skip to content</a>
${nav()}
<main class="doc-main" id="main">
${header()}
${architecture()}
${visualIdentity()}
${marks()}
${logos()}
${misuse()}
${colour()}
${tokensSection()}
${type()}
${scales()}
${components()}
${accessibility()}
${code()}
<footer class="doc-footer">
  <p class="rds-caption">
    Generated from <code>tokens/</code>, <code>assets/logos/manifest.json</code> and
    <code>dist/contrast-report.json</code>. Rebuild with <code>npm run docs</code>.
  </p>
</footer>
</main>
<div class="doc-toast" data-toast hidden></div>
<script type="application/json" id="brand-data">${JSON.stringify(brandData).replace(/</g, '\\u003c')}</script>
<script src="docs.js?v=${assetHash('docs.js')}"></script>
</body>
</html>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'index.html'), page, 'utf8');

const kb = (Buffer.byteLength(page, 'utf8') / 1024).toFixed(1);
console.log(`Docs written to docs/index.html (${kb} KB) — ${BRANDS.length} brands, ${report.results.length} contrast rows`);
