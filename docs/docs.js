/* Documentation page behaviour: brand switching, theme toggle, copy-to-clipboard,
   and scroll-spy. Deliberately dependency-free so the page works off disk. */
(() => {
  'use strict';

  const root = document.documentElement;
  const data = JSON.parse(document.getElementById('brand-data').textContent);
  const STORE = { brand: 'rds-docs-brand', theme: 'rds-docs-theme' };

  const readStored = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const store = (key, value) => {
    try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ }
  };

  /* ------------------------------------------------------------- branding */

  function applyBrand(slug) {
    const brand = data[slug];
    if (!brand) return;

    root.setAttribute('data-brand', slug);
    store(STORE.brand, slug);

    document.querySelectorAll('[data-set-brand]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.setBrand === slug));
    });

    const set = (sel, text) => document.querySelectorAll(sel).forEach((el) => { el.textContent = text; });
    set('[data-brand-name]', brand.name);
    set('[data-brand-tagline]', brand.tagline);
    set('[data-brand-promise]', brand.promise);
    set('[data-brand-role]', brand.role);

    // Inline rather than <img>: these use fill="currentColor".
    document.querySelectorAll('[data-logo-slot]').forEach((slot) => {
      slot.innerHTML = brand.markSvg;
    });
    document.querySelectorAll('[data-logo-lockup]').forEach((slot) => {
      slot.innerHTML = brand.horizontalSvg;
    });

    document.title = `${brand.name} — Design System`;
  }

  document.querySelectorAll('[data-set-brand]').forEach((btn) => {
    btn.addEventListener('click', () => applyBrand(btn.dataset.setBrand));
  });

  /* ---------------------------------------------------------------- theme */

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  function currentlyDark() {
    const forced = root.getAttribute('data-theme');
    return forced ? forced === 'dark' : prefersDark.matches;
  }

  function applyTheme(theme) {
    if (theme) {
      root.setAttribute('data-theme', theme);
      store(STORE.theme, theme);
    } else {
      root.removeAttribute('data-theme');
      store(STORE.theme, null);
    }
    const dark = currentlyDark();
    document.querySelectorAll('[data-toggle-theme]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(dark));
      const label = btn.querySelector('[data-theme-label]');
      if (label) label.textContent = dark ? 'Light' : 'Dark';
    });
  }

  document.querySelectorAll('[data-toggle-theme]').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(currentlyDark() ? 'light' : 'dark'));
  });

  prefersDark.addEventListener('change', () => {
    if (!root.getAttribute('data-theme')) applyTheme(null);
  });

  /* ------------------------------------------------------------ clipboard */

  const toast = document.querySelector('[data-toast]');
  let toastTimer;

  function say(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1600);
  }

  document.querySelectorAll('[data-copy]').forEach((el) => {
    el.addEventListener('click', async () => {
      const value = el.dataset.copy;
      try {
        await navigator.clipboard.writeText(value);
        say(`Copied ${value}`);
      } catch {
        // clipboard API needs a secure context; file:// does not qualify.
        const field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const ok = document.execCommand?.('copy');
        field.remove();
        say(ok ? `Copied ${value}` : value);
      }
    });
  });

  /* Logo links open the SVG in a new tab and are plain anchors — no JS. The
     Blob-download interception that used to live here has been removed: it
     saved files rather than opening them, which is not what these controls are
     for. Right-click > Save As is the browser's own download path and needs no
     help from us. */

  /* ----------------------------------------------------------- scroll spy */

  const links = [...document.querySelectorAll('.doc-nav a[href^="#"]')];
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const sections = [...document.querySelectorAll('.doc-section, .doc-header')]
    .filter((s) => byId.has(s.id));

  if ('IntersectionObserver' in window && sections.length) {
    const seen = new Set();
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
      links.forEach((a) => a.removeAttribute('aria-current'));
      const first = sections.find((s) => seen.has(s.id));
      if (first) byId.get(first.id).setAttribute('aria-current', 'true');
    }, { rootMargin: '-10% 0px -70% 0px' });
    sections.forEach((s) => spy.observe(s));
  }

  /* ----------------------------------------------------------------- init */

  applyBrand(readStored(STORE.brand) ?? root.getAttribute('data-brand') ?? 'robo-coop');
  applyTheme(readStored(STORE.theme));
})();
