import { describe, it, expect } from 'vitest';
import { compareIcelandic, tala, fold, slugify, displayCase, isKeyboardFriendly } from '../src/lib/icelandic.ts';

const sorted = (xs: string[]) => [...xs].sort(compareIcelandic);

describe('Icelandic collation', () => {
  it('orders the alphabet correctly', () => {
    expect(
      sorted(['ösp', 'þóra', 'æsa', 'anna', 'ása', 'dóra', 'elín', 'ír', 'úlfur', 'ýr', 'björk']),
    ).toEqual(['anna', 'ása', 'björk', 'dóra', 'elín', 'ír', 'úlfur', 'ýr', 'þóra', 'æsa', 'ösp']);
  });

  it('treats accented vowels as their own letters, not variants', () => {
    // The whole point: á is a distinct letter that follows every plain a.
    expect(compareIcelandic('a', 'á')).toBeLessThan(0);
    expect(compareIcelandic('anna', 'ása')).toBeLessThan(0);
    expect(compareIcelandic('o', 'ó')).toBeLessThan(0);
  });

  it('places ð after d, and þ æ ö at the very end', () => {
    expect(compareIcelandic('d', 'ð')).toBeLessThan(0);
    expect(compareIcelandic('ð', 'e')).toBeLessThan(0);
    expect(compareIcelandic('y', 'þ')).toBeLessThan(0);
    expect(compareIcelandic('þ', 'æ')).toBeLessThan(0);
    expect(compareIcelandic('æ', 'ö')).toBeLessThan(0);
  });

  it('is case-insensitive', () => {
    expect(compareIcelandic('Anna', 'anna')).toBe(0);
    expect(compareIcelandic('Þóra', 'þóra')).toBe(0);
  });

  it('sorts a prefix before the longer name', () => {
    expect(compareIcelandic('anna', 'annabella')).toBeLessThan(0);
  });

  it('handles foreign letters without throwing them to the front', () => {
    // ü should sit with u, not before every Icelandic letter.
    expect(compareIcelandic('anna', 'über')).toBeLessThan(0);
    expect(compareIcelandic('über', 'þóra')).toBeLessThan(0);
  });

  /**
   * This is the regression that motivated replacing Intl.Collator: a browser
   * with a trimmed ICU resolves 'is' to 'en-US' and produces this order.
   */
  it('does not reproduce the en-US fallback ordering', () => {
    expect(sorted(['æsa', 'anna'])).toEqual(['anna', 'æsa']);
    expect(sorted(['ösp', 'úlfur'])).toEqual(['úlfur', 'ösp']);
  });
});

describe('number formatting', () => {
  it('uses a dot as the thousands separator', () => {
    expect(tala(4973)).toBe('4.973');
    expect(tala(1000000)).toBe('1.000.000');
  });

  it('leaves short numbers alone', () => {
    expect(tala(0)).toBe('0');
    expect(tala(42)).toBe('42');
    expect(tala(999)).toBe('999');
  });

  it('handles the boundary and negatives', () => {
    expect(tala(1000)).toBe('1.000');
    expect(tala(-1234)).toBe('-1.234');
  });
});

describe('folding and slugs', () => {
  it('folds Icelandic letters to their ASCII transliterations', () => {
    expect(fold('Þóra')).toBe('thora');
    expect(fold('Guðrún')).toBe('gudrun');
    expect(fold('Sæbjörg')).toBe('saebjorg');
  });

  it('produces stable slugs', () => {
    expect(slugify('Þórbjörg')).toBe('thorbjorg');
    expect(slugify('Lóa')).toBe('loa');
  });

  it('cases names for display without breaking special letters', () => {
    expect(displayCase('þórbjörg')).toBe('Þórbjörg');
    expect(displayCase('ösp')).toBe('Ösp');
    expect(displayCase('ægir')).toBe('Ægir');
  });
});

describe('auðvelt erlendis', () => {
  it('accepts names whose marks can simply be dropped', () => {
    // Róbert → Robert, María → Maria, Björk → Bjork: same name abroad.
    for (const n of ['Róbert', 'María', 'Björk', 'Ólafur', 'Kristín', 'Ósk', 'Ýr']) {
      expect(isKeyboardFriendly(n)).toBe(true);
    }
  });

  it('rejects names that must be transliterated to be written', () => {
    // No single-letter substitute exists, so the spelling changes shape.
    for (const n of ['Þóra', 'Guðrún', 'Sæbjörg', 'Æsa', 'Sigríður']) {
      expect(isKeyboardFriendly(n)).toBe(false);
    }
  });

  it('treats ö as droppable but ð as not, even in the same name', () => {
    expect(isKeyboardFriendly('Höskuldur')).toBe(true); // Hoskuldur
    expect(isKeyboardFriendly('Höröur')).toBe(true);
    expect(isKeyboardFriendly('Hörður')).toBe(false); // ð → Hordur
  });

  it('plain ASCII names always qualify', () => {
    expect(isKeyboardFriendly('Anna')).toBe(true);
    expect(isKeyboardFriendly('Jon')).toBe(true);
  });
});
