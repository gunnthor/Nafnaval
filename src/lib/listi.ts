/**
 * The shortlist — names the visitor has saved while choosing.
 *
 * Stored in localStorage, never sent anywhere. The site is static and has no
 * accounts, so the only way to move a list between devices (or send it to the
 * other parent) is the share link, which encodes the slugs in the URL.
 */

const KEY = 'nafnaval:listi';
const EVENT = 'nafnaval:listi-breytt';

export function lesa(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    // Private-mode Safari and disabled storage both throw here. A shortlist
    // that silently doesn't persist is better than a page that breaks.
    return [];
  }
}

function skrifa(slugs: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(slugs));
  } catch {
    /* storage unavailable — keep working in-memory for this page view */
  }
  document.dispatchEvent(new CustomEvent(EVENT, { detail: slugs }));
}

export function erAListanum(slug: string): boolean {
  return lesa().includes(slug);
}

/** Adds or removes, and returns the new membership state. */
export function vixla(slug: string): boolean {
  const current = lesa();
  const i = current.indexOf(slug);
  if (i >= 0) {
    current.splice(i, 1);
    skrifa(current);
    return false;
  }
  current.push(slug);
  skrifa(current);
  return true;
}

export function fjarlaegja(slug: string) {
  skrifa(lesa().filter((s) => s !== slug));
}

export function hreinsa() {
  skrifa([]);
}

/** Merge slugs from a share link into whatever is already saved. */
export function flytjaInn(slugs: string[]) {
  const current = lesa();
  for (const s of slugs) if (!current.includes(s)) current.push(s);
  skrifa(current);
}

export function viObreytingu(fn: (slugs: string[]) => void) {
  document.addEventListener(EVENT, (e) => fn((e as CustomEvent<string[]>).detail));
  // Keep tabs in sync when the list changes in another one.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) fn(lesa());
  });
}

/**
 * Paints every [data-vista] button on the page to match the saved list.
 * Safe to call after each re-render.
 */
export function samstillaHnappa(root: ParentNode = document) {
  const saved = new Set(lesa());
  for (const btn of root.querySelectorAll<HTMLElement>('[data-vista]')) {
    const on = saved.has(btn.dataset.vista!);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    // Buttons with a visible text label keep it; the star lives in its own
    // span so repainting never destroys the wording next to it.
    const star = btn.querySelector('.stjarna');
    const label = btn.querySelector('.vista-texti');
    if (star) star.textContent = on ? '★' : '☆';
    else btn.textContent = on ? '★' : '☆';
    if (label) label.textContent = on ? 'Á listanum' : 'Setja á listann';
    btn.setAttribute('aria-label', on ? 'Fjarlægja af listanum' : 'Setja á listann');
  }
}

/**
 * Binds the one delegated click handler for save buttons, and keeps them
 * painted. Idempotent: several pages call it, and binding twice would
 * double-toggle every click (add then immediately remove).
 *
 * The guard lives on the document, not in module scope, because the layout
 * script and the page script can be bundled separately — two module instances,
 * one DOM.
 */
export function tengjaHnappa() {
  samstillaHnappa();
  const doc = document.documentElement.dataset;
  if (doc.listiBundinn === 'true') return;
  doc.listiBundinn = 'true';

  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-vista]');
    if (!btn) return;
    // Save buttons sit inside the result link; without this the browser
    // navigates to the name page instead of saving it.
    e.preventDefault();
    e.stopPropagation();
    vixla(btn.dataset.vista!);
  });

  viObreytingu(() => samstillaHnappa());
}

/** Updates the "Listinn (n)" counter in the header. */
export function tengjaTeljara() {
  const el = document.getElementById('listi-teljari');
  if (!el) return;
  const sync = (slugs: string[]) => {
    el.textContent = slugs.length ? String(slugs.length) : '';
    el.hidden = slugs.length === 0;
  };
  viObreytingu(sync);
  sync(lesa());
}
