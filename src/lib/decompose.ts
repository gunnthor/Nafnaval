/**
 * Splits an Icelandic name into its constituent Old Norse elements.
 *
 * This is the engine behind the "dig into it" feature: Þórbjörg becomes
 * þór + björg, "the god Þórr" + "protection", and each part links to every
 * other name sharing it.
 *
 * The two things that make this non-trivial in Icelandic:
 *
 *  1. INFLECTION. Names carry a nominative ending that is not part of the
 *     meaning — Guðmundur is guð + mund + -ur. We try each plausible ending
 *     (including none) and let scoring pick.
 *
 *  2. U-UMLAUT. The same element surfaces differently depending on position:
 *     björn but Bjarnheiður, björg but Bjargey, örn but Arnþór. These pairs
 *     live in each element's `afbrigdi` list.
 *
 * The hard constraint throughout: a segmentation must consume the ENTIRE stem.
 * Partial matches are how you get nonsense like Kristín → krist + ín, so they
 * are rejected outright rather than scored down.
 */
import type { Confidence, LexiconElement, NameType, Segment } from './types.ts';

export interface Decomposition {
  segments: Segment[];
  confidence: Confidence;
  /** The inflectional ending that was stripped, if any. */
  ending: string;
  score: number;
}

/**
 * Nominative endings, longest first. The empty string matters: plenty of names
 * (Björg, Rún, Ósk) are the bare stem with no ending at all.
 */
const ENDINGS_KK = ['ur', 'nn', 'll', 'r', 'i', 'n', 'l', 's', ''];
const ENDINGS_KVK = ['ur', 'a', 'r', 'i', 'n', ''];

/**
 * Linking sounds that appear between the parts of a compound (Sigurs-teinn,
 * Ragn-a-r). At most one, and it costs score, so a clean split always wins.
 */
const LINKERS = ['s', 'a', 'u', 'i', 'n', 'ar', 'is'];

const VOWELS = new Set(['a','á','e','é','i','í','o','ó','u','ú','y','ý','æ','ö']);

const MIN_SEGMENT_LEN = 2;
const MAX_SEGMENTS = 3;

export class Decomposer {
  /** Every surface form (canonical id and every variant) → its element. */
  private forms = new Map<string, LexiconElement>();
  private maxFormLen = 0;

  constructor(private elements: LexiconElement[]) {
    for (const el of elements) {
      this.register(el.id, el);
      for (const variant of el.afbrigdi ?? []) this.register(variant, el);
    }
  }

  private register(form: string, el: LexiconElement) {
    const key = form.toLowerCase();
    // A canonical id always wins over another element's variant, so that
    // e.g. "björg" resolves to björg rather than to a variant of borg.
    if (!this.forms.has(key) || el.id === key) this.forms.set(key, el);
    this.maxFormLen = Math.max(this.maxFormLen, key.length);
  }

  getElement(id: string): LexiconElement | undefined {
    return this.forms.get(id.toLowerCase());
  }

  get size() {
    return this.elements.length;
  }

  /**
   * Decompose a name. Returns null when nothing sufficiently convincing is
   * found — the caller then falls through to overrides or an AI draft.
   */
  decompose(name: string, type: NameType): Decomposition | null {
    const lower = name.toLowerCase();
    const endings = type === 'ST' ? ENDINGS_KVK : type === 'DR' ? ENDINGS_KK : [...new Set([...ENDINGS_KK, ...ENDINGS_KVK])];

    let best: Decomposition | null = null;

    for (const ending of endings) {
      if (ending && !lower.endsWith(ending)) continue;
      const stem = ending ? lower.slice(0, -ending.length) : lower;
      if (stem.length < MIN_SEGMENT_LEN) continue;

      for (const segments of this.segment(stem)) {
        const score = this.score(segments, ending, stem);
        if (!best || score > best.score) {
          best = {
            segments: segments.map((s) => this.toSegment(s)),
            confidence: 'likleg',
            ending,
            score,
          };
        }
      }
    }

    if (!best) return null;
    best.confidence = this.confidenceOf(best);
    return best;
  }

  /**
   * All full-coverage segmentations of `stem`, longest match first.
   * Yields raw matches; positional legality is checked here so that illegal
   * splits are never produced in the first place.
   */
  private *segment(
    stem: string,
    depth = 0,
    isFirst = true,
  ): Generator<RawMatch[]> {
    if (stem.length === 0) return;
    if (depth >= MAX_SEGMENTS) return;

    const maxLen = Math.min(stem.length, this.maxFormLen);
    for (let len = maxLen; len >= MIN_SEGMENT_LEN; len--) {
      const head = stem.slice(0, len);
      const el = this.forms.get(head);
      if (!el) continue;

      const rest = stem.slice(len);
      const isLast = rest.length === 0;

      // Position legality. A single-element name may sit in either slot; in a
      // compound the first part must be attested as a forliður and the last as
      // a viðliður. This is what keeps Kristín from splitting.
      if (isFirst && isLast) {
        // whole name is one element — always allowed
      } else if (isFirst && !el.stada.includes('forlidur')) {
        continue;
      } else if (isLast && !el.stada.includes('vidlidur')) {
        continue;
      }

      const match: RawMatch = { text: head, element: el, linker: '', shared: false };

      if (isLast) {
        yield [match];
        continue;
      }

      for (const tail of this.segment(rest, depth + 1, false)) {
        yield [match, ...tail];
      }

      // Same again, but allowing a linking sound to be consumed first.
      for (const linker of LINKERS) {
        if (!rest.startsWith(linker) || rest.length <= linker.length) continue;
        const afterLink = rest.slice(linker.length);
        for (const tail of this.segment(afterLink, depth + 1, false)) {
          yield [{ ...match, linker }, ...tail];
        }
      }

      // Degemination at the compound seam: when both parts meet on the same
      // consonant, Icelandic writes it once. Eir + ríkur surfaces as Eiríkur,
      // Þór + rún as Þórún. Let the boundary consonant do double duty.
      const seam = head.at(-1)!;
      if (!VOWELS.has(seam) && rest.length >= MIN_SEGMENT_LEN) {
        for (const tail of this.segment(seam + rest, depth + 1, false)) {
          yield [{ ...match, shared: true }, ...tail];
        }
      }
    }
  }

  private score(matches: RawMatch[], ending: string, stem: string): number {
    let score = 0;

    // Coverage is the dominant term: characters explained by real elements.
    const covered = matches.reduce((n, m) => n + m.text.length, 0);
    score += (covered / stem.length) * 100;

    // Two-part compounds are the canonical Icelandic shape; three-part names
    // exist but are rarer, and a spurious third part is a common failure mode.
    if (matches.length === 2) score += 25;
    else if (matches.length === 1) score += 20;
    else score -= 15;

    for (const m of matches) {
      // Longer matches are more likely to be real elements than short ones.
      score += Math.min(m.text.length, 6) * 2;
      // Canonical spelling beats a variant.
      if (m.text === m.element.id) score += 4;
      // Very short segments are where false splits come from.
      if (m.text.length <= 2) score -= 12;
      if (m.linker) score -= 6;
      if (m.shared) score -= 18;
    }

    // Prefer explaining the name with as little stripping as possible.
    score -= ending.length * 3;

    return score;
  }

  /**
   * Confidence tiers. These map directly to the three visual treatments in the
   * UI, so the thresholds are deliberately conservative — it is much worse to
   * present a guess as settled than to under-claim.
   */
  private confidenceOf(d: Decomposition): Confidence {
    const parts = d.segments.length;
    const allSolid = d.segments.every((s) => s.texti.length >= 3);
    const canonical = d.segments.every((s) => s.lidur === s.texti);

    if (parts <= 2 && allSolid && d.score >= 130) return 'stadfest';
    if (parts <= 2 && allSolid && canonical) return 'stadfest';
    return 'likleg';
  }

  private toSegment(m: RawMatch): Segment {
    return {
      texti: m.text,
      lidur: m.element.id,
      merking: m.element.merking,
      heimild: m.element.heimild,
    };
  }
}

interface RawMatch {
  text: string;
  element: LexiconElement;
  linker: string;
  /** True when this segment's final consonant is shared with the next one. */
  shared?: boolean;
}

/** Builds the human-readable meaning line from a segmentation. */
export function meaningFromSegments(segments: Segment[]): string {
  const parts = segments.map((s) => s.merking).filter(Boolean) as string[];
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.join(' + ');
}
