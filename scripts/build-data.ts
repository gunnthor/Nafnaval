/**
 * Merges every source into the single dataset the site builds from.
 *
 * Precedence for a name's meaning, highest first:
 *   1. data/overrides/names.yaml   — hand-written, always wins
 *   2. lexicon decomposition       — deterministic, cites a dictionary
 *   3. data/ai/drafts.json         — Claude-drafted, always labelled óstaðfest
 *   4. nothing                     — the page says so plainly
 *
 * Output: src/data/nofn.json (full records) and public/leit.json (compact
 * client-side search/filter index).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { Decomposer, meaningFromSegments } from '../src/lib/decompose.ts';
import { slugify, displayCase, fold, isKeyboardFriendly, collator } from '../src/lib/icelandic.ts';
import { CATEGORY_BY_SLUG } from '../src/lib/categories.ts';
import type {
  RegisterRecord, LexiconElement, NameEntry, Segment, Gender, Confidence, Declension, Popularity,
} from '../src/lib/types.ts';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const readJson = <T>(p: string): T => JSON.parse(read(p)) as T;

interface Override {
  nafn: string;
  merking: string;
  skyring?: string;
  lidir?: string[];
  uppruni?: string;
  flokkar?: string[];
  heimild?: string;
  confidence?: Confidence;
}

interface AiDraft {
  nafn: string;
  merking: string;
  skyring?: string;
  uppruni?: string;
  flokkar?: string[];
  /** URL the draft was based on. Rendered on the page so it can be checked. */
  heimild?: string;
  heimildTitill?: string;
}

// ── Load every source ───────────────────────────────────────────────────────
const register = readJson<RegisterRecord[]>('data/raw/mannanafnaskra.json');
const { elements } = parse(read('data/lexicon/elements.yaml')) as { elements: LexiconElement[] };
const { names: overrideList } = parse(read('data/overrides/names.yaml')) as { names: Override[] };

const binPath = resolve(root, 'data/raw/beygingar.json');
const declensions = existsSync(binPath)
  ? readJson<{ entries: Array<{ nafn: string; beyging: Declension }> }>('data/raw/beygingar.json').entries
  : [];

/**
 * Bearer counts from Þjóðskrá. Replaces the Hagstofa popularity tables, which
 * only ever covered ~100 names per gender; this covers essentially all of them.
 */
const tidniPath = resolve(root, 'data/raw/nafntidni.json');
const tidni = existsSync(tidniPath)
  ? readJson<{ ar: number[]; nofn: Record<string, { e: number[]; a: number[] }> }>(
      'data/raw/nafntidni.json',
    )
  : { ar: [], nofn: {} };

const draftsPath = resolve(root, 'data/ai/drafts.json');
const drafts = existsSync(draftsPath) ? readJson<AiDraft[]>('data/ai/drafts.json') : [];

/** Faith tags keyed by lowercase name. A name may carry several. */
const { truarbrogd } = parse(read('data/overrides/truarbrogd.yaml')) as {
  truarbrogd: Record<string, string[]>;
};
const faithByName = new Map<string, Set<string>>();
for (const [faith, list] of Object.entries(truarbrogd)) {
  for (const nafn of list) {
    const key = nafn.toLowerCase();
    (faithByName.get(key) ?? faithByName.set(key, new Set()).get(key)!).add(faith);
  }
}

const decomposer = new Decomposer(elements);
const overrides = new Map(overrideList.map((o) => [o.nafn.toLowerCase(), o]));
const draftsByName = new Map(drafts.map((d) => [d.nafn.toLowerCase(), d]));
const elementById = new Map(elements.map((e) => [e.id, e]));
/**
 * Element page slugs. `fríður` and `friður` are different words that fold to the
 * same slug, so they are numbered exactly like colliding name slugs are. Both the
 * element pages and the links on name pages read this one map. Deriving the slug
 * independently on either side is what silently dropped one of the two pages.
 */
const elementSlugs = new Map<string, string>();
{
  const counts = new Map<string, number>();
  for (const el of elements) {
    const base = slugify(el.id);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    elementSlugs.set(el.id, seen > 0 ? `${base}-${seen + 1}` : base);
  }
}
const declensionByName = new Map(declensions.map((d) => [d.nafn.toLowerCase(), d.beyging]));
/** A name is "rare" below this many bearers, first name and middle name summed. */
const RARE_THRESHOLD = 30;

// ── Bearer counts and ranks ─────────────────────────────────────────────────
const YEAR_AXIS = tidni.ar;
const latest = (xs: number[]) => (xs.length ? xs[xs.length - 1] : 0);

/** Which ranking bucket a register type belongs to. */
const bucketOf = (type: RegisterRecord['type']) =>
  type === 'ST' ? 'kvk' : type === 'DR' ? 'kk' : 'annad';

/**
 * Which gender a shared name's bearer count actually belongs to.
 *
 * Þjóðskrá's frequency service is keyed by the name string alone and has no
 * gender dimension, so a name registered under two genders gets the same total
 * attached to both records. 24 approved names are in that position, and the
 * effect was not cosmetic: Auður is registered as a drengjanafn (úrskurður
 * 29.11.2013) as well as a stúlkunafn, so the male record claimed all 1,106
 * bearers of a name borne overwhelmingly by women, and the rank derived from
 * that count seated him 26th of 1,694 karlmannsnöfn — displacing every real
 * men's name below him by a place.
 *
 * The register breaks the tie itself. A name grandfathered in carries no
 * mannanafnanefnd verdict; one added later carries the date of its ruling.
 * The count series starts in 2004, so a registration dated after that had
 * essentially no bearers when the series began, and the count belongs to the
 * older registration. That gives Auður to kvk, which the gendered Hagstofa
 * table confirms independently (kvk, 1,113 bearers, 22nd). It also gives Blær
 * to kk, matching the 2013 case in which a girl won the right to a name that
 * already existed for boys.
 *
 * This is an inference from registration dates, not a measurement, so it is
 * only ever allowed to decide who gets ranked. It never invents a number. The
 * 4 names where both genders are grandfathered stay unresolved and neither
 * side is ranked.
 */
const countOwner = new Map<string, string>();
const sharedCount = new Set<string>();
{
  const verdictTime = (v: string | null) => {
    const m = v ? /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(v) : null;
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
  };
  /** name -> bucket -> earliest verdict for that bucket, null when undated. */
  const byName = new Map<string, Map<string, number | null>>();
  for (const rec of register) {
    if (rec.status !== 'Sam') continue;
    if (rec.type === 'RST' || rec.type === 'RDR') continue;
    const buckets =
      byName.get(rec.icelandicName) ??
      byName.set(rec.icelandicName, new Map()).get(rec.icelandicName)!;
    const g = bucketOf(rec.type);
    const t = verdictTime(rec.verdict);
    const cur = buckets.get(g);
    // Undated outranks any date, and among dates the earliest wins.
    if (cur === undefined || (cur !== null && (t === null || t < cur))) buckets.set(g, t);
  }
  for (const [name, buckets] of byName) {
    if (buckets.size < 2) continue;
    sharedCount.add(name);
    const undated = [...buckets].filter(([, t]) => t === null);
    if (undated.length === 1) {
      countOwner.set(name, undated[0][0]);
    } else if (undated.length === 0) {
      const sorted = [...buckets].sort((a, b) => a[1]! - b[1]!);
      if (sorted[0][1] !== sorted[1][1]) countOwner.set(name, sorted[0][0]);
    }
  }
}

/**
 * True when this record displays a count it cannot claim as its own gender's.
 * Unresolved names return true for every gender, so nobody claims them.
 */
const countIsShared = (lower: string, type: RegisterRecord['type']) =>
  sharedCount.has(lower) && countOwner.get(lower) !== bucketOf(type);

/**
 * Rank is computed here rather than taken from a source, because no source
 * ranks every name — Þjóðskrá publishes counts, so the ordering is ours to
 * derive. Ranked within gender, by first-name bearers, ties sharing a rank.
 *
 * Keyed by bucket AND name: 31 names are registered under more than one type
 * (Aldan is both DR and MI, Alex is both ST and DR). Keying by name alone let
 * the last bucket processed overwrite the others, so Aldan carried the
 * 52-name millinafn ranking while being displayed as a karlmannsnafn.
 */
const rankByName = new Map<string, { saeti: number; af: number }>();
{
  const byGender = new Map<string, Array<{ nafn: string; n: number }>>();
  for (const rec of register) {
    if (rec.status !== 'Sam') continue;
    if (rec.type === 'RST' || rec.type === 'RDR') continue;
    // A borrowed count must not buy a place in the ranking, nor push the
    // names below it down one.
    if (countIsShared(rec.icelandicName, rec.type)) continue;
    const n = latest(tidni.nofn[rec.icelandicName]?.e ?? []);
    if (n <= 0) continue;
    const g = bucketOf(rec.type);
    (byGender.get(g) ?? byGender.set(g, []).get(g)!).push({ nafn: `${g}|${rec.icelandicName}`, n });
  }
  for (const list of byGender.values()) {
    list.sort((a, b) => b.n - a.n);
    let saeti = 0;
    let prev = Number.POSITIVE_INFINITY;
    list.forEach((item, i) => {
      if (item.n < prev) {
        saeti = i + 1;
        prev = item.n;
      }
      rankByName.set(item.nafn, { saeti, af: list.length });
    });
  }
}

function popularityFor(lower: string, type: RegisterRecord['type']): Popularity | null {
  const row = tidni.nofn[lower];
  if (!row) return null;
  const fjoldi = latest(row.e);
  const fjoldiAnnad = latest(row.a);
  if (fjoldi === 0 && fjoldiAnnad === 0) return null;

  // Ten years back on the same axis, so the comparison is like-for-like.
  const tenBack = row.e.length >= 11 ? row.e[row.e.length - 11] : 0;
  const breyting = tenBack > 0 ? Math.round(((fjoldi - tenBack) / tenBack) * 100) : null;
  const rank = rankByName.get(`${bucketOf(type)}|${lower}`);

  return {
    fjoldi,
    fjoldiAnnad,
    alls: fjoldi + fjoldiAnnad,
    saeti: rank?.saeti ?? null,
    afFjolda: rank?.af ?? null,
    ferill: row.e,
    breyting,
    kynOvisst: countIsShared(lower, type),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function genderOf(type: RegisterRecord['type']): Gender {
  if (type === 'KH') return 'hlutlaust';
  if (type === 'ST' || type === 'RST') return 'kvk';
  if (type === 'DR' || type === 'RDR') return 'kk';
  return 'hlutlaust'; // MI — middle names are not gendered
}

/** Builds an element breakdown from explicit ids in an override. */
function segmentsFromIds(ids: string[]): Segment[] {
  return ids.flatMap((id) => {
    const el = elementById.get(id);
    if (!el) {
      console.warn(`  ⚠ Óþekktur liður "${id}" í yfirskrift`);
      return [];
    }
    return [{ texti: el.id, lidur: el.id, merking: el.merking, heimild: el.heimild }];
  });
}

/** Ruling dates are dd.mm.yyyy; we only need the year. */
function verdictYear(verdict: string | null): number | null {
  const m = verdict && /(\d{4})/.exec(verdict);
  return m ? Number(m[1]) : null;
}

// ── Resolve every record ────────────────────────────────────────────────────
const entries: NameEntry[] = [];
const slugCounts = new Map<string, number>();
const tally = { override: 0, lexicon: 0, ai: 0, none: 0 };

for (const rec of register) {
  const lower = rec.icelandicName.toLowerCase();
  const nafn = displayCase(rec.icelandicName);

  // Slugs must be unique; folding can collide (Þóra/Tóra both → thora).
  let slug = slugify(rec.icelandicName);
  const seen = slugCounts.get(slug) ?? 0;
  slugCounts.set(slug, seen + 1);
  if (seen > 0) slug = `${slug}-${seen + 1}`;

  let merking: string | null = null;
  let skyring: string | null = null;
  let lidir: Segment[] = [];
  let confidence: Confidence | null = null;
  let uppruni: string | null = null;
  let aiHeimild: string | null = null;
  let aiHeimildTitill: string | null = null;
  const flokkar = new Set<string>();

  const override = overrides.get(lower);
  const draft = draftsByName.get(lower);
  const decomposed = decomposer.decompose(rec.icelandicName, rec.type);

  if (override) {
    merking = override.merking;
    skyring = override.skyring ?? null;
    lidir = override.lidir ? segmentsFromIds(override.lidir) : [];
    confidence = override.confidence ?? 'stadfest';
    uppruni = override.uppruni ?? null;
    for (const f of override.flokkar ?? []) flokkar.add(f);
    tally.override++;
  } else if (decomposed) {
    lidir = decomposed.segments;
    merking = meaningFromSegments(lidir);
    confidence = decomposed.confidence;
    uppruni = 'norræna';
    tally.lexicon++;
  } else if (draft) {
    merking = draft.merking;
    skyring = draft.skyring ?? null;
    confidence = 'ostadfest';
    uppruni = draft.uppruni ?? null;
    aiHeimild = draft.heimild ?? null;
    aiHeimildTitill = draft.heimildTitill ?? null;
    for (const f of draft.flokkar ?? []) flokkar.add(f);
    tally.ai++;
  } else {
    tally.none++;
  }

  // Categories inherited from whichever elements ended up in the breakdown.
  for (const seg of lidir) {
    const el = seg.lidur ? elementById.get(seg.lidur) : undefined;
    for (const f of el?.flokkar ?? []) flokkar.add(f);
  }

  // ── Rule-based categories ────────────────────────────────────────────────
  const popularity = popularityFor(lower, rec.type);
  const year = verdictYear(rec.verdict);

  if (rec.type === 'KH') flokkar.add('kynhlutlaust');
  if (rec.type === 'MI') flokkar.add('millinafn');
  // Both are counted on first name + middle name combined, because a name can
  // be uncommon in first position and ordinary overall (Lóa: 202 + 472).
  //
  // These thresholds used to be "has popularity data" vs "has none", which made
  // sense when the source only published the top ~100 per gender. Þjóðskrá
  // covers every name, so that rule tagged 90% of the register as "vinsæl".
  if (rec.status === 'Sam') {
    // Rank only means "popular" inside the two large gender buckets. The
    // neutral/middle-name bucket holds a few hundred names, so a name with a
    // single bearer ranks inside its top 100 — which is how Agl (1 bearer)
    // ended up tagged both vinsæl and sjaldgæf.
    const g = genderOf(rec.type);
    const ranked = g === 'kvk' || g === 'kk';
    if (ranked && popularity?.saeti != null && popularity.saeti <= 100) flokkar.add('vinsael');
    if ((popularity?.alls ?? 0) < RARE_THRESHOLD) flokkar.add('sjaldgaeft');
  }
  if (year && year >= 2015) flokkar.add('nysamthykkt');
  if (rec.icelandicName.length <= 5) flokkar.add('stutt');
  if (isKeyboardFriendly(rec.icelandicName)) flokkar.add('audvelt-erlendis');
  if (uppruni && uppruni !== 'norræna' && uppruni !== 'íslenska') flokkar.add('erlent');

  // ── Faith tags, then parent inheritance ──────────────────────────────────
  for (const faith of faithByName.get(lower) ?? []) flokkar.add(faith);
  // A name tagged with any faith is also tagged Trúarbrögð, so the parent
  // filter catches every tradition at once. Runs after every other tagging
  // step so it also picks up faiths conferred by lexicon elements.
  for (const f of [...flokkar]) {
    const parent = CATEGORY_BY_SLUG.get(f)?.parent;
    if (parent) flokkar.add(parent);
  }

  entries.push({
    id: rec.id,
    nafn,
    slug,
    type: rec.type,
    status: rec.status,
    gender: genderOf(rec.type),
    erRitbreyting: rec.type === 'RST' || rec.type === 'RDR',
    // The register puts the preferred spelling in `description` for variants.
    ritbreytingAf: rec.description ? slugify(rec.description) : null,
    verdict: rec.verdict,
    merking,
    lidir,
    confidence,
    flokkar: [...flokkar].sort(),
    vinsaeldir: popularity,
    aiHeimild,
    aiHeimildTitill,
    beyging: declensionByName.get(lower) ?? null,
    ...(skyring ? { skyring } : {}),
  } as NameEntry & { skyring?: string });
}

entries.sort((a, b) => collator.compare(a.nafn, b.nafn));

// ── Write outputs ───────────────────────────────────────────────────────────
mkdirSync(resolve(root, 'src/data'), { recursive: true });
for (const entry of entries) {
  for (const seg of entry.lidir) {
    if (seg.lidur) seg.slug = elementSlugs.get(seg.lidur);
  }
}

writeFileSync(resolve(root, 'src/data/nofn.json'), JSON.stringify(entries), 'utf8');
writeFileSync(resolve(root, 'src/data/ar.json'), JSON.stringify(YEAR_AXIS), 'utf8');

// Compact index for the client filter: only what the list view needs, with
// short keys, since this ships to every visitor.
const index = entries
  .filter((e) => e.status === 'Sam' && !e.erRitbreyting)
  .map((e) => ({
    n: e.nafn,
    s: e.slug,
    g: e.gender,
    l: fold(e.nafn),
    f: e.flokkar,
    m: e.merking ?? '',
    c: e.confidence ?? '',
    // Sorting weight, not a displayed figure. An entry that cannot claim the
    // count must not ride it to the top of its own gender's list either: with
    // this at its face value, filtering to Karlmannsnöfn by popularity put
    // Auður in the first handful of results.
    v: e.vinsaeldir && !e.vinsaeldir.kynOvisst ? e.vinsaeldir.fjoldi : 0,
  }));
// Written to public/ so the browser fetches it as a separate cacheable file
// rather than inlining ~700 KB of JSON into every page.
mkdirSync(resolve(root, 'public'), { recursive: true });
writeFileSync(resolve(root, 'public/leit.json'), JSON.stringify(index), 'utf8');

writeFileSync(
  resolve(root, 'src/data/lidir.json'),
  JSON.stringify(
    elements.map((el) => ({
      ...el,
      slug: elementSlugs.get(el.id)!,
      // Every name that links here must appear, including rejected ones —
      // otherwise a name page can link to an element page that was dropped
      // for being empty.
      nofn: entries
        .filter((e) => e.lidir.some((s) => s.lidur === el.id))
        .map((e) => ({ nafn: e.nafn, slug: e.slug, gender: e.gender, status: e.status })),
    })),
  ),
  'utf8',
);

// ── Report ──────────────────────────────────────────────────────────────────
const approved = entries.filter((e) => e.status === 'Sam');
const withMeaning = approved.filter((e) => e.merking).length;
const byConfidence = new Map<string, number>();
for (const e of approved) if (e.confidence) byConfidence.set(e.confidence, (byConfidence.get(e.confidence) ?? 0) + 1);

console.log(`✓ ${entries.length} nöfn byggð → src/data/nofn.json`);
console.log(`  Leitarskrá: ${index.length} nöfn → public/leit.json`);
console.log(`  Liðaskrá:   ${elements.length} liðir → src/data/lidir.json`);
console.log(`\nMerkingar (${approved.length} samþykkt nöfn):`);
console.log(`  með merkingu : ${withMeaning} (${((100 * withMeaning) / approved.length).toFixed(0)}%)`);
console.log(`  staðfest     : ${byConfidence.get('stadfest') ?? 0}`);
console.log(`  líkleg       : ${byConfidence.get('likleg') ?? 0}`);
console.log(`  óstaðfest    : ${byConfidence.get('ostadfest') ?? 0}`);
console.log(`\nUppruni merkinga: yfirskriftir ${tally.override}, orðasafn ${tally.lexicon}, gervigreind ${tally.ai}, ekkert ${tally.none}`);
console.log(`Beygingar: ${entries.filter((e) => e.beyging).length} | Með berendur: ${entries.filter((e) => e.vinsaeldir).length}`);
