/**
 * Drafts meanings for names the lexicon and overrides cannot explain.
 *
 * These are overwhelmingly borrowed names — Aaron, Alexander, Agnes — that are
 * not Old Norse compounds and never will be explicable by element analysis.
 *
 * OUTPUT IS QUARANTINED. Everything written here lands in data/ai/drafts.json,
 * is consumed last in the precedence chain, and is rendered on the site with an
 * "óstaðfest" badge and a distinct visual treatment. It is never merged into
 * elements.yaml or overrides/names.yaml, and never presented as cited.
 *
 * Usage:
 *   npx tsx scripts/ai-gapfill.ts              # all unresolved names
 *   npx tsx scripts/ai-gapfill.ts --limit 40   # try a sample first
 *   npx tsx scripts/ai-gapfill.ts --model claude-sonnet-5
 *
 * Resumable: names already present in drafts.json are skipped, so an
 * interrupted run can simply be restarted.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { Decomposer } from '../src/lib/decompose.ts';
import { displayCase } from '../src/lib/icelandic.ts';
import { CATEGORIES } from '../src/lib/categories.ts';
import type { RegisterRecord, LexiconElement } from '../src/lib/types.ts';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const MODEL = flag('--model') ?? 'claude-opus-5';
const LIMIT = Number(flag('--limit') ?? 0);
const CHUNK = 20;
const CONCURRENCY = 4;
const OUT = resolve(root, 'data/ai/drafts.json');

interface Draft {
  nafn: string;
  merking: string;
  skyring?: string;
  uppruni: string;
  flokkar: string[];
  /** The model's own certainty. Low-certainty drafts are dropped. */
  vissa: 'ha' | 'midlungs' | 'lag';
}

// ── Work out what still needs a meaning ─────────────────────────────────────
const register: RegisterRecord[] = JSON.parse(
  readFileSync(resolve(root, 'data/raw/mannanafnaskra.json'), 'utf8'),
);
const { elements } = parse(
  readFileSync(resolve(root, 'data/lexicon/elements.yaml'), 'utf8'),
) as { elements: LexiconElement[] };
const { names: overrides } = parse(
  readFileSync(resolve(root, 'data/overrides/names.yaml'), 'utf8'),
) as { names: Array<{ nafn: string }> };

const decomposer = new Decomposer(elements);
const overridden = new Set(overrides.map((o) => o.nafn.toLowerCase()));

const existing: Draft[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
const done = new Set(existing.map((d) => d.nafn.toLowerCase()));

let todo = register
  .filter((r) => r.status === 'Sam' || r.status === 'Haf')
  .filter((r) => !overridden.has(r.icelandicName))
  .filter((r) => !done.has(r.icelandicName))
  .filter((r) => !decomposer.decompose(r.icelandicName, r.type))
  .map((r) => r.icelandicName);

if (LIMIT > 0) todo = todo.slice(0, LIMIT);

if (todo.length === 0) {
  console.log('Ekkert eftir — öll nöfn hafa merkingu.');
  process.exit(0);
}

console.log(`${todo.length} nöfn vantar merkingu. Líkan: ${MODEL}.`);
console.log(`${existing.length} þegar til í data/ai/drafts.json (sleppt).\n`);

// ── Prompt ──────────────────────────────────────────────────────────────────
const CATEGORY_LIST = CATEGORIES.filter((c) => !c.regla)
  .map((c) => `${c.slug} (${c.heiti})`)
  .join(', ');

const SYSTEM = `Þú ert nafnfræðingur sem skrifar stuttar, nákvæmar skýringar á uppruna mannanafna fyrir íslenskan vef.

Fyrir hvert nafn sem þú færð skaltu skila:
- merking: stutt merking á íslensku, 2–8 orð. Dæmi: "náð, hylli" eða "sá sem ber Krist".
- skyring: ein til þrjár setningar á íslensku um uppruna nafnsins. Nefndu upprunamálið og frummyndina þegar þú veist hana. Slepptu þessu ef þú hefur engu við merkinguna að bæta.
- uppruni: upprunamálið með lágstaf — t.d. hebreska, gríska, latína, norræna, íslenska, þýska, enska, franska, írska, arabíska, slavneska.
- flokkar: núll eða fleiri af þessum flokkum, aðeins þeir sem eiga sannarlega við: ${CATEGORY_LIST}
- vissa: "ha" ef uppruninn er vel þekktur og óumdeildur, "midlungs" ef skýringin er almennt viðurkennd en ekki fullviss, "lag" ef þú ert í reynd að giska.

MIKILVÆGT UM ÓVISSU. Þessi gögn fara á vef sem fólk notar til að velja nöfn á börn.
Uppspunnin skýring er verri en engin. Ef þú þekkir ekki uppruna nafnsins skaltu
setja vissa: "lag" og segja hreinskilnislega í merkingunni að uppruninn sé óviss —
ekki búa til sennilega hljómandi skýringu. Mörg nöfnin eru nýleg, tilbúin eða
mjög sjaldgæf og eiga enga þekkta skýringu. Það er eðlileg og rétt niðurstaða.

Skrifaðu allt á íslensku. Nafnið sjálft skal skilað nákvæmlega eins og það kom inn, með lágstaf.`;

const SCHEMA = {
  type: 'object',
  properties: {
    nofn: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nafn: { type: 'string' },
          merking: { type: 'string' },
          skyring: { type: 'string' },
          uppruni: { type: 'string' },
          flokkar: { type: 'array', items: { type: 'string' } },
          vissa: { type: 'string', enum: ['ha', 'midlungs', 'lag'] },
        },
        required: ['nafn', 'merking', 'skyring', 'uppruni', 'flokkar', 'vissa'],
        additionalProperties: false,
      },
    },
  },
  required: ['nofn'],
  additionalProperties: false,
} as const;

const client = new Anthropic();
const VALID_CATEGORIES = new Set(CATEGORIES.filter((c) => !c.regla).map((c) => c.slug));

async function draftChunk(names: string[]): Promise<Draft[]> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    // The system prompt is identical on every request; cache it so only the
    // name list is billed at full rate.
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Skýrðu uppruna þessara ${names.length} nafna:\n\n${names.join('\n')}`,
      },
    ],
  });

  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    console.warn('  ⚠ Beiðni hafnað af öryggisástæðum — sleppi þessum hópi.');
    return [];
  }

  const text = message.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return [];

  const parsed = JSON.parse(text.text) as { nofn: Draft[] };
  const wanted = new Set(names);

  return parsed.nofn
    // Guard against the model inventing names that weren't asked for.
    .filter((d) => wanted.has(d.nafn?.toLowerCase?.() ?? ''))
    .map((d) => ({
      ...d,
      nafn: d.nafn.toLowerCase(),
      skyring: d.skyring?.trim() || undefined,
      flokkar: (d.flokkar ?? []).filter((f) => VALID_CATEGORIES.has(f)),
    }));
}

// ── Run ─────────────────────────────────────────────────────────────────────
const chunks: string[][] = [];
for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));

const results: Draft[] = [...existing];
let completed = 0;
let dropped = 0;

function save() {
  mkdirSync(resolve(root, 'data/ai'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 1), 'utf8');
}

async function worker(queue: string[][]) {
  while (queue.length) {
    const chunk = queue.shift();
    if (!chunk) return;
    try {
      const drafts = await draftChunk(chunk);
      // Honest labelling only goes so far — a draft the model itself calls a
      // guess is not worth showing at all.
      const keep = drafts.filter((d) => d.vissa !== 'lag');
      dropped += drafts.length - keep.length;
      results.push(...keep);
      completed += chunk.length;
      save();
      const pct = ((100 * completed) / todo.length).toFixed(0);
      console.log(
        `  ${completed}/${todo.length} (${pct}%) — ${displayCase(chunk[0])}…${displayCase(chunk.at(-1)!)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Hópur ${displayCase(chunk[0])}… mistókst: ${msg}`);
    }
  }
}

const queue = [...chunks];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

save();
console.log(`\n✓ ${results.length} drög vistuð í data/ai/drafts.json`);
console.log(`  ${dropped} felld niður (líkanið taldi sig vera að giska)`);
console.log('\nKeyrðu `npm run build:data` til að fella þau inn.');
