import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { Decomposer } from '../src/lib/decompose.ts';
import type { LexiconElement, NameType } from '../src/lib/types.ts';

let dec: Decomposer;

beforeAll(() => {
  const yaml = readFileSync(resolve(import.meta.dirname, '../data/lexicon/elements.yaml'), 'utf8');
  const { elements } = parse(yaml) as { elements: LexiconElement[] };
  dec = new Decomposer(elements);
});

/** Convenience: the canonical element ids a name resolves to. */
function parts(name: string, type: NameType = 'ST'): string[] {
  return dec.decompose(name, type)?.segments.map((s) => s.lidur ?? s.texti) ?? [];
}

describe('compound decomposition', () => {
  it('splits the canonical two-part names', () => {
    expect(parts('þórbjörg', 'ST')).toEqual(['þór', 'björg']);
    expect(parts('guðrún', 'ST')).toEqual(['guð', 'rún']);
    expect(parts('arnþór', 'DR')).toEqual(['örn', 'þór']);
    expect(parts('sólveig', 'ST')).toEqual(['sól', 'veig']);
  });

  it('handles the masculine -ur ending without eating the stem', () => {
    expect(parts('guðmundur', 'DR')).toEqual(['guð', 'mundur']);
    expect(parts('ásgeir', 'DR')).toEqual(['ás', 'geir']);
  });

  it('resolves elements whose initial consonant assimilates in compounds', () => {
    // Sigríður is sigr + fríðr with the f lost; the surface form is only -ríð-.
    expect(parts('sigríður', 'ST')).toEqual(['sig', 'fríður']);
    expect(parts('ástríður', 'ST')).toEqual(['ást', 'fríður']);
  });

  it('resolves u-umlaut variants to the same element', () => {
    // björn/bjarn- and örn/arn- are the same word in different environments.
    expect(parts('bjarnheiður', 'ST')).toEqual(['björn', 'heiður']);
    expect(parts('arnbjörg', 'ST')).toEqual(['örn', 'björg']);
    expect(parts('bjargey', 'ST')).toEqual(['björg', 'ey']);
  });
});

describe('single-element names', () => {
  it('recognises a name that is one whole element', () => {
    expect(parts('lóa', 'ST')).toEqual(['lóa']);
    expect(parts('björg', 'ST')).toEqual(['björg']);
    expect(parts('rún', 'ST')).toEqual(['rún']);
    expect(parts('ösp', 'ST')).toEqual(['ösp']);
  });
});

describe('rejecting false splits', () => {
  it('does not split a name whose parts are not attested in those positions', () => {
    // "ín" is not an element at all, so krist + ín must not be produced.
    const d = dec.decompose('kristín', 'ST');
    expect(d?.segments.map((s) => s.lidur)).not.toEqual(['krist', 'ín']);
  });

  it('never returns a partial segmentation', () => {
    // Whatever comes back must account for the whole stem. Segments may
    // overlap by at most one character per seam (degemination), and linking
    // sounds may add at most two characters per seam.
    for (const name of ['kristín', 'jóhanna', 'sigríður', 'þórbjörg', 'anna', 'eiríkur']) {
      const d = dec.decompose(name, 'ST');
      if (!d) continue;
      const covered = d.segments.reduce((n, s) => n + s.texti.length, 0);
      const seams = d.segments.length - 1;
      const stemLen = name.length - d.ending.length;
      expect(covered).toBeLessThanOrEqual(stemLen + seams);
      expect(covered).toBeGreaterThanOrEqual(stemLen - seams * 2);
    }
  });

  it('returns null rather than guessing on clearly foreign names', () => {
    expect(dec.decompose('aaliyah', 'ST')).toBeNull();
    expect(dec.decompose('mateo', 'DR')).toBeNull();
  });
});

describe('confidence tiers', () => {
  it('marks clean canonical two-part compounds as staðfest', () => {
    expect(dec.decompose('þórbjörg', 'ST')?.confidence).toBe('stadfest');
    expect(dec.decompose('guðrún', 'ST')?.confidence).toBe('stadfest');
  });

  it('never reports higher than likleg for three-part splits', () => {
    const d = dec.decompose('sigurbjörg', 'ST');
    if (d && d.segments.length === 3) expect(d.confidence).toBe('likleg');
  });
});
