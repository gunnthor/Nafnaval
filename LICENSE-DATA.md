# Data licensing

The MIT licence in `LICENSE` covers the **source code**. The data in this
repository comes from several places and does not share one licence. If you
plan to reuse any of it, this is the part that matters.

## Summary

| File | Source | Licence |
|---|---|---|
| `data/raw/beygingar.json` | BÍN, Stofnun Árna Magnússonar | **CC BY-SA 4.0** |
| `src/data/nofn.json` | merged — **contains BÍN declensions** | **CC BY-SA 4.0** |
| `public/leit.json`, `src/data/lidir.json`, `src/data/ar.json` | merged, no BÍN content | CC BY 4.0 |
| `data/raw/mannanafnaskra.json` | Þjóðskrá Íslands / mannanafnanefnd | Icelandic public record |
| `data/raw/nafntidni.json` | Þjóðskrá Íslands | Icelandic public sector data |
| `data/raw/vinsaeldir.json` | Hagstofa Íslands | Icelandic public sector data |
| `data/lexicon/elements.yaml` | ours, glossed from public-domain dictionaries | CC BY 4.0 |
| `data/overrides/*.yaml` | ours | CC BY 4.0 |

## BÍN — share-alike, read this first

`data/raw/beygingar.json` holds Icelandic declensions extracted from
[Beygingarlýsing íslensks nútímamáls (BÍN)](https://bin.arnastofnun.is/),
© Stofnun Árna Magnússonar í íslenskum fræðum, licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

**This is a share-alike licence.** If you redistribute that file, or anything
derived from it, you must attribute Stofnun Árna Magnússonar and license your
version under CC BY-SA 4.0 as well.

The extraction is kept in its own file specifically so the obligation stays
scoped and does not silently cover the whole project. **The one exception is
`src/data/nofn.json`**, the merged build output, which embeds BÍN declensions in
the `beyging` field — treat that file as CC BY-SA 4.0 too. The search index
(`public/leit.json`) and the element data contain no BÍN material.

## Þjóðskrá and Hagstofa

The name register, the bearer counts and the popularity tables are Icelandic
public sector data, retrieved from public endpoints documented in `scripts/`.
They are included here so the build is reproducible without re-fetching. They
are records of public administration, not creative works, but if you build on
them, credit Þjóðskrá Íslands and Hagstofa Íslands as the site does on `/um`.

Bearer counts are aggregate figures published by Þjóðskrá. No personal data is
present in this repository.

## Element glosses

`data/lexicon/elements.yaml` is our own work. The definitions are drawn from two
dictionaries that are out of copyright:

- Geir T. Zoëga, *A Concise Dictionary of Old Icelandic* (1910)
- Cleasby & Vigfusson, *An Icelandic-English Dictionary* (1874)

Each entry cites which one it came from in its `heimild` field.

## AI-generated content

`data/ai/drafts.json`, when present, holds meanings drafted by a language model.
They are **not verified against any source**, are labelled `óstaðfest` throughout
the site, and are deliberately kept out of the curated files. Do not treat them
as scholarship, and do not merge them into the lexicon without checking each one.
