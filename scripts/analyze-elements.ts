/**
 * Maintenance tool, not part of the build.
 *
 * Suggests candidate name elements by finding recurring prefixes and suffixes
 * across the register, ranked by how many distinct names share them. Used to
 * decide what earns a place in data/lexicon/elements.yaml — the point is to
 * spend curation effort where it covers the most names.
 *
 *   npx tsx scripts/analyze-elements.ts [--min 5] [--missing]
 *
 * --missing lists only candidates not yet in the lexicon, which is the useful
 * mode once curation is under way.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { RegisterRecord, LexiconElement } from '../src/lib/types.ts';

const MIN_LEN = 3;
const MAX_LEN = 8;

const args = process.argv.slice(2);
const minCount = Number(args[args.indexOf('--min') + 1]) || 5;
const onlyMissing = args.includes('--missing');

const register: RegisterRecord[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../data/raw/mannanafnaskra.json'), 'utf8'),
);

const lexPath = resolve(import.meta.dirname, '../data/lexicon/elements.yaml');
const known = new Set<string>();
if (existsSync(lexPath)) {
  const lex = parse(readFileSync(lexPath, 'utf8')) as { elements?: LexiconElement[] } | null;
  for (const el of lex?.elements ?? []) {
    known.add(el.id);
    for (const v of el.afbrigdi ?? []) known.add(v);
  }
}

const names = register
  .filter((r) => r.status === 'Sam' && ['ST', 'DR', 'KH', 'MI'].includes(r.type))
  .map((r) => r.icelandicName);

const prefixes = new Map<string, Set<string>>();
const suffixes = new Map<string, Set<string>>();

for (const name of names) {
  for (let len = MIN_LEN; len <= Math.min(MAX_LEN, name.length - 2); len++) {
    add(prefixes, name.slice(0, len), name);
    add(suffixes, name.slice(-len), name);
  }
}

function add(map: Map<string, Set<string>>, key: string, name: string) {
  (map.get(key) ?? map.set(key, new Set()).get(key)!).add(name);
}

/**
 * A short candidate that is merely a truncation of a longer, equally common one
 * is noise ("sigr" vs "sigrí" vs "sigríð"). Keep a candidate only if it covers
 * meaningfully more names than any longer candidate extending it.
 */
function prune(map: Map<string, Set<string>>, isPrefix: boolean) {
  const out: Array<{ text: string; count: number; examples: string[] }> = [];
  for (const [text, set] of map) {
    if (set.size < minCount) continue;
    let dominated = false;
    for (const [other, otherSet] of map) {
      if (other === text || other.length <= text.length) continue;
      const extends_ = isPrefix ? other.startsWith(text) : other.endsWith(text);
      if (extends_ && otherSet.size >= set.size * 0.9) {
        dominated = true;
        break;
      }
    }
    if (!dominated) out.push({ text, count: set.size, examples: [...set].slice(0, 3) });
  }
  return out.sort((a, b) => b.count - a.count);
}

function report(title: string, rows: ReturnType<typeof prune>) {
  const filtered = onlyMissing ? rows.filter((r) => !known.has(r.text)) : rows;
  console.log(`\n=== ${title} (${filtered.length}) ===`);
  for (const r of filtered.slice(0, 120)) {
    const mark = known.has(r.text) ? '✓' : ' ';
    console.log(`${mark} ${String(r.count).padStart(4)}  ${r.text.padEnd(10)} ${r.examples.join(', ')}`);
  }
}

console.log(`Greini ${names.length} samþykkt nöfn — lágmark ${minCount} nöfn á lið.`);
if (known.size) console.log(`Orðasafn hefur nú ${known.size} skráða liði (✓).`);

report('Forliðir', prune(prefixes, true));
report('Viðliðir', prune(suffixes, false));
