/**
 * Fetches the complete official Icelandic name register (mannanafnaskrá).
 *
 * Source: Þjóðskrá Íslands / Mannanafnanefnd, served through the public
 * island.is GraphQL gateway. The whole register — ~5,800 records — comes back
 * in a single unauthenticated request, so there is no scraping and no paging.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RegisterRecord } from '../src/lib/types.ts';

const ENDPOINT = 'https://island.is/api/graphql';
const QUERY = `{
  getAllIcelandicNames {
    id
    icelandicName
    type
    status
    verdict
    visible
    description
    url
  }
}`;

const OUT = resolve(import.meta.dirname, '../data/raw/mannanafnaskra.json');

async function main() {
  console.log('Sæki mannanafnaskrá frá island.is …');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The gateway is stricter without a plausible browser context.
      'User-Agent': 'Nafnaval/0.1 (+https://nafnaval.is)',
      Referer: 'https://island.is/leit-i-mannanafnaskra',
    },
    body: JSON.stringify({ query: QUERY }),
  });

  if (!res.ok) throw new Error(`island.is svaraði ${res.status} ${res.statusText}`);

  const json = (await res.json()) as {
    data?: { getAllIcelandicNames?: RegisterRecord[] };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`GraphQL villa: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  const records = json.data?.getAllIcelandicNames;
  if (!records?.length) throw new Error('Engin nöfn í svari — API-ið hefur líklega breyst.');

  // Guard against a silently truncated response. The register has grown slowly
  // and monotonically; a sudden drop means something upstream broke.
  if (records.length < 5000) {
    throw new Error(`Aðeins ${records.length} nöfn — búist við >5000. Hætti við.`);
  }

  await mkdir(resolve(import.meta.dirname, '../data/raw'), { recursive: true });
  await writeFile(OUT, JSON.stringify(records, null, 1), 'utf8');

  const byType = tally(records.map((r) => r.type));
  const byStatus = tally(records.map((r) => r.status ?? '(ekkert)'));

  console.log(`\n✓ ${records.length} nöfn vistuð í data/raw/mannanafnaskra.json`);
  console.log('  Tegund:', formatTally(byType));
  console.log('  Staða: ', formatTally(byStatus));
}

function tally(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return new Map([...counts].sort((a, b) => b[1] - a[1]));
}

const formatTally = (t: Map<string, number>) =>
  [...t].map(([k, n]) => `${k}=${n}`).join(' ');

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
