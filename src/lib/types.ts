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
  /** Cross-reference to a preferred spelling, NOT a meaning. */
  description: string | null;
  url: string | null;
}

export type NameType = 'ST' | 'DR' | 'MI' | 'KH' | 'RST' | 'RDR';
/** The register carries a record with no status at all, so this is nullable. */
export type NameStatus = 'Sam' | 'Haf' | 'Óaf' | null;

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
  /**
   * The element page's slug. Filled in by the build, not the decomposer: two
   * elements can fold to the same slug (fríður / friður), so it cannot be
   * derived from `lidur` alone without knowing the whole lexicon.
   */
  slug?: string;
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
  /**
   * For AI-drafted meanings only: the URL the draft was based on. Shown on the
   * page so a reader can check the claim rather than take it on trust.
   */
  aiHeimild?: string | null;
  aiHeimildTitill?: string | null;
}

/**
 * Bearer counts from Þjóðskrá. Unlike the Hagstofa tables, which only publish
 * the ~100 commonest names per gender, this covers every name down to a single
 * bearer, so nearly all names have real numbers rather than a blank.
 */
export interface Popularity {
  /** People whose FIRST name this is, today. */
  fjoldi: number;
  /** People whose SECOND name this is. Often much larger than `fjoldi`. */
  fjoldiAnnad: number;
  /** Both positions combined: the honest answer to "how many are called this". */
  alls: number;
  /** Rank by `fjoldi` among names of the same gender. Null when nobody bears it. */
  saeti: number | null;
  /** How many names of this gender are ranked, so "12 of 2,431" can be shown. */
  afFjolda: number | null;
  /** First-name count per year, aligned to the shared year axis. */
  ferill: number[];
  /** Change in first-name count over the last ten years, as a percentage. */
  breyting: number | null;
  /**
   * True when the name is registered under more than one gender and this entry
   * is not the one the count belongs to. Þjóðskrá counts by name string only,
   * so the figures above cover everyone called this, of any gender. Such
   * entries carry no `saeti`: a rank drawn from borrowed bearers is not a
   * rank, it is a claim.
   */
  kynOvisst: boolean;
}

/** Singular declension: the four Icelandic cases. */
export interface Declension {
  nefnifall: string;
  tholfall: string;
  thagufall: string;
  eignarfall: string;
}
