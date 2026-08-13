/**
 * Icelandic text handling. Every one of these exists because the naive
 * JS default is wrong for Icelandic in a way that shows up in the UI.
 */

/**
 * Icelandic alphabetical order:
 *   a á b c d ð e é f g h i í j k l m n o ó p q r s t u ú v w x y ý z þ æ ö
 * (c, q, w, z are not native letters but occur in borrowed names.)
 */
const ALPHABET = 'aábcdðeéfghiíjklmnoópqrstuúvwxyýzþæö';
const RANK = new Map([...ALPHABET].map((ch, i) => [ch, i]));

/**
 * Rank one character. Unknown letters are stripped of their diacritics and
 * retried, so ü sorts with u and ñ with n; anything still unknown sorts last
 * rather than landing somewhere arbitrary.
 */
function rank(ch: string): number {
  const known = RANK.get(ch);
  if (known !== undefined) return known;
  // NFD only as a fallback: decomposing up front would split á into a + ´ and
  // destroy the distinction between two separate Icelandic letters.
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const viaBase = RANK.get(base);
  if (viaBase !== undefined) return viaBase;
  return ALPHABET.length + (ch.codePointAt(0) ?? 0) / 0x110000;
}

/**
 * Compares two strings in Icelandic alphabetical order.
 *
 * DELIBERATELY NOT `Intl.Collator('is')`. Browsers that ship a reduced ICU —
 * and there are plenty, including some mobile webviews — silently resolve
 * `is` to `en-US`, which sorts Æsa before Anna and drops Ösp into the middle
 * of the alphabet. The server (full ICU) would then disagree with the client
 * on the same page. An explicit table is a few lines and always right.
 */
export function compareIcelandic(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] === y[i]) continue;
    const d = rank(x[i]) - rank(y[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return x.length - y.length;
}

/** Same shape as an Intl.Collator, so call sites read the same. */
export const collator = { compare: compareIcelandic };

/**
 * Formats a number the Icelandic way — 4973 becomes "4.973".
 * Same reasoning as the collator: `toLocaleString('is-IS')` returns "4,973"
 * wherever ICU is trimmed, so the hero and the list below it would disagree.
 */
export function tala(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(Math.round(n)).toString();
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits[i];
  }
  return sign + out;
}

export function sortNames<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => collator.compare(key(a), key(b)));
}

/**
 * Two-stage fold used for search matching, so someone typing on a non-Icelandic
 * keyboard still finds the name.
 *
 * Accents are stripped and the four special letters are expanded to their
 * conventional ASCII transliterations: þ→th, ð→d, æ→ae, ö→o.
 * So "Þóra" folds to "thora" and matches "thora", "Thora" and "Þóra".
 */
const FOLD_MAP: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ý: 'y',
  ð: 'd', þ: 'th', æ: 'ae', ö: 'o', ø: 'o', å: 'a',
  ä: 'a', ü: 'u', ë: 'e', ï: 'i', ñ: 'n', ç: 'c',
  // Old Norse forms that appear in the lexicon but never in modern names.
  'ǫ': 'o', 'ø̨': 'o', 'ɔ': 'o',
};

export function fold(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    out += FOLD_MAP[ch] ?? ch;
  }
  return out.replace(/[^a-z0-9]+/g, '');
}

/**
 * URL slug. Same folding as search so /nafn/thorbjorg is reachable by typing
 * the obvious ASCII spelling.
 */
export function slugify(name: string): string {
  const folded = name
    .toLowerCase()
    .split('')
    .map((ch) => FOLD_MAP[ch] ?? ch)
    .join('');
  return folded.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The register stores names lowercase ("þórbjörg"). Case them for display,
 * handling the compound and hyphenated entries that do occur.
 * JS uppercase mappings are correct for þ/æ/ö/ð, so no special-casing needed.
 */
export function displayCase(name: string): string {
  return name.replace(
    /(^|[\s\-])(\p{L})/gu,
    (_, boundary: string, letter: string) => boundary + letter.toUpperCase(),
  );
}

/**
 * Whether a name is spellable on a non-Icelandic keyboard — powers the
 * "auðvelt erlendis" filter for parents who expect to live abroad.
 */
export function isKeyboardFriendly(name: string): boolean {
  return !/[áðéíóúýþæö]/i.test(name);
}
