/**
 * English — the source of truth.
 *
 * `Messages` is derived from this object, so every key added here must be added
 * to `es.ts` or the build fails. That is the point: a two-language app stays
 * two languages only if forgetting is impossible rather than merely rude.
 *
 * ── HOW TO WRITE COPY IN HERE ───────────────────────────────────────────────
 * The tone rules do not change because the strings moved (second_draft §9.7,
 * §10.2): explain rather than quiz, never imply somebody's gear or palate is
 * the problem, suggest rather than prescribe. Placeholders are `{named}`, never
 * positional — a translator reading `{count} people` can move it; `%s` cannot
 * be moved safely into a language with different word order.
 */
export const en = {
  common: {
    signIn: 'Sign in',
    signUp: 'Sign up',
    signOut: 'Sign out',
    profile: 'Profile',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    remove: 'Remove',
    optional: '(optional)',
    loading: 'Loading…',
    tryAgain: 'That did not work. Try again in a moment.',
    language: 'Language',
  },

  nav: {
    skipToContent: 'Skip to content',
    home: 'Home',
    logIn: 'Log in',
    news: 'News',
    community: 'Community',
    marketplace: 'Marketplace',
    discoverShort: 'Discover',
    discover: 'Discover coffee',
    equipment: 'Equipment',
    recipes: 'Recipes',
    brew: 'Brew',
    learn: 'Learn',
    ai: 'AI',
  },

  home: {
    tagline: 'Brewing intelligence for people who love coffee',
    lede: 'Log your brews, dial in your grinder and find coffee worth drinking. Beginners welcome — every great brewer started with bitter coffee.',
    headline: 'Coffee gets better when you pay attention.',
    intro:
      'BrewCult attaches to the habit you already have. Log the brew you were going to make anyway, and get something useful back: what changed, what to try next, and which coffees are worth your money.',
    welcome:
      'Every great brewer started with bitter coffee. Bring whatever gear you own — a great cup is absolutely possible on your setup, and nobody here is going to tell you to buy a $700 grinder first.',
    discoverCta: 'Discover coffee',
    profileCta: 'Your profile',
    registerCta: 'Create an account',
    lookAroundCta: 'Look around first',
    logTitle: 'A brew log, not homework',
    logBody:
      'Ten seconds, one tap to repeat yesterday. It works with one bar of wifi in the kitchen, because that is where brewing happens.',
    suggestionsTitle: 'Suggestions, never orders',
    suggestionsBody:
      '“Try grinding finer” — then you decide. Experiments are the point, and one that flops is still useful data.',
    questionsTitle: 'Questions are welcome',
    questionsBody:
      'No downvotes, no gear-shaming. Patient explanation is what earns status here.',
  },

  discover: {
    title: 'Discover coffee',
    lede: 'Origins, processes and roasters, described in plain language. Nothing here assumes you already know what a washed Yirgacheffe tastes like — that is what the notes are for.',
    coffees: 'Coffees',
    empty:
      'We are still filling the shelves — and the fastest way to fill them is a photo of whatever you are drinking. Use “Add a coffee” above.',
    loadError:
      'That is on us, not on you. Refresh in a moment — the search box above may still work.',
  },

  addCoffee: {
    action: 'Add a coffee',
    openBags: '{count} open bags on your shelf',
    openBag: '1 open bag on your shelf',
    intro:
      'Photograph the bag — the label has everything on it. Both sides help: the front names the roaster and the coffee, the back usually carries the roast date and the process. The assistant reads them together, adds the bag to your shelf, and puts it in the catalogue if the label is clear enough.',
    front: 'Front of the bag',
    frontHint: 'The roaster and the name of the coffee.',
    back: 'Back of the bag',
    backHint: 'Roast date, process, weight — whatever is printed there.',
    pasteButton: 'Paste from clipboard',
    pasteHint: 'Or press Ctrl+V (⌘V) anywhere in this box — it fills the next empty slot.',
    publishNotice: 'If this coffee is added to the catalogue, your first photo becomes its picture on the site.',
    noteLabel: 'Anything the photo misses',
    notePlaceholder: 'e.g. the roast date is on the bottom seam',
    submit: 'Add this coffee',
    reading: 'Reading the label…',
    typeInstead: 'Type it instead',
    manualIntro:
      'Straight onto your shelf. Nothing is published and nothing is read — this is just so you have something to log brews against.',
    roaster: 'Roaster',
    coffee: 'Coffee',
    addToShelf: 'Add to my shelf',
    usePhoto: 'Use a photo',
    yoursOnly: 'yours only',
    finished: 'Finished',
    publishedTitle: '{name} is on your shelf.',
    publishedBody:
      'It is in the catalogue too, so other people can find it — and the roaster is listed as unverified until somebody confirms it.',
    shelvedTitle: '{name} is on your shelf.',
    shelvedBody:
      'The label was not clear enough to publish, so this one is yours alone. It works exactly the same for logging brews.',
  },

  offers: {
    heading: 'Where to buy it',
    empty:
      'Nobody has added a price yet. If you know what it costs and where, that is the most useful thing on this page.',
    add: 'Add a price',
    shop: 'Shop or roastery',
    town: 'Town',
    size: 'Bag size',
    priceCrc: 'Price in colones',
    priceUsd: 'Price in dollars',
    currencyHint:
      'Whichever the shop actually quotes — one is enough. The other currency is shown as an ≈ approximation, so the shop’s own number is always the bold one.',
    contacts: 'How to reach them (optional)',
    phone: 'Phone',
    whatsapp: 'WhatsApp',
    website: 'Website',
    instagram: 'Instagram',
    facebook: 'Facebook',
    maps: 'Map link',
    linkLabel: 'Link to this coffee on their site',
    submit: 'Add this price',
    unverified: 'unverified',
    quotedOn: 'quoted {date}',
    outOfStock: 'out of stock',
    approxTitle: 'Converted at ₡{rate}/$ — the shop quotes {quoted}',
    needAPrice: 'Give a price in colones, in dollars, or both.',
  },

  notes: {
    heading: 'What people thought',
    summary: '{score} overall from {count} people',
    summaryOne: '{score} overall from 1 person',
    cupping: '{score} cupping score from {count}',
    signedOutPrompt: 'to rate this one or leave a note.',
    rate: 'Rate this coffee',
    edit: 'Edit my note',
    overallLabel: 'Overall — the SCA scale, 6 to 10',
    pickScore: 'Pick a score…',
    scaleHint:
      'The same scale a cupping table uses — 80+ across the full form is what “specialty” means.',
    whatEachMeans: 'What each factor means',
    openFullForm: 'Score the full cupping form',
    fullFormHint: '— nine more attributes, for a score out of 100.',
    howToIdentify: 'How to identify each one',
    taints: 'Tainted cups',
    faults: 'Faulty cups',
    minusTwo: '(−2 each)',
    minusFour: '(−4 each)',
    partialFormHint:
      'All nine plus Overall gives a score out of 100. Leave any blank and the note still counts — it simply has no total, which is honest rather than approximate.',
    bodyLabel: 'Anything worth saying',
    bodyPlaceholder: 'What it tasted like, what worked, what you would change.',
    methodLabel: 'How you brewed it',
    methodPlaceholder: 'V60, 1:16, 94°C',
    methodHint: 'Context settles arguments a note on its own starts.',
    post: 'Post my note',
    update: 'Update my note',
    deleteMine: 'Delete my note',
    emptyList:
      'Nobody has said anything yet. If you have had this one, you know more about it than anybody reading this page.',
    useful: 'Useful',
    usefulDone: 'Useful ✓',
    foundUseful: '{count} found this useful',
    noVotes: 'No votes yet',
    you: 'you',
    cupped: 'cupped',
    someone: 'Someone',
    outOf100: '{score}/100',
    overallOnly: '{score} overall',
  },

  scale: {
    good: 'Good',
    veryGood: 'Very good',
    excellent: 'Excellent',
    outstanding: 'Outstanding',
    exceptional: 'Exceptional',
  },

  session: {
    restoring: 'Signing you back in…',
    noScript: 'This page needs JavaScript to restore your session.',
  },

  errors: {
    forbidden: "You don't have access to that.",
    notFound: "We couldn't find that.",
    unauthorized: 'Please sign in again to continue.',
    conflict: 'That already exists — try signing in instead.',
    rateLimited: 'That was a lot of tries in a row. Give it a minute and go again.',
    invalidCredentials: "That email and password didn't match. Try again, or reset your password.",
    emailNotVerified: 'Almost there — confirm your email address first. We can resend the link.',
    invalidToken: 'That link has expired or was already used. Request a fresh one.',
    network: "We couldn't reach BrewCult. Check your connection — nothing you typed was lost.",
    server: 'Something broke on our side, not yours. Try again in a moment.',
    form: 'Something in the form needs a tweak.',
    tooLong: 'That took too long. Try again?',
    busy: 'BrewCult is catching its breath. Try again in a moment.',
  },
} as const;
