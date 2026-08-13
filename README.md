# Nafnaval

Íslenskur nafnavefur: öll nöfn úr mannanafnaskrá, með merkingu, beygingu og flokkum.
Kjarninn er að brjóta nöfn niður í liðina sem þau eru byggð úr — Þórbjörg er Þór + björg —
og láta hvern lið vera sinn eigin flettiflöt.

Static Astro site, ~6,000 prerendered pages, one small client-side island for filtering.

## Uppsetning

```sh
npm install
npm run fetch:all     # sækir gögn (island.is, Hagstofa, BÍN) — ~35 MB niðurhal
npm run build:data    # býr til src/data/*.json og public/leit.json
npm run dev
```

`npm run fetch:all` is only needed when refreshing the source data. The generated
`src/data/*.json` is checked in, so a clean clone can go straight to `npm run dev`.

## Skipanir

| Skipun | Hvað hún gerir |
|---|---|
| `npm run dev` | Astro dev server |
| `npm run build` | Static build to `dist/` |
| `npm run fetch:register` | Whole mannanafnaskrá from island.is (one GraphQL call) |
| `npm run fetch:tidni` | Bearer counts per name from Þjóðskrá (~11k requests, resumable) |
| `npm run fetch:stats` | Hagstofa age-band tables — **not used by the build**, kept for a possible future feature |
| `npm run fetch:bin` | Declensions from BÍN (add `-- --clean` to delete the 450 MB extract) |
| `npm run build:data` | Merge every source into the site's dataset |
| `npm run lint:lexicon` | Validate `data/lexicon/elements.yaml` (catches form collisions) |
| `npm run ai:gapfill` | Draft meanings for names the lexicon can't explain (needs `ANTHROPIC_API_KEY`) |
| `npm test` | Decomposition, collation and folding tests |

## Hvernig merkingar verða til

Precedence, highest first:

1. **`data/overrides/names.yaml`** — hand-written, cited. Always wins. This is where
   borrowed names (Anna, Alexander) and eroded compounds (Sigurður) live.
2. **`data/lexicon/elements.yaml`** — ~215 Old Norse elements, each with a gloss, a
   public-domain citation (Zoëga 1910 / Cleasby–Vigfusson 1874), the positions it may
   occupy, and the categories it confers. `src/lib/decompose.ts` segments names against it.
3. **`data/ai/drafts.json`** — Claude-drafted, quarantined, rendered with an
   `óstaðfest` badge. Never merged into 1 or 2.
4. Nothing — the page says the meaning isn't recorded.

Faith tags come from a separate file, `data/overrides/truarbrogd.yaml`, and are
applied on top of whatever the chain above produced — they say which tradition a
name belongs to, not what it means. It exists for whole names the element
machinery cannot reach (Arabic and Hebrew names). A name may be listed under
several faiths, and Abrahamic names should be.

Categories form a shallow tree: `truarbrogd` is a parent of `kristni`, `islam`,
`gydingdomur` and `godafraedi`, and the build tags a name with the parent whenever
it carries any child. Add a child by giving it `parent:` in `src/lib/categories.ts`.

**Tagging elements is what tags names.** A category added to `þór` applies to every name
containing it, so the taxonomy is mostly a by-product of the lexicon.

### Stækka orðasafnið

```sh
npx tsx scripts/analyze-elements.ts --min 6 --missing
```

Ranks recurring prefixes and suffixes among names the lexicon can't yet resolve, so
curation effort goes where it covers the most names. Add entries to
`data/lexicon/elements.yaml`, then `npm run lint:lexicon && npm test && npm run build:data`.

## Síur og listi

Filter chips are tri-state: **off → hafa með → sleppa → off**. Exclusions beat
inclusions, so "no religious names" means none. State lives in the URL
(`?f=` include, `?x=` exclude, `?k=`/`?kx=` gender) so a filtered view is
shareable, and the active set is always shown as removable pills above the results.

The shortlist (`/listinn`) is localStorage only — no accounts, no analytics.
*Deila listanum* encodes the slugs into a URL; opening someone else's link offers
to merge rather than overwriting what you already saved.

## Þrjú áreiðanleikastig

Never blur these — the site's honesty depends on the reader telling them apart.

| Merki | Merking |
|---|---|
| **Staðfest** | Lexicon decomposition with a dictionary citation, or hand-written |
| **Líkleg** | Decomposition below the confidence threshold |
| **Óstaðfest** | AI draft, visibly marked, explained on `/um` |

## Heimildir og leyfi

- **Mannanafnaskrá** — Þjóðskrá Íslands / mannanafnanefnd, via island.is.
- **Vinsældir** — Hagstofa Íslands (top ~100 per gender only; most names have no rank).
- **Beygingar** — BÍN, Stofnun Árna Magnússonar í íslenskum fræðum, **CC BY-SA 4.0**.
  Kept in its own file (`data/raw/beygingar.json`) so the share-alike obligation stays
  scoped to BÍN-derived material. Attribution is surfaced on `/um` and in the footer.
- **Liðamerkingar** — Zoëga (1910) and Cleasby–Vigfusson (1874), both public domain.

## Útgáfa

Static output — any host works. `netlify.toml` is included; for Cloudflare Pages set
build command `npm run build` and output directory `dist`.
