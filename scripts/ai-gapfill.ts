/**
 * Drafts meanings for names the lexicon and overrides cannot explain.
 *
 * These are overwhelmingly borrowed names — Aaron, Alexander, Agnes — that are
 * not Old Norse compounds and never will be explicable by element analysis.
 *
 * IT SEARCHES; IT DOES NOT RECALL. An earlier version of this script asked the
 * model to write etymologies from memory. That produces fluent, plausible text
 * for names where no scholarship exists — the failure mode is not a blank, it
 * is a confident invention, and self-reported confidence does not catch it.
 *
 * So the model is given the web-search tool and required to return a source URL
 * for every name. Anything that comes back without a usable source is dropped
 * here rather than shown, which means coverage is deliberately incomplete: a
 * name nobody has written about stays blank. That is the intended outcome.
 *
 * OUTPUT IS STILL QUARANTINED. Everything lands in data/ai/drafts.json, is
 * consumed last in the precedence chain, and is rendered with an "óstaðfest"
 * badge. A cited draft is better evidence than an uncited one, but it is still
 * a page the model chose — not a lexicographer's judgement.
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
// Small batches: the model has to run real searches per name, and a large
// batch pushes it toward answering the tail from memory to finish the list.
const CHUNK = 8;
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
  /** URL the claim came from. No source, no draft. */
  heimild: string;
  heimildTitill?: string;
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

VINNULAG — LESTU ÞETTA FYRST.
Þú mátt EKKI skrifa skýringu eftir minni. Fyrir hvert nafn skaltu leita á vefnum
og byggja svarið á heimild sem þú fannst. Gagnlegar leitir eru t.d.
"<nafn> nafn uppruni merking", "<nafn> name etymology origin", eða
"<nafn> mannanafn". Góðar heimildir eru orðabækur, nafnfræðirit, Wikipedia,
Wiktionary, Nordic Names og fræðilegar síður.

Ef þú finnur ENGA heimild fyrir nafni skaltu skila því með vissa: "lag" og tómri
merkingu. Það er rétt niðurstaða — mörg þessara nafna eru nýleg, tilbúin eða
mjög sjaldgæf og enginn hefur skrifað um þau. Ekki búa til sennilega hljómandi
skýringu til að fylla upp í listann. Skýring án heimildar er verri en engin,
því þessi gögn fara á vef sem fólk notar til að velja nöfn á börn.

Fyrir hvert nafn skaltu skila:
- nafn: nákvæmlega eins og það kom inn, með lágstaf.
- merking: stutt merking á íslensku, 2–8 orð. Dæmi: "náð, hylli". Tómt ef engin heimild fannst.
- skyring: ein til þrjár setningar á íslensku um uppruna nafnsins, byggðar á heimildinni.
- uppruni: upprunamálið með lágstaf — t.d. hebreska, gríska, latína, norræna, íslenska, þýska, enska, franska, írska, arabíska, slavneska.
- flokkar: núll eða fleiri af þessum flokkum, aðeins þeir sem eiga sannarlega við: ${CATEGORY_LIST}
- vissa: "ha" ef heimildin er skýr og ótvíræð, "midlungs" ef heimildir eru til en ekki sammála, "lag" ef engin heimild fannst.
- heimild: slóðin (URL) sem skýringin byggir á. Skilaðu tómum streng ef engin heimild fannst.
- heimildTitill: stutt heiti heimildarinnar, t.d. "Wiktionary" eða "Nordic Names".

Skrifaðu allt á íslensku nema slóðina sjálfa.`;



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
          heimild: { type: 'string' },
          heimildTitill: { type: 'string' },
        },
        required: ['nafn', 'merking', 'skyring', 'uppruni', 'flokkar', 'vissa', 'heimild', 'heimildTitill'],
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
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: `Flettu upp uppruna þessara ${names.length} nafna og skilaðu heimild fyrir hvert:\n\n${names.join('\n')}`,
    },
  ];

  let message: Anthropic.Beta.BetaMessage | undefined;

  // The server-side search loop caps at 10 iterations and returns pause_turn;
  // re-sending the assistant turn resumes it. Without this the run silently
  // truncates on exactly the names that needed the most searching.
  for (let turn = 0; turn < 6; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      // Safety classifiers can decline a request outright. Explaining the
      // origin of Arabic and Hebrew names is benign but sits close enough to
      // flagged territory to trip one occasionally, so let the API retry on a
      // fallback model rather than dropping the whole batch.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 16 }],
      // The system prompt is identical on every request; cache it so only the
      // name list is billed at full rate.
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages,
    });

    message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      console.warn('  ⚠ Beiðni hafnað af öryggisástæðum — sleppi þessum hópi.');
      return [];
    }
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }

  if (!message) return [];

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
      heimild: (d.heimild ?? '').trim(),
      heimildTitill: d.heimildTitill?.trim() || undefined,
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
      // Two gates, and the source one is the load-bearing gate. Self-reported
      // confidence only catches the cases the model knows it is unsure about;
      // requiring a real URL is what catches a confident invention.
      const keep = drafts.filter(
        (d) => d.vissa !== 'lag' && /^https?:\/\/\S+$/.test(d.heimild) && d.merking.trim() !== '',
      );
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
console.log(`  ${dropped} felld niður (engin heimild fannst eða líkanið var að giska)`);
const sourced = results.filter((d) => d.heimild).length;
console.log(`  ${sourced} af ${results.length} með slóð á heimild`);
console.log('\nKeyrðu `npm run build:data` til að fella þau inn.');
