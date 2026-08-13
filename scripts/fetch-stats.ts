/**
 * Fetches name popularity from Hagstofa Íslands (Statistics Iceland) via the
 * public PxWeb API. No key required.
 *
 * IMPORTANT SCOPE LIMIT: these tables only cover roughly the top 100 names per
 * gender. Most of the 5,836 register entries will have no popularity data at
 * all, so the UI must treat this as an optional badge, never a universal field.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE = 'https://px.hagstofa.is/pxis/api/v1/is/Ibuar/Faeddirdanir/Nofn';

interface PxResponse {
  columns: Array<{ code: string; text: string; type: string }>;
  data: Array<{ key: string[]; values: string[] }>;
}

interface PxMeta {
  title: string;
  variables: Array<{ code: string; values: string[]; valueTexts: string[] }>;
}

export interface PopularityRow {
  nafn: string;
  /** Alternate spellings the table lumps together, e.g. Margrét/Margrjet/Margret. */
  afbrigdi: string[];
  saeti: number;
  fyrraSaeti: number | null;
  fjoldi: number | null;
  gender: 'kvk' | 'kk';
}

/** Rank of a name within each age band, for the classic-vs-modern signal. */
export interface AgeRow {
  nafn: string;
  gender: 'kvk' | 'kk';
  /** Age band label ("0-4") -> rank in that band. */
  saetiEftirAldri: Record<string, number>;
}

async function getMeta(path: string): Promise<PxMeta> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`PxWeb meta ${path}: ${res.status}`);
  return res.json() as Promise<PxMeta>;
}

async function query(path: string, body: unknown): Promise<PxResponse> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PxWeb query ${path}: ${res.status}`);
  return res.json() as Promise<PxResponse>;
}

/**
 * Row labels arrive as "1 Anna (2)" — rank, name, previous rank. Two wrinkles:
 * ties render as "13-14 Eva (14)", and names that merge spelling variants
 * render as "5 Margrét/Margrjet/Margret (5)".
 */
export function parseRankLabel(label: string): {
  saeti: number;
  nafn: string;
  afbrigdi: string[];
  fyrraSaeti: number | null;
} | null {
  const m = /^(\d+)(?:-\d+)?\s+(.+?)\s*(?:\((\d+)(?:-\d+)?\))?$/.exec(label.trim());
  if (!m) return null;
  const spellings = m[2].split('/').map((s) => s.trim()).filter(Boolean);
  return {
    saeti: Number(m[1]),
    nafn: spellings[0],
    afbrigdi: spellings.slice(1),
    fyrraSaeti: m[3] ? Number(m[3]) : null,
  };
}

async function fetchPopularity(
  path: string,
  gender: 'kvk' | 'kk',
): Promise<PopularityRow[]> {
  const meta = await getMeta(path);
  const rankVar = meta.variables.find((v) => v.code === 'Röð');
  if (!rankVar) throw new Error(`${path}: engin 'Röð' breyta`);

  const res = await query(path, {
    query: [
      { code: 'Röð', selection: { filter: 'all', values: ['*'] } },
      { code: 'Eining', selection: { filter: 'item', values: ['Fjoldi'] } },
    ],
    response: { format: 'json' },
  });

  // Response rows come back in the same order as the declared rank values, so
  // index them by the variable's own value list rather than trusting position.
  const labelByValue = new Map(rankVar.values.map((v, i) => [v, rankVar.valueTexts[i]]));

  const rows: PopularityRow[] = [];
  for (const row of res.data) {
    const label = labelByValue.get(row.key[0]);
    if (!label) continue;
    const parsed = parseRankLabel(label);
    if (!parsed) continue;
    const count = Number(row.values[0]);
    rows.push({
      nafn: parsed.nafn,
      afbrigdi: parsed.afbrigdi,
      saeti: parsed.saeti,
      fyrraSaeti: parsed.fyrraSaeti,
      fjoldi: Number.isFinite(count) ? count : null,
      gender,
    });
  }
  return rows;
}

async function fetchAgeBands(path: string, gender: 'kvk' | 'kk'): Promise<AgeRow[]> {
  const meta = await getMeta(path);
  const nameVar = meta.variables.find((v) => v.code === 'Eiginnafn');
  const ageVar = meta.variables.find((v) => v.code === 'Aldur');
  if (!nameVar || !ageVar) return [];

  const res = await query(path, {
    query: [
      { code: 'Eiginnafn', selection: { filter: 'all', values: ['*'] } },
      { code: 'Aldur', selection: { filter: 'all', values: ['*'] } },
    ],
    response: { format: 'json' },
  });

  const nameByValue = new Map(nameVar.values.map((v, i) => [v, nameVar.valueTexts[i]]));
  const ageByValue = new Map(ageVar.values.map((v, i) => [v, ageVar.valueTexts[i]]));

  const byName = new Map<string, AgeRow>();
  for (const row of res.data) {
    const nafn = nameByValue.get(row.key[0]);
    const band = ageByValue.get(row.key[1]);
    if (!nafn || !band) continue;
    const rank = Number(row.values[0]);
    if (!Number.isFinite(rank) || rank <= 0) continue;

    let entry = byName.get(nafn);
    if (!entry) {
      entry = { nafn, gender, saetiEftirAldri: {} };
      byName.set(nafn, entry);
    }
    entry.saetiEftirAldri[band] = rank;
  }
  return [...byName.values()];
}

async function main() {
  console.log('Sæki vinsældagögn frá Hagstofu Íslands …');

  const [kvk, kk] = await Promise.all([
    fetchPopularity('Nofnkvk/MAN11111.px', 'kvk'),
    fetchPopularity('Nofnkk/MAN11101.px', 'kk'),
  ]);

  const [aldurKvk, aldurKk] = await Promise.all([
    fetchAgeBands('Nofnkvk/MAN11115.px', 'kvk'),
    fetchAgeBands('Nofnkk/MAN11105.px', 'kk'),
  ]);

  const popularity = [...kvk, ...kk];
  const ageBands = [...aldurKvk, ...aldurKk];

  await mkdir(resolve(import.meta.dirname, '../data/raw'), { recursive: true });
  await writeFile(
    resolve(import.meta.dirname, '../data/raw/vinsaeldir.json'),
    JSON.stringify({ popularity, ageBands }, null, 1),
    'utf8',
  );

  console.log(`\n✓ Vinsældir: ${kvk.length} kvenmannsnöfn, ${kk.length} karlmannsnöfn`);
  console.log(`✓ Aldursbil: ${ageBands.length} nöfn`);
  console.log('  Dæmi:', popularity.slice(0, 3).map((p) => `${p.saeti}. ${p.nafn} (${p.fjoldi})`).join(', '));
}

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
