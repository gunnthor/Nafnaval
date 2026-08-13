/** Raw record shape returned by the island.is mannanafnaskrá GraphQL API. */
export interface RegisterRecord {
  id: number;
  icelandicName: string;
  /** ST=stúlkunafn, DR=drengjanafn, MI=millinafn, KH=kynhlutlaust, RST/RDR=ritbreyting */
  type: NameType;
  /** Sam=samþykkt, Haf=hafnað, Óaf=óafgreitt */
  status: NameStatus | null;
  /** Ruling date, dd.mm.yyyy. Present on ~41% of records. */
  verdict: string | null;
  visible: boolean;
  /** Cross-reference to a preferred spelling — NOT a meaning. */
  description: string | null;
  url: string | null;
}

export type NameType = 'ST' | 'DR' | 'MI' | 'KH' | 'RST' | 'RDR';
export type NameStatus = 'Sam' | 'Haf' | 'Óaf';

/** How much we trust a meaning. Drives distinct visual treatment in the UI. */
export type Confidence = 'stadfest' | 'likleg' | 'ostadfest';

export type Gender = 'kvk' | 'kk' | 'hlutlaust';

/** One element of the curated Old Norse lexicon. */
export interface LexiconElement {
  /** Canonical form, lowercase, e.g. "þór". */
  id: string;
  /** Icelandic gloss shown to the reader. */
  merking: string;
  /** Longer explanatory note, optional. */
  skyring?: string;
  /** Spelling variants that map to this element (u-umlaut forms, older spellings). */
  afbrigdi?: string[];
  /** Where this element may legitimately appear in a compound. */
  stada: Array<'forlidur' | 'vidlidur'>;
  /** Category slugs this element confers on names containing it. */
  flokkar: string[];
  /** Public-domain source citation, e.g. "Zoëga 1910". */
  heimild: string;
}

/** A resolved segmentation of a name into lexicon elements. */
export interface Segment {
  /** The surface text as it appears in the name. */
  texti: string;
  /** Lexicon element id this segment resolved to, if any. */
  lidur: string | null;
  merking: string | null;
  heimild: string | null;
}

/** The final, build-time-resolved record backing every name page. */
export interface NameEntry {
  id: number;
  /** Display form, properly cased: "Þórbjörg". */
  nafn: string;
  /** URL slug, ASCII-folded: "thorbjorg". */
  slug: string;
  type: NameType;
  status: NameStatus | null;
  gender: Gender;
  /** True for RST/RDR records that are spelling variants of another name. */
  erRitbreyting: boolean;
  /** Slug of the parent name, for spelling variants. */
  ritbreytingAf: string | null;
  verdict: string | null;
  /** Resolved meaning summary, or null when nothing is known. */
  merking: string | null;
  /** Element breakdown. Empty when the name is not compositional or unresolved. */
  lidir: Segment[];
  confidence: Confidence | null;
  flokkar: string[];
  /** Popularity, present only for the ~top 100 per gender. */
  vinsaeldir: Popularity | null;
  /** Declension from BÍN, when available. */
  beyging: Declension | null;
}

export interface Popularity {
  /** Current rank among names of this gender. */
  saeti: number;
  /** Previous-year rank, when the source provides it. */
  fyrraSaeti: number | null;
  /** Number of bearers, when available. */
  fjoldi: number | null;
}

/** Singular declension: the four Icelandic cases. */
export interface Declension {
  nefnifall: string;
  tholfall: string;
  thagufall: string;
  eignarfall: string;
}
