/**
 * Lints data/lexicon/elements.yaml.
 *
 * The failure mode this exists to catch: the same surface form claimed by two
 * different elements. When that happens the decomposer silently resolves names
 * to whichever element happened to register first, which is how "Bjargey"
 * turned into berg + ey ("rock") instead of björg + ey ("help").
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { LexiconElement } from '../src/lib/types.ts';
import { INHERITABLE } from '../src/lib/categories.ts';

const VALID_CATEGORIES = INHERITABLE;

const VALID_POSITIONS = new Set(['forlidur', 'vidlidur']);

const { elements } = parse(
  readFileSync(resolve(import.meta.dirname, '../data/lexicon/elements.yaml'), 'utf8'),
) as { elements: LexiconElement[] };

const errors: string[] = [];
const warnings: string[] = [];

// Every surface form -> the elements claiming it.
const claims = new Map<string, string[]>();
const seenIds = new Set<string>();

for (const el of elements) {
  if (!el.id) errors.push(`Liður án auðkennis: ${JSON.stringify(el).slice(0, 60)}`);
  if (seenIds.has(el.id)) errors.push(`Tvítekið auðkenni: ${el.id}`);
  seenIds.add(el.id);

  if (!el.merking?.trim()) errors.push(`${el.id}: vantar merkingu`);
  if (!el.heimild?.trim()) errors.push(`${el.id}: vantar heimild`);

  if (!el.stada?.length) {
    errors.push(`${el.id}: vantar stöðu (forlidur/vidlidur)`);
  } else {
    for (const p of el.stada) {
      if (!VALID_POSITIONS.has(p)) errors.push(`${el.id}: ógild staða "${p}"`);
    }
  }

  for (const c of el.flokkar ?? []) {
    if (!VALID_CATEGORIES.has(c)) errors.push(`${el.id}: óþekktur flokkur "${c}"`);
  }

  const forms = [el.id, ...(el.afbrigdi ?? [])];
  const localDupes = forms.filter((f, i) => forms.indexOf(f) !== i);
  for (const d of new Set(localDupes)) warnings.push(`${el.id}: afbrigðið "${d}" er tvítekið`);

  for (const form of new Set(forms)) {
    (claims.get(form) ?? claims.set(form, []).get(form)!).push(el.id);
  }
}

for (const [form, owners] of claims) {
  if (owners.length < 2) continue;
  // A form that is one element's canonical id and another's variant resolves
  // deterministically (canonical wins), so it is only worth a warning.
  const canonical = owners.filter((o) => o === form);
  if (canonical.length === 1) {
    warnings.push(
      `Formið "${form}" er auðkenni ${canonical[0]} en einnig afbrigði af ${owners
        .filter((o) => o !== form)
        .join(', ')} — auðkennið vinnur.`,
    );
  } else {
    errors.push(`Formið "${form}" er í árekstri milli: ${owners.join(', ')}`);
  }
}

console.log(`Orðasafn: ${elements.length} liðir, ${claims.size} uppflettiform.`);

const byCategory = new Map<string, number>();
for (const el of elements) for (const c of el.flokkar ?? []) byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
console.log(
  'Flokkar:',
  [...byCategory].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join(' '),
);

if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} aðvaranir:`);
  for (const w of warnings) console.log('  ', w);
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} villur:`);
  for (const e of errors) console.error('  ', e);
  process.exit(1);
}

console.log('\n✓ Orðasafnið stenst prófun.');
