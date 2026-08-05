/**
 * schema.org JSON-LD emitters for the public catalog + recipe pages
 * (CAT-09 "structured data", REC-06 "structured data; shareable OG cards").
 *
 * Three rules, in priority order:
 *
 *  1. **Honesty over richness.** Rich results are worth a lot, and lying to get
 *     them is worth a manual action. Nothing here invents an `aggregateRating`,
 *     an `offer`, a `price` or a `nutrition` block. Every field emitted is a
 *     field the API actually returned; absent data produces an absent key, not
 *     a zero or an empty string. This is the §6.4/§18 honesty rule applied to
 *     markup instead of copy.
 *  2. **Pure functions.** These emitters take plain data and return plain
 *     objects, so they are unit-testable without a renderer. Serialisation and
 *     the nonce live in `components/catalog/json-ld.tsx`.
 *  3. **Absolute URLs.** Google resolves relative `@id`/`url` inconsistently;
 *     everything is absolutized through `lib/seo.ts#absoluteUrl`.
 */
import { absoluteUrl } from './seo';

/** A JSON-LD document. `@context` is always the schema.org vocabulary. */
export interface JsonLdDocument {
  '@context': 'https://schema.org';
  '@type': string;
  [key: string]: unknown;
}

const SCHEMA_CONTEXT = 'https://schema.org' as const;

/** Drop null/undefined/empty-array/empty-string keys — an empty property is a
 *  worse signal than a missing one. */
function compact<T extends Record<string, unknown>>(input: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    output[key] = value;
  }
  return output as T;
}

/** schema.org `PropertyValue` — the honest home for domain facts that have no
 *  first-class schema.org property (process, varietal, altitude, burr size…). */
export function propertyValue(name: string, value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return { '@type': 'PropertyValue', name, value: value.join(', ') };
  }
  if (typeof value === 'object') return null;
  return { '@type': 'PropertyValue', name, value: String(value) };
}

function properties(entries: [string, unknown][]): Record<string, unknown>[] {
  return entries
    .map(([name, value]) => propertyValue(name, value))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

/* ------------------------------------------------------------------ *
 * BreadcrumbList
 * ------------------------------------------------------------------ */

export interface BreadcrumbEntry {
  name: string;
  /** Site-relative path, e.g. `/coffee/ethiopia-chelbesa`. */
  path: string;
}

/**
 * `BreadcrumbList` for the trail rendered on the page. The last crumb is the
 * current page and still carries an item URL — Google's examples do, and it
 * keeps the list self-consistent.
 */
export function breadcrumbJsonLd(entries: BreadcrumbEntry[]): JsonLdDocument {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: absoluteUrl(entry.path),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Product — coffee
 * ------------------------------------------------------------------ */

export interface CoffeeJsonLdInput {
  slug: string;
  name: string;
  description?: string | null;
  roaster: { name: string; slug: string };
  roastLevel?: string | null;
  intendedUse?: string | null;
  tastingNotes?: string[];
  process?: string | null;
  varietals?: string[];
  altitudeMasl?: number | null;
  harvestPeriod?: string | null;
  origin?: { country: string; region: string | null } | null;
  farmName?: string | null;
}

/**
 * `Product` for a coffee, with the roaster as `brand` (an Organization) — the
 * relationship a search engine can actually use, and the one §5 says must never
 * be free text.
 *
 * No `offers`: BrewCult does not sell this bag yet (marketplace is Phase 4).
 * Emitting a fake offer would be the fastest way to lose the rich result.
 */
export function coffeeProductJsonLd(coffee: CoffeeJsonLdInput): JsonLdDocument {
  const origin = coffee.origin
    ? coffee.origin.region
      ? `${coffee.origin.country}, ${coffee.origin.region}`
      : coffee.origin.country
    : null;

  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Product',
    ...compact({
      '@id': absoluteUrl(`/coffee/${coffee.slug}`),
      name: coffee.name,
      url: absoluteUrl(`/coffee/${coffee.slug}`),
      description: coffee.description ?? null,
      category: 'Coffee',
      brand: compact({
        '@type': 'Organization',
        name: coffee.roaster.name,
        url: absoluteUrl(`/roaster/${coffee.roaster.slug}`),
      }),
      countryOfOrigin: coffee.origin?.country ?? null,
      keywords: coffee.tastingNotes && coffee.tastingNotes.length > 0
        ? coffee.tastingNotes.join(', ')
        : null,
      additionalProperty: properties([
        ['Roast level', coffee.roastLevel],
        ['Intended use', coffee.intendedUse],
        ['Process', coffee.process],
        ['Origin', origin],
        ['Farm or washing station', coffee.farmName],
        ['Varietals', coffee.varietals],
        ['Altitude', coffee.altitudeMasl === null || coffee.altitudeMasl === undefined
          ? null
          : `${coffee.altitudeMasl} masl`],
        ['Harvest', coffee.harvestPeriod],
        ['Tasting notes', coffee.tastingNotes],
      ]),
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Organization — roaster
 * ------------------------------------------------------------------ */

export interface RoasterJsonLdInput {
  slug: string;
  name: string;
  description?: string | null;
  location?: string | null;
  websiteUrl?: string | null;
}

/**
 * `Organization` for a roaster. `sameAs` carries the roaster's own site when we
 * know it — that is the link that lets a search engine reconcile this profile
 * with the real business instead of treating it as a duplicate.
 */
export function roasterOrganizationJsonLd(roaster: RoasterJsonLdInput): JsonLdDocument {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Organization',
    ...compact({
      '@id': absoluteUrl(`/roaster/${roaster.slug}`),
      name: roaster.name,
      url: absoluteUrl(`/roaster/${roaster.slug}`),
      description: roaster.description ?? null,
      sameAs: roaster.websiteUrl ? [roaster.websiteUrl] : null,
      address: roaster.location
        ? { '@type': 'PostalAddress', addressLocality: roaster.location }
        : null,
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Product — equipment
 * ------------------------------------------------------------------ */

export interface EquipmentJsonLdInput {
  slug: string;
  name: string;
  description?: string | null;
  brand: { name: string };
  category: string;
  grindScaleType?: string | null;
  specs?: Record<string, unknown>;
}

/** `Product` for an equipment model. Specs become `additionalProperty` rows —
 *  scalar values only; a nested object is dropped rather than stringified. */
export function equipmentProductJsonLd(equipment: EquipmentJsonLdInput): JsonLdDocument {
  const specEntries: [string, unknown][] = Object.entries(equipment.specs ?? {}).map(
    ([key, value]) => [key.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()), value],
  );

  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Product',
    ...compact({
      '@id': absoluteUrl(`/equipment/${equipment.slug}`),
      name: `${equipment.brand.name} ${equipment.name}`,
      url: absoluteUrl(`/equipment/${equipment.slug}`),
      description: equipment.description ?? null,
      category: equipment.category,
      brand: { '@type': 'Brand', name: equipment.brand.name },
      additionalProperty: properties([
        ['Category', equipment.category],
        ['Grind scale', equipment.grindScaleType],
        ...specEntries,
      ]),
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Recipe
 * ------------------------------------------------------------------ */

export interface RecipeJsonLdInput {
  id: string;
  name: string;
  description?: string | null;
  authorName?: string | null;
  datePublished?: string | null;
  method: string;
  /** Ingredient lines, already human-formatted ("18 g coffee", "300 g water"). */
  ingredients?: string[];
  /** Ordered steps; `text` is required, `name` optional. */
  steps?: { name?: string | null; text: string }[];
  /** Seconds. Emitted as an ISO-8601 duration. */
  totalTimeSeconds?: number | null;
  /** e.g. "300 g brewed coffee" / "36 g espresso". */
  yieldText?: string | null;
  /** Equipment names — schema.org `tool`. */
  tools?: string[];
  keywords?: string[];
}

/** Seconds → ISO-8601 duration (`PT3M15S`). schema.org wants the ISO form. */
export function isoDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return `PT${rest}S`;
  if (rest === 0) return `PT${minutes}M`;
  return `PT${minutes}M${rest}S`;
}

/**
 * `Recipe` for a brew recipe.
 *
 * Honest use of the vocabulary: `recipeCategory` is the brew method,
 * `recipeYield` is what ends up in the cup, `tool` is the gear, and
 * `recipeInstructions` are real `HowToStep`s built from the pour schedule. No
 * `nutrition`, no `aggregateRating`, no `cookTime` — a pour-over has no cook
 * time, and inventing one to fill a field is exactly the kind of markup that
 * gets a site demoted.
 */
export function recipeJsonLd(recipe: RecipeJsonLdInput): JsonLdDocument {
  const totalTime =
    typeof recipe.totalTimeSeconds === 'number' ? isoDuration(recipe.totalTimeSeconds) : null;

  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Recipe',
    ...compact({
      '@id': absoluteUrl(`/recipes/${recipe.id}`),
      name: recipe.name,
      url: absoluteUrl(`/recipes/${recipe.id}`),
      description: recipe.description ?? null,
      author: recipe.authorName ? { '@type': 'Person', name: recipe.authorName } : null,
      datePublished: recipe.datePublished ?? null,
      recipeCategory: recipe.method,
      recipeCuisine: 'Coffee',
      recipeYield: recipe.yieldText ?? null,
      totalTime,
      recipeIngredient: recipe.ingredients ?? null,
      recipeInstructions:
        recipe.steps && recipe.steps.length > 0
          ? recipe.steps.map((step) =>
              compact({ '@type': 'HowToStep', name: step.name ?? null, text: step.text }),
            )
          : null,
      tool: recipe.tools && recipe.tools.length > 0
        ? recipe.tools.map((name) => ({ '@type': 'HowToTool', name }))
        : null,
      keywords: recipe.keywords && recipe.keywords.length > 0 ? recipe.keywords.join(', ') : null,
    }),
  };
}

/* ------------------------------------------------------------------ *
 * ItemList — hub pages
 * ------------------------------------------------------------------ */

export interface ItemListEntry {
  name: string;
  path: string;
}

/** `ItemList` for an index/hub page, so the crawler sees the set as a set. */
export function itemListJsonLd(name: string, entries: ItemListEntry[]): JsonLdDocument {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'ItemList',
    name,
    numberOfItems: entries.length,
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      url: absoluteUrl(entry.path),
    })),
  };
}

/**
 * Serialise a document for an inline `<script type="application/ld+json">`.
 *
 * `<` is escaped so a `</script>` sequence inside any string field (a roaster
 * name, a tasting note, a recipe title) cannot break out of the tag. JSON-LD
 * parsers unescape `<` transparently, so nothing is lost.
 */
export function serializeJsonLd(document: JsonLdDocument | JsonLdDocument[]): string {
  return JSON.stringify(document).replace(/</g, '\\u003c');
}
