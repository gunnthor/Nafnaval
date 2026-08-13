/**
 * Fetches Icelandic declensions for given names from BÍN
 * (Beygingarlýsing íslensks nútímamáls).
 *
 * DATA LICENCE — IMPORTANT
 * BÍN is licensed CC BY-SA 4.0 and requires attribution to
 * Stofnun Árna Magnússonar í íslenskum fræðum. The derived output of this
 * script (data/raw/beygingar.json) carries that licence, and it is kept in its
 * own file — separate from the lexicon and the register — so the share-alike
 * obligation stays scoped to BÍN-derived material and does not extend over the
 * rest of the project. The credit is surfaced to users on /um.
 *
 * The source archive is ~35 MB zipped / 450 MB extracted, so everything here
 * streams; only the ~4,900 personal-name entries are kept.
 */
import { createReadStream } from 'node:fs';
import { writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { Declension } from '../src/lib/types.ts';

const execFileAsync = promisify(execFile);

const URL_BIN = 'https://bin.arnastofnun.is/django/api/nidurhal/?file=KRISTINsnid.csv.zip';
const WORK = resolve(import.meta.dirname, '../data/raw/bin-raw');
const OUT = resolve(import.meta.dirname, '../data/raw/beygingar.json');

/** BÍN column indices in Kristínarsnið (semicolon-separated, no header row). */
const COL = { lemma: 0, id: 1, ordfl: 2, hluti: 3, ordmynd: 9, greining: 10 } as const;

/** Maps a BÍN singular-case tag to our field name. Numbered variants (ÞGFET2) are alternates. */
const CASE_TAG: Record<string, keyof Declension> = {
  NFET: 'nefnifall',
  ÞFET: 'tholfall',
  ÞGFET: 'thagufall',
  EFET: 'eignarfall',
};

export interface BinEntry {
  nafn: string;
  /** kvk (feminine) or kk (masculine) as BÍN classifies the name. */
  kyn: string;
  beyging: Declension;
  /** Alternate case forms where BÍN records more than one, keyed by case. */
  afbrigdi?: Partial<Record<keyof Declension, string[]>>;
}

async function download(): Promise<string> {
  await mkdir(WORK, { recursive: true });
  const zipPath = resolve(WORK, 'KRISTINsnid.csv.zip');
  const csvPath = resolve(WORK, 'KRISTINsnid.csv');

  if (await exists(csvPath)) {
    console.log('  (nota áður sótta CSV-skrá)');
    return csvPath;
  }

  if (!(await exists(zipPath))) {
    console.log('  Sæki BÍN-gögn (~35 MB) …');
    const res = await fetch(URL_BIN, { headers: { 'User-Agent': 'Nafnaval/0.1' } });
    if (!res.ok) throw new Error(`BÍN svaraði ${res.status}`);
    await writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
  }

  console.log('  Þjappa upp …');
  try {
    await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', WORK], { maxBuffer: 1 << 26 });
  } catch {
    throw new Error(
      'Tókst ekki að þjappa upp BÍN-skránni. `unzip` þarf að vera uppsett ' +
        `(eða þjappaðu ${zipPath} upp handvirkt).`,
    );
  }
  return csvPath;
}

const exists = (p: string) => stat(p).then(() => true, () => false);

async function main() {
  console.log('Sæki beygingar frá BÍN (Stofnun Árna Magnússonar) …');
  const csvPath = await download();

  console.log('  Les og síi eiginnöfn …');
  const byName = new Map<string, BinEntry>();

  const rl = createInterface({
    input: createReadStream(csvPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // Cheap prefilter before splitting: the vast majority of the 6.7M rows
    // are `alm` and would otherwise cost a split each.
    if (!line.includes(';ism;')) continue;

    const f = line.split(';');
    if (f[COL.hluti] !== 'ism') continue;

    const tag = f[COL.greining];
    const base = tag.replace(/\d+$/, '');
    const field = CASE_TAG[base];
    // Skip plural, definite-article and any non-singular-case forms.
    if (!field || tag.includes('gr') || tag.includes('FT')) continue;

    const lemma = f[COL.lemma];
    const form = f[COL.ordmynd];
    const isAlternate = /\d$/.test(tag);

    let entry = byName.get(lemma);
    if (!entry) {
      entry = {
        nafn: lemma,
        kyn: f[COL.ordfl],
        beyging: { nefnifall: '', tholfall: '', thagufall: '', eignarfall: '' },
      };
      byName.set(lemma, entry);
    }

    if (isAlternate) {
      entry.afbrigdi ??= {};
      (entry.afbrigdi[field] ??= []).push(form);
    } else {
      entry.beyging[field] = form;
    }
  }

  // Drop anything that did not get all four cases — a partial table is worse
  // than none, since the UI renders it as a complete paradigm.
  const complete = [...byName.values()].filter((e) =>
    Object.values(e.beyging).every((v) => v.length > 0),
  );
  const dropped = byName.size - complete.length;

  await writeFile(
    OUT,
    JSON.stringify(
      {
        _licence: 'CC BY-SA 4.0',
        _source: 'Beygingarlýsing íslensks nútímamáls (BÍN)',
        _rightsHolder: 'Stofnun Árna Magnússonar í íslenskum fræðum',
        _url: 'https://bin.arnastofnun.is/',
        entries: complete,
      },
      null,
      1,
    ),
    'utf8',
  );

  console.log(`\n✓ ${complete.length} nöfn með fullri beygingu vistuð í data/raw/beygingar.json`);
  if (dropped) console.log(`  (${dropped} sleppt vegna ófullkominnar beygingar)`);
  const loa = complete.find((e) => e.nafn === 'Lóa');
  if (loa) console.log('  Dæmi Lóa:', Object.values(loa.beyging).join(', '));

  if (process.argv.includes('--clean')) {
    await rm(WORK, { recursive: true, force: true });
    console.log('  Hráskrám eytt (--clean)');
  }
}

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
