/**
 * Contract test for the four upstream data sources.
 *
 * The fetch scripts all destructure fields out of third-party JSON. None of
 * those sources version their APIs or announce changes, so the failure mode is
 * not a 500. It is a 200 whose shape quietly stopped matching, which surfaces
 * later as blank fields on the site. This asserts the shapes rather than the
 * values: it answers "can the fetch scripts still parse this", not "is the
 * data current".
 *
 * It is deliberately NOT part of `npm test`. It makes real network calls to
 * public services, so it must never run on every build or in a deploy hook.
 * Run it on a schedule, or before a data refresh:
 *
 *   npm run test:sources
 *
 * One request per endpoint (two for Hagstofa, which needs metadata before a
 * query), and a HEAD for BÍN so the 34 MB archive is never downloaded.
 *
 * KNOWN BLIND SPOT: the BÍN column layout inside Kristínarsnið cannot be
 * verified without unzipping the archive. `npm run fetch:bin` is the real test
 * for that: it fails loudly if the columns move.
 */
export {}; // top-level await needs this file to be a module

const UA = 'Nafnaval/0.1 (+https://nafnaval.is)';

let failures = 0;
let checks = 0;
let skipped = 0;

function ok(label: string, detail = '') {
  checks++;
  console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? `: ${detail}` : ''}`);
}

function bad(label: string, detail: string) {
  checks++;
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}: ${detail}`);
}

function skip(label: string, detail: string) {
  skipped++;
  console.log(`  \x1b[33m!\x1b[0m ${label}: ${detail}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries 429 and 5xx with backoff, honouring Retry-After. A rate limit says
 * nothing about whether the shape still matches, so callers treat it as
 * inconclusive rather than as a failure. Otherwise a scheduled run raises a
 * false alarm the moment the service throttles us.
 */
async function politeFetch(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let res!: Response;
  for (let i = 0; i < attempts; i++) {
    res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, ...((init.headers ?? {}) as Record<string, string>) },
    });
    if (res.status !== 429 && res.status < 500) return res;
    if (i === attempts - 1) break;
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * (i + 1) ** 2;
    console.log(`  \x1b[33m…\x1b[0m ${res.status}, bíð ${Math.round(waitMs / 1000)}s og reyni aftur`);
    await sleep(waitMs);
  }
  return res;
}

/** True when the response is unusable for reasons that are not a contract change. */
function throttled(res: Response, label: string): boolean {
  if (res.status !== 429) return false;
  skip(label, 'þjónustan takmarkar beiðnir (429), formið ósannreynt í þetta sinn');
  return true;
}

/** Asserts a condition, recording rather than throwing so one break doesn't hide the rest. */
function check(cond: boolean, label: string, detail: string) {
  cond ? ok(label) : bad(label, detail);
}

/** Every key the consuming script destructures must be present with the right type. */
function checkKeys(obj: Record<string, unknown>, spec: Record<string, string>, label: string) {
  const wrong: string[] = [];
  for (const [key, want] of Object.entries(spec)) {
    if (!(key in obj)) {
      wrong.push(`${key} vantar`);
      continue;
    }
    const got = obj[key] === null ? 'null' : typeof obj[key];
    // `a|b` means the field is legitimately nullable.
    if (!want.split('|').includes(got)) wrong.push(`${key}: ${want} væntanlegt, fékk ${got}`);
  }
  wrong.length ? bad(label, wrong.join('; ')) : ok(label, `${Object.keys(spec).length} reitir`);
}

// ── 1. island.is: mannanafnaskrá (scripts/fetch-register.ts) ────────────────
async function testRegister() {
  console.log('\nisland.is GraphQL: mannanafnaskrá');
  const res = await politeFetch('https://island.is/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://island.is/leit-i-mannanafnaskra',
    },
    body: JSON.stringify({
      query: '{ getAllIcelandicNames { id icelandicName type status verdict visible description url } }',
    }),
  });
  if (throttled(res, 'island.is')) return;
  check(res.ok, 'HTTP 200', `svaraði ${res.status} ${res.statusText}`);
  if (!res.ok) return;

  const json = (await res.json()) as {
    data?: { getAllIcelandicNames?: Record<string, unknown>[] };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    bad('engar GraphQL villur', json.errors.map((e) => e.message).join('; '));
    return;
  }
  ok('engar GraphQL villur');

  const rows = json.data?.getAllIcelandicNames;
  if (!Array.isArray(rows)) {
    bad('data.getAllIcelandicNames er fylki', `fékk ${typeof rows}`);
    return;
  }
  // The whole register in one call: a sudden collapse means paging appeared.
  check(rows.length > 5000, 'heildarskráin skilar sér í einni beiðni', `aðeins ${rows.length} færslur`);
  ok('færslufjöldi', `${rows.length}`);

  checkKeys(
    rows[0],
    {
      id: 'number',
      icelandicName: 'string',
      type: 'string',
      status: 'string|null',
      verdict: 'string|null',
      visible: 'boolean',
      description: 'string|null',
      url: 'string|null',
    },
    'reitir færslu',
  );

  // A new enum value is a contract change: src/lib/types.ts would be wrong.
  const TYPES = new Set(['ST', 'DR', 'MI', 'KH', 'RST', 'RDR']);
  const STATUSES = new Set(['Sam', 'Haf', 'Óaf', null]);
  const newTypes = [...new Set(rows.map((r) => r.type))].filter((t) => !TYPES.has(t as string));
  const newStatuses = [...new Set(rows.map((r) => r.status))].filter((s) => !STATUSES.has(s as string));
  check(newTypes.length === 0, 'engar nýjar nafntegundir', `ný gildi: ${newTypes.join(', ')}`);
  check(newStatuses.length === 0, 'engar nýjar stöður', `ný gildi: ${newStatuses.join(', ')}`);

  // The pipeline slugs and matches on the assumption these arrive lowercased.
  const cased = rows.filter((r) => (r.icelandicName as string) !== (r.icelandicName as string).toLowerCase());
  check(cased.length === 0, 'nöfn koma lágstafuð', `${cased.length} með hástöfum`);
}

// ── 2. Þjóðskrá: berendafjöldi (scripts/fetch-tidni.ts) ─────────────────────
async function testTidni() {
  console.log('\nsvc.skra.is: fjöldi berenda');
  const res = await politeFetch('https://svc.skra.is/talnaefni/api/NafnTidni?eiginnafn=Anna&svfn=9999', {
    headers: { Accept: 'application/json' },
  });
  if (throttled(res, 'svc.skra.is')) return;
  check(res.ok, 'HTTP 200', `svaraði ${res.status} ${res.statusText}`);
  if (!res.ok) return;

  const rows = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length === 0) {
    bad('svarið er fylki með færslum', `fékk ${Array.isArray(rows) ? 'tómt fylki' : typeof rows}`);
    return;
  }
  ok('svarið er fylki', `${rows.length} lína`);

  checkKeys(rows[0], { Nafn: 'string', Svfn: 'string', SvfnHeiti: 'string' }, 'reitir línu');

  const ar = rows[0].FjoldiAr as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(ar) || ar.length === 0) {
    bad('FjoldiAr er fylki með færslum', `fékk ${typeof ar}`);
    return;
  }
  // Ar arrives as a string and is passed through Number(); Fjoldi must not be.
  checkKeys(ar[0], { Ar: 'string', Fjoldi: 'number' }, 'reitir árs');

  const years = ar.map((a) => Number(a.Ar)).sort((a, b) => a - b);
  const now = new Date().getUTCFullYear();
  check(years[0] <= 2004, 'röðin nær aftur til 2004', `elsta ár er ${years[0]}`);
  // Catches upstream freezing the series as much as our own year handling.
  check(
    years[years.length - 1] >= now - 1,
    'röðin nær til yfirstandandi árs',
    `nýjasta ár er ${years[years.length - 1]}, núlíðandi ár ${now}`,
  );
  const gaps = years.filter((y, i) => i > 0 && y !== years[i - 1] + 1);
  check(gaps.length === 0, 'engin göt í árunum', `göt við: ${gaps.join(', ')}`);
}

// ── 3. Hagstofa: PxWeb (scripts/fetch-stats.ts) ─────────────────────────────
async function testHagstofa() {
  console.log('\npx.hagstofa.is: PxWeb v1');
  const BASE = 'https://px.hagstofa.is/pxis/api/v1/is/Ibuar/Faeddirdanir/Nofn';

  const metaRes = await politeFetch(`${BASE}/Nofnkvk/MAN11111.px`);
  if (throttled(metaRes, 'px.hagstofa.is (lýsigögn)')) return;
  check(metaRes.ok, 'HTTP 200 (lýsigögn)', `svaraði ${metaRes.status}`);
  if (!metaRes.ok) return;

  const meta = (await metaRes.json()) as {
    title?: string;
    variables?: Array<{ code: string; values: string[]; valueTexts: string[] }>;
  };
  if (!Array.isArray(meta.variables)) {
    bad('variables er fylki', `fékk ${typeof meta.variables}`);
    return;
  }
  ok('lýsigagnaform', `${meta.variables.length} breytur`);

  const rankVar = meta.variables.find((v) => v.code === 'Röð');
  check(!!rankVar, "breytan 'Röð' er til", 'fannst ekki, fetchPopularity myndi kasta villu');
  if (!rankVar) return;
  check(
    Array.isArray(rankVar.values) && Array.isArray(rankVar.valueTexts),
    'Röð hefur values og valueTexts',
    'annað hvort vantar',
  );

  // fetchPopularity cannot survive this regex ceasing to match.
  const label = rankVar.valueTexts[0] ?? '';
  const parses = /^(\d+)(?:-\d+)?\s+(.+?)\s*(?:\((\d+)(?:-\d+)?\))?$/.test(label.trim());
  check(parses, 'sætismerki þáttast', `"${label}" passar ekki við parseRankLabel`);
  if (parses) ok('dæmi um merki', `"${label}"`);

  const qRes = await politeFetch(`${BASE}/Nofnkvk/MAN11111.px`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Two rows, not '*': enough to prove the shape without pulling the table.
      query: [
        { code: 'Röð', selection: { filter: 'item', values: rankVar.values.slice(0, 2) } },
        { code: 'Eining', selection: { filter: 'item', values: ['Fjoldi'] } },
      ],
      response: { format: 'json' },
    }),
  });
  if (throttled(qRes, 'px.hagstofa.is (fyrirspurn)')) return;
  check(qRes.ok, 'HTTP 200 (fyrirspurn)', `svaraði ${qRes.status}`);
  if (!qRes.ok) return;

  const px = (await qRes.json()) as {
    columns?: Array<Record<string, unknown>>;
    data?: Array<Record<string, unknown>>;
  };
  check(Array.isArray(px.columns), 'columns er fylki', `fékk ${typeof px.columns}`);
  check(Array.isArray(px.data) && px.data.length > 0, 'data er fylki með færslum', 'tómt');
  if (!px.columns?.length || !px.data?.length) return;

  checkKeys(px.columns[0], { code: 'string', text: 'string', type: 'string' }, 'reitir dálks');
  const row = px.data[0];
  check(Array.isArray(row.key), 'data[].key er fylki', `fékk ${typeof row.key}`);
  // values are strings here and go through Number() downstream. A switch to
  // numbers would still "work" but is a contract change worth knowing about.
  check(
    Array.isArray(row.values) && typeof (row.values as unknown[])[0] === 'string',
    'data[].values eru strengir',
    `fékk ${typeof (row.values as unknown[])?.[0]}`,
  );

  // Not a failure yet, but v1 is being retired across Nordic agencies, and
  // this is the first place a migration would become visible.
  const v2 = await fetch('https://px.hagstofa.is/pxis/api/v2/', { headers: { 'User-Agent': UA } });
  if (v2.status === 404) ok('v1 er enn eina útgáfan', 'v2 svarar 404');
  else if (v2.status === 429) skip('v2-könnun', 'takmörkuð (429), ósannreynt');
  else console.log(`  \x1b[33m!\x1b[0m PxWeb v2 svarar núna ${v2.status}, fetch-stats.ts er á v1`);
}

// ── 4. BÍN: beygingar (scripts/fetch-bin.ts) ────────────────────────────────
async function testBin() {
  console.log('\nbin.arnastofnun.is: beygingar');
  const res = await politeFetch('https://bin.arnastofnun.is/django/api/nidurhal/?file=KRISTINsnid.csv.zip', {
    method: 'HEAD',
  });
  if (throttled(res, 'bin.arnastofnun.is')) return;
  check(res.ok, 'HTTP 200', `svaraði ${res.status} ${res.statusText}`);
  if (!res.ok) return;
  check(!res.redirected, 'engin tilvísun', `vísaði á ${res.url}`);

  const len = Number(res.headers.get('content-length') ?? 0);
  // Guards against the endpoint starting to serve an error page or a stub.
  check(len > 20_000_000, 'skráin er í fullri stærð', `content-length ${len}`);
  if (len > 0) ok('stærð', `${(len / 1024 / 1024).toFixed(1)} MiB`);

  const disp = res.headers.get('content-disposition') ?? '';
  check(
    disp.includes('KRISTINsnid.csv.zip'),
    'skráarnafn óbreytt',
    `content-disposition: ${disp || '(ekkert)'}`,
  );
  console.log('  \x1b[33m!\x1b[0m Dálkaskipan Kristínarsniðs er ekki prófuð hér. `npm run fetch:bin` gerir það.');
}

// ── Run ─────────────────────────────────────────────────────────────────────
console.log('Prófa uppruna gagnanna: raunverulegar beiðnir á opinberar þjónustur.');

for (const [name, fn] of [
  ['island.is', testRegister],
  ['skra.is', testTidni],
  ['hagstofa.is', testHagstofa],
  ['BÍN', testBin],
] as const) {
  try {
    await fn();
  } catch (err) {
    // A thrown error is itself a result: the source is unreachable.
    bad(`${name} svaraði`, err instanceof Error ? err.message : String(err));
  }
}

console.log(
  failures === 0
    ? `\n\x1b[32m✓\x1b[0m Allir ${checks} prófþættir standast: upprunarnir passa enn við sækjarana.`
    : `\n\x1b[31m✗\x1b[0m ${failures} af ${checks} prófþáttum brugðust.`,
);
if (skipped > 0) {
  console.log(`  ${skipped} prófþáttum var sleppt vegna beiðnatakmarkana. Það er ekki brot á samningi.`);
}
// Only a shape mismatch fails the run; throttling and unreachability do not.
process.exit(failures === 0 ? 0 : 1);
