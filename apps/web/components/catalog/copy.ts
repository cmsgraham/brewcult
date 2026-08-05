/**
 * Plain-language explanations for every controlled vocabulary in the catalog.
 *
 * This is the difference between a database dump and a page worth ranking
 * (§23.1 — "every public recipe, coffee and equipment page is a landing page").
 * A visitor searching "what is a washed coffee" should get an answer here, not
 * a badge that assumes they already know.
 *
 * Tone rules (§9.7 anti-gatekeeping, §10.2 autonomy):
 *  - Explain, never quiz. No "obviously", no "any barista knows".
 *  - Never imply the reader's gear is the problem.
 *  - Suggestions, not prescriptions: "try", "start around", never "you must".
 */
import type {
  CoffeeStatus,
  EquipmentCategory,
  GrindCategory,
  IntendedUse,
  LotProcess,
  RoastLevel,
} from './catalog-api';

export const PROCESS_LABEL: Record<LotProcess, string> = {
  washed: 'Washed',
  natural: 'Natural',
  honey: 'Honey',
  anaerobic: 'Anaerobic',
  experimental: 'Experimental',
};

export const PROCESS_COPY: Record<LotProcess, string> = {
  washed:
    'The fruit is stripped off the seed before drying, so what you taste is mostly the coffee itself — usually cleaner, brighter and more tea-like.',
  natural:
    'The cherry dries whole around the seed, which pushes fruit into the cup — think berry, jam and wine. Bolder and often sweeter than a washed coffee.',
  honey:
    'Some of the sticky fruit layer stays on during drying. It lands between washed and natural: fruit-forward, but with more structure than a natural.',
  anaerobic:
    'The cherry ferments in a sealed, oxygen-free tank before drying. It can produce intense, unusual flavours — boozy, tropical, sometimes savoury.',
  experimental:
    'The producer tried something outside the usual playbook. Read the roaster’s notes for what to expect; these lots reward curiosity.',
};

export const ROAST_LEVEL_LABEL: Record<RoastLevel, string> = {
  light: 'Light',
  'medium-light': 'Medium-light',
  medium: 'Medium',
  'medium-dark': 'Medium-dark',
  dark: 'Dark',
};

export const ROAST_LEVEL_COPY: Record<RoastLevel, string> = {
  light:
    'Roasted to keep origin character in front: acidity, florals and fruit. Light roasts are less forgiving of a coarse grind — if it tastes thin or sour, go finer before you blame the coffee.',
  'medium-light':
    'Origin character still leads, with a little more sweetness and body than a full light roast. A friendly place to start with pour-over.',
  medium:
    'Balanced — some origin character, some roast sweetness (caramel, cocoa). Usually the most forgiving of small mistakes, which is a real virtue.',
  'medium-dark':
    'Roast flavours (chocolate, toasted nut, molasses) come forward and acidity softens. Often chosen for espresso and for coffee with milk.',
  dark:
    'Deep, bittersweet and low in acidity. Extracts fast, so a slightly coarser grind and a shorter brew often taste better than the recipe on the bag.',
};

export const INTENDED_USE_LABEL: Record<IntendedUse, string> = {
  filter: 'Filter',
  espresso: 'Espresso',
  omni: 'Filter or espresso',
};

export const INTENDED_USE_COPY: Record<IntendedUse, string> = {
  filter:
    'The roaster aimed this at pour-over, immersion and batch brewing. You can absolutely pull it as espresso — expect a brighter, more acidic shot.',
  espresso:
    'Roasted with espresso in mind: enough development to stay sweet under pressure. It usually wants a week or two of rest before it settles down.',
  omni:
    'Roasted to work either way. A good pick if you brew filter on weekdays and pull shots at the weekend — one bag, no compromise you have to think about.',
};

export const STATUS_COPY: Record<CoffeeStatus, string> = {
  active: 'Currently in the roaster’s line-up.',
  seasonal:
    'A seasonal lot — it comes and goes with the harvest. Ratings and recipes here belong to this lot, not to next year’s.',
  discontinued:
    'No longer offered. Kept here because the recipes and brew notes attached to it are still useful, and because harvests rotate — a similar lot may return.',
};

export const EQUIPMENT_CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  brewer: 'Brewer',
  grinder: 'Grinder',
  kettle: 'Kettle',
  scale: 'Scale',
  machine: 'Espresso machine',
  accessory: 'Accessory',
};

export const EQUIPMENT_CATEGORY_PLURAL: Record<EquipmentCategory, string> = {
  brewer: 'Brewers',
  grinder: 'Grinders',
  kettle: 'Kettles',
  scale: 'Scales',
  machine: 'Espresso machines',
  accessory: 'Accessories',
};

export const EQUIPMENT_CATEGORY_COPY: Record<EquipmentCategory, string> = {
  brewer:
    'The vessel the coffee actually brews in. Shape, hole size and filter material change contact time — which is why the same recipe tastes different across brewers.',
  grinder:
    'The single piece of gear that moves the cup most. Consistent particle size is what makes a recipe repeatable; the number on the dial only means something on this model.',
  kettle:
    'Controls how — and how fast — water arrives. A gooseneck buys you precision, not flavour on its own.',
  scale: 'Turns guesswork into a recipe you can repeat tomorrow.',
  machine:
    'Pushes hot water through a compacted puck under pressure. Temperature stability and the ability to hold a flow are what separate them in the cup.',
  accessory: 'Supporting gear — useful, occasionally transformative, never the whole story.',
};

export const GRIND_SCALE_COPY: Record<string, string> = {
  stepped:
    'A stepped dial: settings click into fixed positions, so a setting is repeatable but you cannot land between two of them.',
  stepless:
    'A stepless adjustment: infinite positions between marks, so you can make very small changes — and you need to note where you left it.',
  rotational:
    'Rotations plus clicks (e.g. "2.6" = 2 full turns and 6 clicks). Always write down both numbers; the clicks alone are meaningless.',
};

export const GRIND_CATEGORY_LABEL: Record<GrindCategory, string> = {
  extra_fine: 'Extra fine',
  fine: 'Fine',
  medium_fine: 'Medium-fine',
  medium: 'Medium',
  medium_coarse: 'Medium-coarse',
  coarse: 'Coarse',
};

export const GRIND_CATEGORY_HINT: Record<GrindCategory, string> = {
  extra_fine: 'Powdered sugar — Turkish territory.',
  fine: 'Table salt — espresso territory.',
  medium_fine: 'Somewhere between table salt and sand — most cone pour-overs live here.',
  medium: 'Coarse sand — flat-bottom brewers and drip machines.',
  medium_coarse: 'Rough sand — Chemex and longer immersions.',
  coarse: 'Sea salt — French press and cold brew.',
};

export const METHOD_LABEL: Record<string, string> = {
  filter: 'Filter',
  immersion: 'Immersion',
  espresso: 'Espresso',
};

/** Confidence bands (§6.4 point 4) — the words that must accompany any number. */
export const CONFIDENCE_BAND_COPY: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low confidence — treat this as a rough direction, not a setting.',
  medium: 'Medium confidence — a reasonable starting point to adjust from.',
  high: 'High confidence — still a starting point, but a well-supported one.',
};

export const CONVERSION_SOURCE_COPY: Record<'user_confirmed' | 'seeded', string> = {
  user_confirmed: 'From brews people logged and rated good after switching grinders.',
  seeded: 'From published community charts, not yet confirmed by logged brews here.',
};

/**
 * Freshness framing (§6.2). Roast date is the one number on a bag most people
 * are never told how to read, so we say it plainly rather than printing a date
 * and moving on.
 */
export const FRESHNESS_EXPLAINER =
  'Roast date matters more than a best-before date. Most filter coffee tastes best somewhere between 4 and 21 days off roast, and espresso often wants 7 to 14 days of rest before it stops tasting harsh. Very fresh coffee is not "better" — it is still degassing, which makes it hard to brew evenly.';

export const FRESHNESS_NO_BATCH_COPY =
  'We do not have roast dates for this coffee yet. When you buy it, the bag should carry one — if it only shows a best-before date, that is worth asking the roaster about.';

/** Framing every recipe page carries (§10.2 autonomy — suggestions, not rules). */
export const RECIPE_STARTING_POINT_COPY =
  'Treat this as a starting point, not a rule. Your grinder, your water and your bag of coffee are all slightly different from the ones this was written on — brew it once as written, then change one thing at a time.';

export function processCopy(process: LotProcess | null | undefined): string | null {
  if (!process) return null;
  return PROCESS_COPY[process] ?? null;
}

export function processLabel(process: LotProcess | null | undefined): string | null {
  if (!process) return null;
  return PROCESS_LABEL[process] ?? process;
}

export function roastLevelLabel(level: RoastLevel | null | undefined): string | null {
  if (!level) return null;
  return ROAST_LEVEL_LABEL[level] ?? level;
}

export function grindCategoryLabel(category: GrindCategory | null | undefined): string | null {
  if (!category) return null;
  return GRIND_CATEGORY_LABEL[category] ?? category;
}

/** "Ethiopia, Yirgacheffe" / "Ethiopia" — never a dangling comma. */
export function originLabel(
  origin: { country: string; region: string | null } | null | undefined,
): string | null {
  if (!origin) return null;
  return origin.region ? `${origin.country}, ${origin.region}` : origin.country;
}

/** `95` → `95 °C`; nullish → null. Keeps units out of the JSX. */
export function celsius(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${value} °C` : null;
}

export function grams(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${value} g` : null;
}

/** `195` → `3:15`. Seconds are how the API stores time; minutes are how people read it. */
export function duration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Days between a roast date and now — the number that actually matters (§6.2). */
export function daysSince(isoDate: string, now: Date = new Date()): number | null {
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return null;
  const diff = now.getTime() - then.getTime();
  return Math.floor(diff / 86_400_000);
}

export function formatDate(isoDate: string): string | null {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  // Fixed locale + UTC so the server and client render identical text: a
  // locale-dependent date is a hydration mismatch waiting to happen.
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Sentence-case a snake_case or kebab-case machine token for display. */
export function humanize(token: string): string {
  const spaced = token.replace(/[_-]+/g, ' ').trim();
  if (spaced === '') return token;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
