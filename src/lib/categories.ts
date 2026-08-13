/**
 * The filter taxonomy.
 *
 * Two kinds of category:
 *   - INHERITED: conferred by a name's elements via the lexicon. Tagging ~215
 *     elements is what tags thousands of names, so this is where the leverage
 *     is. Adding a category here means adding it to elements.yaml too.
 *   - REGLA (rule-based): derived from the register record itself — gender,
 *     length, popularity, spelling. Computed in build-data.ts.
 */

export interface Category {
  slug: string;
  heiti: string;
  lysing: string;
  hopur: 'nattura' | 'folk' | 'eiginleikar' | 'hagnytt';
  /** Rule-based categories are not conferred by elements. */
  regla?: boolean;
}

export const CATEGORIES: Category[] = [
  // ── Náttúra ───────────────────────────────────────────────────────────────
  { slug: 'nattura', heiti: 'Náttúra og landslag', lysing: 'Fjöll, klettar, dalir og eyjar', hopur: 'nattura' },
  { slug: 'vedur', heiti: 'Veður og árstíðir', lysing: 'Snjór, vindur, frost og sumar', hopur: 'nattura' },
  { slug: 'vatn', heiti: 'Vatn og haf', lysing: 'Sjór, öldur, ár og firðir', hopur: 'nattura' },
  { slug: 'dyr', heiti: 'Dýr og fuglar', lysing: 'Birnir, ernir, hrafnar og lóur', hopur: 'nattura' },
  { slug: 'plontur', heiti: 'Plöntur og blóm', lysing: 'Björk, reynir, lilja og lauf', hopur: 'nattura' },
  { slug: 'stjornur', heiti: 'Stjörnur og himinn', lysing: 'Sól, tungl, stjörnur og dagur', hopur: 'nattura' },
  { slug: 'ljos', heiti: 'Ljós og eldur', lysing: 'Birta, logi, glóð og geisli', hopur: 'nattura' },
  { slug: 'litir', heiti: 'Litir', lysing: 'Svart, hvítt, rautt og gull', hopur: 'nattura' },

  // ── Fólk og trú ───────────────────────────────────────────────────────────
  { slug: 'godafraedi', heiti: 'Norræn goðafræði', lysing: 'Þór, Freyr, dísir og álfar', hopur: 'folk' },
  { slug: 'kristni', heiti: 'Kristni og trú', lysing: 'Kristur, dýrlingar og biblíunöfn', hopur: 'folk' },
  { slug: 'sogupersonur', heiti: 'Sögupersónur', lysing: 'Nöfn úr Íslendingasögum og fornsögnum', hopur: 'folk' },
  { slug: 'konungborin', heiti: 'Konungborin nöfn', lysing: 'Vald, tign, ætt og höfðingjar', hopur: 'folk' },

  // ── Eiginleikar ───────────────────────────────────────────────────────────
  { slug: 'hernadur', heiti: 'Hernaður og styrkur', lysing: 'Orrusta, vopn, vörn og afl', hopur: 'eiginleikar' },
  { slug: 'fegurd', heiti: 'Fegurð', lysing: 'Fríður, fagur og dýrmætur', hopur: 'eiginleikar' },
  { slug: 'viska', heiti: 'Viska og ráð', lysing: 'Rúnir, ráð, hugur og vit', hopur: 'eiginleikar' },
  { slug: 'gledi', heiti: 'Gleði og friður', lysing: 'Ást, friður, sæla og vinátta', hopur: 'eiginleikar' },

  // ── Hagnýtt (reglubundið) ─────────────────────────────────────────────────
  { slug: 'kynhlutlaust', heiti: 'Kynhlutlaus nöfn', lysing: 'Nöfn skráð kynhlutlaus í mannanafnaskrá', hopur: 'hagnytt', regla: true },
  { slug: 'vinsael', heiti: 'Vinsæl nöfn', lysing: 'Meðal 100 algengustu nafna landsins', hopur: 'hagnytt', regla: true },
  { slug: 'sjaldgaeft', heiti: 'Sjaldgæf nöfn', lysing: 'Nöfn utan vinsældalistans', hopur: 'hagnytt', regla: true },
  { slug: 'nysamthykkt', heiti: 'Nýsamþykkt', lysing: 'Samþykkt af mannanafnanefnd frá 2015', hopur: 'hagnytt', regla: true },
  { slug: 'stutt', heiti: 'Stutt nöfn', lysing: 'Fimm stafir eða færri', hopur: 'hagnytt', regla: true },
  { slug: 'audvelt-erlendis', heiti: 'Auðvelt erlendis', lysing: 'Engir séríslenskir stafir — ð, þ, æ, ö eða broddar', hopur: 'hagnytt', regla: true },
  { slug: 'erlent', heiti: 'Erlend að uppruna', lysing: 'Nöfn sem bárust úr öðrum málum', hopur: 'hagnytt', regla: true },
  { slug: 'millinafn', heiti: 'Millinöfn', lysing: 'Nöfn sem má bera sem millinafn', hopur: 'hagnytt', regla: true },
];

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export const GROUP_LABELS: Record<Category['hopur'], string> = {
  nattura: 'Náttúra',
  folk: 'Fólk og trú',
  eiginleikar: 'Eiginleikar',
  hagnytt: 'Hagnýtt',
};

/** Slugs that elements may legitimately confer. Used by validate-lexicon. */
export const INHERITABLE = new Set(CATEGORIES.filter((c) => !c.regla).map((c) => c.slug));
