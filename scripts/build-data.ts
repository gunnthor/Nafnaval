/**
 * Merges every source into the single dataset the site builds from.
 *
 * Precedence for a name's meaning, highest first:
 *   1. data/overrides/names.yaml   — hand-written, always wins
 *   2. lexicon decomposition       — deterministic, cites a dictionary
 *   3. data/ai/drafts.json         — Claude-drafted, always labelled óstaðfest
 *   4. nothing                     — the page says so plainly
 *
 * Output: src/data/nofn.json (full records) and src/data/leit.json (compact
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
const declensionByName = new Map(declensions.map((d) => [d.nafn.toLowerCase(), d.beyging]));
// ── Bearer counts and ranks ─────────────────────────────────────────────────
const YEAR_AXIS = tidni.ar;
const latest = (xs: number[]) => (xs.length ? xs[xs.length - 1] : 0);

/**
 * Rank is computed here rather than taken from a source, because no source
 * ranks every name — Þjóðskrá publishes counts, so the ordering is ours to
 * derive. Ranked within gender, by first-name bearers, ties sharing a rank.
 */
const rankByName = new Map<string, { saeti: number; af: number }>();
{
  const byGender = new Map<string, Array<{ nafn: string; n: number }>>();
  for (const rec of register) {
    if (rec.status !== 'Sam') continue;
    if (rec.type === 'RST' || rec.type === 'RDR') continue;
    const n = latest(tidni.nofn[rec.icelandicName]?.e ?? []);
    if (n <= 0) continue;
    const g = rec.type === 'ST' ? 'kvk' : rec.type === 'DR' ? 'kk' : 'annad';
    (byGender.get(g) ?? byGender.set(g, []).get(g)!).push({ nafn: rec.icelandicName, n });
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

function popularityFor(lower: string): Popularity | null {
  const row = tidni.nofn[lower];
  if (!row) return null;
  const fjoldi = latest(row.e);
  const fjoldiAnnad = latest(row.a);
  if (fjoldi === 0 && fjoldiAnnad === 0) return null;

  // Ten years back on the same axis, so the comparison is like-for-like.
  const tenBack = row.e.length >= 11 ? row.e[row.e.length - 11] : 0;
  const breyting = tenBack > 0 ? Math.round(((fjoldi - tenBack) / tenBack) * 100) : null;
  const rank = rankByName.get(lower);

  return {
    fjoldi,
    fjoldiAnnad,
    alls: fjoldi + fjoldiAnnad,
    saeti: rank?.saeti ?? null,
    afFjolda: rank?.af ?? null,
    ferill: row.e,
    breyting,
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
  const popularity = popularityFor(lower);
  const year = verdictYear(rec.verdict);

  if (rec.type === 'KH') flokkar.add('kynhlutlaust');
  if (rec.type === 'MI') flokkar.add('millinafn');
  if (popularity) flokkar.add('vinsael');
  else if (rec.status === 'Sam') flokkar.add('sjaldgaeft');
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
    v: e.vinsaeldir?.fjoldi ?? 0,
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
      slug: slugify(el.id),
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
console.log(`  Leitarskrá: ${index.length} nöfn → src/data/leit.json`);
console.log(`  Liðaskrá:   ${elements.length} liðir → src/data/lidir.json`);
console.log(`\nMerkingar (${approved.length} samþykkt nöfn):`);
console.log(`  með merkingu : ${withMeaning} (${((100 * withMeaning) / approved.length).toFixed(0)}%)`);
console.log(`  staðfest     : ${byConfidence.get('stadfest') ?? 0}`);
console.log(`  líkleg       : ${byConfidence.get('likleg') ?? 0}`);
console.log(`  óstaðfest    : ${byConfidence.get('ostadfest') ?? 0}`);
console.log(`\nUppruni merkinga: yfirskriftir ${tally.override}, orðasafn ${tally.lexicon}, gervigreind ${tally.ai}, ekkert ${tally.none}`);
console.log(`Beygingar: ${entries.filter((e) => e.beyging).length} | Með berendur: ${entries.filter((e) => e.vinsaeldir).length}`);
