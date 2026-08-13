/**
 * Icelandic text handling. Every one of these exists because the naive
 * JS default is wrong for Icelandic in a way that shows up in the UI.
 */

/**
 * Collator for Icelandic alphabetical order:
 *   a á b d ð e é f g h i í j k l m n o ó p r s t u ú v x y ý þ æ ö
 * Default `Array.sort()` puts þ/æ/ö after z and sorts á next to a — both wrong.
 * Always sort user-visible name lists through this.
 */
export const collator = new Intl.Collator('is', { sensitivity: 'base', numeric: true });

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
