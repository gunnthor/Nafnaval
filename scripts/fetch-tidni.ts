/**
 * Fetches how many people actually bear each name, from Þjóðskrá Íslands.
 *
 * WHY NOT HAGSTOFA. The Hagstofa PxWeb tables we already use top out at roughly
 * the 100 most common names per gender — every other name has no figure at all.
 * Þjóðskrá's own lookup service publishes a count for *every* name, down to a
 * single bearer, and gives a year-by-year series from 2004 to the present.
 * That turns popularity from a badge a few names carry into a real number for
 * nearly all of them, plus a trend.
 *
 * Endpoint (the one behind skra.is "Hversu margir heita nafninu?"):
 *   https://svc.skra.is/talnaefni/api/NafnTidni?eiginnafn=Lóa&svfn=9999
 *   svfn=9999 means the whole country. `annadnafn` counts the name in second
 *   position, which is a different figure — many names are far commoner as a
 *   middle name than as a first.
 *
 * This makes ~2 requests per register name against a public government service,
 * so it runs at modest concurrency with a delay and is resumable: rerun it and
 * it picks up where it stopped.
 *
 *   npx tsx scripts/fetch-tidni.ts [--limit 50] [--concurrency 4]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { displayCase } from '../src/lib/icelandic.ts';
import type { RegisterRecord } from '../src/lib/types.ts';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const LIMIT = Number(flag('--limit') ?? 0);
const CONCURRENCY = Number(flag('--concurrency') ?? 4);
const DELAY_MS = 60;
const OUT = resolve(root, 'data/raw/nafntidni.json');
const ENDPOINT = 'https://svc.skra.is/talnaefni/api/NafnTidni';

interface ApiRow {
  Nafn: string;
  Svfn: string;
  SvfnHeiti: string;
  FjoldiAr: Array<{ Ar: string; Fjoldi: number }>;
}

interface Store {
  _source: string;
  _url: string;
  sott: string;
  /** Canonical year axis; per-name arrays align to it. */
  ar: number[];
  /** lowercase name -> { e: first-name counts, a: middle-name counts } */
  nofn: Record<string, { e: number[]; a: number[] }>;
}

// The series runs to the current year, not a pinned one: a hardcoded ceiling
// silently stops the counts advancing the moment the year rolls over. A year the
// API has no rows for yet simply aligns to 0.
const LAST_YEAR = new Date().getUTCFullYear();
const YEARS = Array.from({ length: LAST_YEAR - 2004 + 1 }, (_, i) => 2004 + i);

const store: Store = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, 'utf8'))
  : {
      _source: 'Þjóðskrá Íslands',
      _url: 'https://www.skra.is/gogn/thjodskrargattin/hversu-vinsaelt-er-nafnid/',
      sott: new Date().toISOString().slice(0, 10),
      ar: YEARS,
      nofn: {},
    };

// The stored series are positional: each name's array is indexed by store.ar.
// When the calendar rolls over, YEARS grows by one and newly fetched names would
// get a longer array than the thousands already saved, leaving the two silently
// misaligned. Nobody's count for the new year is known yet, so the store is
// stale in its entirety rather than something to extend in place.
const axisMatches =
  Array.isArray(store.ar) && store.ar.length === YEARS.length && store.ar.every((y, i) => y === YEARS[i]);
if (!axisMatches) {
  const had = Array.isArray(store.ar) && store.ar.length ? `${store.ar[0]}..${store.ar.at(-1)}` : '(ekkert)';
  console.error(`Árabilið hefur breyst: geymslan nær ${had}, núverandi bil er ${YEARS[0]}..${YEARS.at(-1)}.`);
  console.error('Tölur nýja ársins eru óþekktar fyrir öll nöfn, svo geymslan er úrelt í heild sinni.');
  console.error('Eyddu data/raw/nafntidni.json og keyrðu aftur til að sækja allar tölur upp á nýtt.');
  process.exit(1);
}

const register: RegisterRecord[] = JSON.parse(
  readFileSync(resolve(root, 'data/raw/mannanafnaskra.json'), 'utf8'),
);

let todo = [...new Set(register.map((r) => r.icelandicName))].filter((n) => !store.nofn[n]);
if (LIMIT > 0) todo = todo.slice(0, LIMIT);

if (todo.length === 0) {
  console.log(`Ekkert eftir — ${Object.keys(store.nofn).length} nöfn þegar sótt.`);
  process.exit(0);
}

console.log(`Sæki tíðnitölur fyrir ${todo.length} nöfn frá Þjóðskrá.`);
console.log(`${Object.keys(store.nofn).length} þegar til (sleppt). Samhliða: ${CONCURRENCY}.\n`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Maps the API's sparse year list onto the canonical axis; 0 where absent. */
function align(rows: ApiRow[]): number[] {
  const byYear = new Map<number, number>();
  for (const row of rows) {
    for (const { Ar, Fjoldi } of row.FjoldiAr) byYear.set(Number(Ar), Fjoldi);
  }
  return YEARS.map((y) => byYear.get(y) ?? 0);
}

async function query(param: 'eiginnafn' | 'annadnafn', nafn: string): Promise<number[]> {
  const url = `${ENDPOINT}?${param}=${encodeURIComponent(nafn)}&svfn=9999`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Nafnaval/0.1 (+https://nafnaval.is)' },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      if (!res.ok) return YEARS.map(() => 0);
      return align((await res.json()) as ApiRow[]);
    } catch {
      await sleep(1200 * (attempt + 1));
    }
  }
  throw new Error(`gafst upp á ${param}=${nafn}`);
}

let done = 0;
let failed = 0;

function save() {
  // Records when the numbers were last fetched, not when the file was created,
  // so the snapshot's age is readable without consulting git.
  store.sott = new Date().toISOString().slice(0, 10);
  mkdirSync(resolve(root, 'data/raw'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(store), 'utf8');
}

async function worker(queue: string[]) {
  while (queue.length) {
    const nafn = queue.shift();
    if (!nafn) return;
    const pretty = displayCase(nafn);
    try {
      // Sequential per name: two parallel hits for the same name buy nothing
      // and double the instantaneous load.
      const e = await query('eiginnafn', pretty);
      await sleep(DELAY_MS);
      const a = await query('annadnafn', pretty);
      store.nofn[nafn] = { e, a };
    } catch (err) {
      failed++;
      console.error(`  ✗ ${pretty}: ${err instanceof Error ? err.message : err}`);
    }
    done++;
    if (done % 100 === 0) {
      save();
      const pct = ((100 * done) / todo.length).toFixed(0);
      console.log(`  ${done}/${todo.length} (${pct}%) — síðast: ${pretty}`);
    }
    await sleep(DELAY_MS);
  }
}

const queue = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
save();

const withBearers = Object.values(store.nofn).filter((v) => v.e.at(-1)! > 0 || v.a.at(-1)! > 0);
console.log(`\n✓ ${Object.keys(store.nofn).length} nöfn vistuð í data/raw/nafntidni.json`);
console.log(`  ${withBearers.length} nöfn eru borin af a.m.k. einum einstaklingi í dag`);
if (failed) console.log(`  ${failed} mistókust — keyrðu aftur til að reyna þau`);
