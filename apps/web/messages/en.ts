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
    // The mobile disclosure and the two landmark names. Invisible to most
    // readers and read aloud to the rest, which is exactly why they were the
    // last English left in a translated nav.
    menu: 'Menu',
    primary: 'Primary',
    homeAria: 'BrewCult — home',
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

  /**
   * Signing in, signing up, and the three dead-ends in between.
   *
   * Sentences that wrap a link are split into fragments — `sentOne`, the link
   * text, `sentTwo` — because the alternative is HTML in the catalogue, and
   * a translator should never have to keep a tag balanced to change a word.
   */
  auth: {
    signInTitle: 'Sign in',
    signInDescription: 'Sign in to BrewCult.',
    signInHeading: 'Welcome back',
    signInLede: 'Your brews are where you left them.',

    // What comes back from a Google round trip. Never a raw code, and never
    // silence — silence looks like the button simply did nothing.
    googleUnavailable:
      'Google sign-in is not available right now. You can sign in with your email instead.',
    googleDenied:
      "We couldn't complete sign-in with Google. Try again, or use your email and password.",
    googleNotActive: 'That account is not active. Get in touch and we will sort it out.',
    googleNoEmail:
      'Google did not share an email address with us, so we could not sign you in. Use your email and password instead.',
    googleUnverified:
      'That Google account has an unverified email address. Verify it with Google first, or sign in with your email and password.',
    googleUnknown:
      'We could not complete that sign-in. Try again, or use your email and password.',

    // Google's own approved wording, in Google's own translations. Not ours to
    // reword — see the note in components/auth/google-button.tsx.
    googleSignIn: 'Sign in with Google',
    googleSignUp: 'Sign up with Google',
    orUseEmail: 'or use your email',

    emailLabel: 'Email',
    passwordLabel: 'Password',
    /** Slots into `validation.required`. See the note on `validateRequired`. */
    passwordNoun: 'Password',
    signingIn: 'Signing in…',
    forgotPassword: 'Forgot your password?',
    newHere: 'New here?',
    createAnAccount: 'Create an account',
    somethingWrong: 'Something went wrong on our side. Try again in a moment.',

    // Leg two: the account has two-factor on.
    mfaRecoveryPrompt:
      'Enter one of the recovery codes you saved when you set up two-factor authentication.',
    mfaCodePrompt: 'Open your authenticator app and enter the current 6-digit code.',
    mfaRecoveryLabel: 'Recovery code',
    mfaCodeLabel: 'Authentication code',
    mfaRecoveryMissing: 'Enter a recovery code.',
    mfaCodeMissing: 'Enter the 6-digit code.',
    mfaChecking: 'Checking…',
    mfaVerify: 'Verify and sign in',
    mfaUseApp: 'Use your authenticator app instead',
    mfaUseRecovery: 'Lost your device? Use a recovery code',
    mfaStartOver: 'Start over',

    registerTitle: 'Create an account',
    registerDescription:
      'Join BrewCult. Beginners welcome — every great brewer started with bitter coffee.',
    registerHeading: 'Start where you are',
    registerLede:
      'Every great brewer started with bitter coffee. Beginner questions are welcome here, whatever gear is on your counter.',
    handleLabel: 'Handle',
    handleHint: 'Lowercase letters, numbers and underscores. This is your @name.',
    displayNameLabel: 'Display name (optional)',
    displayNameHint: 'What people see. You can change it any time.',
    newPasswordHint: 'At least {min} characters. A short sentence beats a clever squiggle.',
    ageUnconfirmed: 'Please confirm you are 16 or older.',
    agePre: 'I am 16 or older and I accept the',
    ageTerms: 'Terms',
    ageMid: 'and',
    agePrivacy: 'Privacy Policy',
    personalisationHeading: 'What we do with your brews',
    personalisationBody:
      'Your brew logs build a taste profile that we use to suggest coffees and dial-in tweaks. That is the whole trick — nothing is sold, and there is an off switch in your profile. Turning it off makes suggestions blander; it does not lock you out of anything. You can export or delete everything whenever you like.',
    creating: 'Creating your account…',
    createAccount: 'Create account',
    haveAccount: 'Already have an account?',
    registeredTitle: 'Check your email.',
    registeredOne:
      'We sent you a link to confirm your address. Once you have clicked it you can',
    registeredSignIn: 'sign in',
    registeredTwo: '. No link after a few minutes? Look in spam, then',
    registeredRetry: 'try again',

    forgotTitle: 'Reset your password',
    forgotDescription: 'Request a BrewCult password reset link.',
    forgotLede: 'It happens to everyone. Tell us your email and we will send a link.',
    forgotEmailHint: 'We will send a link that lets you set a new password.',
    forgotSending: 'Sending…',
    forgotSubmit: 'Send reset link',
    forgotRemembered: 'Remembered it?',
    forgotBackToSignIn: 'Back to sign in',
    forgotSentTitle: 'Check your email.',
    forgotSentBody:
      'If that address has a BrewCult account, a reset link is on its way. The link works once and expires shortly — request another any time.',

    resetTitle: 'Choose a new password',
    resetDescription: 'Set a new password for your BrewCult account.',
    resetNewLabel: 'New password',
    resetNewHint: 'At least {min} characters.',
    resetConfirmLabel: 'Confirm new password',
    resetMismatch: 'These two do not match yet.',
    resetSubmit: 'Set new password',
    resetNoTokenTitle: 'This link is missing its token.',
    resetNoTokenOne: 'Open the link straight from the email, or',
    resetNoTokenLink: 'request a new one',
    resetDoneTitle: 'Password changed.',
    resetDoneOne: 'You are all set —',
    resetDoneLink: 'sign in',
    resetDoneTwo: 'with your new password.',

    verifyTitle: 'Confirm your email',
    verifyDescription: 'Confirm your BrewCult email address.',
    verifyWorking: 'Confirming your email…',
    verifyDoneTitle: 'Email confirmed.',
    verifyDoneOne: 'Welcome in.',
    verifyDoneLink: 'Sign in',
    verifyDoneTwo: 'and log your first brew — it takes about ten seconds.',
    verifyFailedTitle: 'That link did not work.',
    verifyFailedOne: 'You can',
    verifyFailedLink: 'sign in',
    verifyFailedTwo: 'and ask for a fresh one from your profile.',
    verifyIdleTitle: 'Look for the link in your inbox.',
    verifyIdleOne:
      'Confirmation links open this page and finish the job on their own. Nothing in your inbox after a few minutes? Check spam, then',
    verifyIdleLink: 'sign in',
    verifyIdleTwo: 'and request another.',
  },

  validation: {
    emailMissing: 'We need your email address to sign you in.',
    emailMalformed: 'That does not look like an email address yet.',
    required: '{label} is required.',
    passwordMissing: 'Choose a password so we can keep your account yours.',
    passwordShort:
      'A little longer, please — at least {min} characters. A short sentence works well.',
    handleMissing: 'Pick a handle — this is how people will find you.',
    handleMalformed: 'Handles use 3–30 lowercase letters, numbers or underscores.',
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

  brew: {
    title: 'Log a brew',
    description: 'Log a brew in one tap — your last recipe, prefilled, with steppers instead of a form.',
    footnote:
      'Filter and immersion for now. Espresso lands once this card clears its fifteen-second bar with real people.',
    loggerLabel: 'Brew logger',
    loading: 'Getting your last brew…',
    resumed: 'Picked up where you left off — nothing was lost.',
    queueOne: '1 brew waiting to sync. It is safe on this device.',
    queueMany: '{count} brews waiting to sync. They are safe on this device.',

    offlineTitle: 'You’re offline',
    offlineBody:
      'Nothing is lost. Any brew you logged is stored on this device and syncs itself the moment you have signal again — you don’t have to do anything.',
    offlineDescription: 'BrewCult works without a connection.',
    backToLogger: 'Back to the logger',

    noBag: 'No bag chosen yet',
    switchBag: 'Switch bag',
    newCoffee: 'Brewing a new coffee…',

    basisLast: 'Same as your last brew',
    basisOfficial: 'The roaster’s recipe for this coffee',
    basisCommunity: 'A community recipe for your gear',
    basisDefaults: 'A starting point — change anything',

    brewer: 'Brewer',
    pourOver: 'Pour over',
    doseWater: 'Dose → water',
    temperature: 'Temperature',
    time: 'Time',
    grind: 'Grind',
    dose: 'Dose',
    water: 'Water',
    brewAgain: 'Brew this again',
    logThis: 'Log this brew',
    tweak: 'Tweak',

    changeCoffee: 'Change coffee',
    applyIt: 'Apply it',
    followsWater: 'follows water',
    followsDose: 'follows dose',
    waterFollowsDose: 'water follows dose',
    doseFollowsWater: 'dose follows water',
    ratioWaterFollows:
      'Ratio {ratio}. Water follows dose. Activate so dose follows water instead.',
    ratioDoseFollows:
      'Ratio {ratio}. Dose follows water. Activate so water follows dose instead.',
    more: 'More',
    grindCategory: 'Grind category',
    grindCategoryHint: 'The only grind value that survives a change of grinder.',
    logBrew: 'Log brew',
    back: 'Back',

    decrease: 'Decrease {label}',
    increase: 'Increase {label}',
    exactValue: '{label}, exact value',
    grams: '{value} grams',
    degrees: '{value} degrees celsius',
    brewTime: 'Brew time',
    startTimer: 'Start timer',
    stopTimer: 'Stop timer',

    howWasIt: 'How was it?',
    rateWhenTasted: 'Rate it when you’ve tasted it',
    tasteBitter: 'Bitter',
    tasteSour: 'Sour',
    tasteWeak: 'Weak',
    tasteGood: 'Good',
    hintOverExtracted: 'usually over-extracted',
    hintUnderExtracted: 'usually under-extracted',
    hintKeeper: 'a keeper',

    logged: 'Logged.',
    remindMe: 'Remind me tomorrow',
    reminded: 'It’ll be waiting on tomorrow’s card.',
    synced: 'Synced.',
    savedOffline: 'Saved on this device. It syncs itself when you have signal.',
    savedLocally: 'Saved on this device.',
    logAnother: 'Log another',
    share: 'Share this brew',
    thisBrew: 'This brew',

    /**
     * The payback line. `nth` carries an ordinal word; `nthPlain` is the escape
     * hatch for counts a language has no comfortable ordinal for — English never
     * needs it, because "27th" is a rule rather than a vocabulary item.
     */
    paybackNth: '{ordinal} brew of this bag',
    paybackNthPlain: 'Brew {n} of this bag',
    paybackTrending: '{nth} — your ratings are trending up.',
    paybackGood: '{nth}, and a good one. Worth repeating.',
    paybackOneThing: '{nth}. One thing changed — we’ll compare it to the last one for you.',
    paybackPlain: '{nth}.',
    paybackWith: '{nth}. {suggestion}',
    suggestBitter: 'That happens — bitter usually means over-extracted. Try 0.5 coarser tomorrow?',
    suggestSour: 'Sour usually means under-extracted. Try 0.5 finer tomorrow?',
    suggestWeak: 'Weak usually means under-extracted. A little finer, or a touch more coffee?',

    chooseCoffee: 'Choose a coffee',
    whichCoffee: 'Which coffee?',
    searchPlaceholder: 'Start typing — “chelb” finds it',
    noMatch: 'No match yet — you can add it in three fields below.',
    matchOne: '1 match.',
    matchMany: '{count} matches.',
    searchOffline: 'Search needs a connection. Add it in three fields below and log anyway.',
    recentBags: 'Recent bags',
    addInThree: 'Add it in three fields',
    roaster: 'Roaster',
    coffeeName: 'Coffee name',
    roastLevel: 'Roast level',
    roastLight: 'Light',
    roastMediumLight: 'Medium-light',
    roastMedium: 'Medium',
    roastMediumDark: 'Medium-dark',
    roastDark: 'Dark',
    useThisCoffee: 'Use this coffee',
    matchLater: 'We’ll match it to the catalogue later. Your brews stay attached to it either way.',
    notInList: 'Not in the list? Add it in three fields',
    backToBrewing: 'Back to brewing',

    photoOf: 'Photo of this brew',
    addPhotoOf: 'Add a photo of this brew',
    photoCta: 'Take or choose a photo',
    addPhotoOptional: 'Add a photo (optional)',
    photoNote: 'It never holds the log up — log the brew and the photo catches up.',
  },

  /**
   * Your own brews, listed back to you.
   *
   * The empty state is an invitation rather than an apology (§9.7): somebody
   * with no brews yet has not failed at anything, they have just arrived.
   */
  history: {
    title: 'Your brews',
    description: 'Every brew you have logged, most recent first.',
    lede: 'Every brew you have logged, newest first — what you used, and how it went.',
    loading: 'Getting your brews…',
    loadingMore: 'Getting more…',
    more: 'Show more',
    empty: 'No brews yet. The first one takes about fifteen seconds.',
    logFirst: 'Log a brew',
    unnamedCoffee: 'A coffee you added yourself',
    // Not an error: the brew is safe, it just has not reached the server yet.
    pending: 'On this device — syncs itself when you have signal.',
    loadError:
      'We could not reach your brews just now — that is on us, not on you. Anything logged on this device is still here.',
    partial:
      'Showing what is on this device. The rest will appear once we can reach the server again.',
    // The result half. `rating` is 1-5; the verdict is one of the four taste
    // buttons, translated from the same table the logger uses so the history
    // and the card can never disagree about what "bitter" is called.
    rating: 'Rated {rating}/5',
    unrated: 'Not rated.',
    delete: 'Delete',
    // Deliberately a question and not a warning dialog: this is one brew, and
    // an interstitial for a two-tap undoable action is theatre.
    deleteConfirm: 'Delete this brew?',
    deleteYes: 'Delete it',
    deleting: 'Deleting…',
    signedOutOne: 'Your brews are tied to your account.',
    signedOutLink: 'Sign in',
    signedOutTwo: ' to see them.',
  },

  ai: {
    title: 'Brew assistant',
    description:
      'Ask about your brews, your gear and the coffee in front of you — answers grounded in your own logs and the BrewCult catalogue.',
    lede: 'It reads your brew logs, your equipment and the BrewCult catalogue before it answers — and when the graph has nothing to say about your coffee, it tells you that instead of making something up.',
    footnote:
      'One suggestion at a time, on purpose: changing three things at once teaches you nothing about which one worked. Answers are a starting point — your palate settles it.',

    chatLabel: 'Brew assistant',
    emptyPrompt:
      'Ask about a coffee, a brewer, or the cup you just drank. Answers come from your brews and the BrewCult catalogue — and say so when they don’t.',
    you: 'You',
    thinking: 'Thinking…',
    placeholder: 'Ask about your brew…',
    ask: 'Ask',
    stop: 'Stop',
    openerSour: 'Why does my coffee taste sour?',
    openerSweet: 'What should I change to get more sweetness?',
    openerV60: 'Give me a starting recipe for a V60.',

    leadGood: 'Nice one. If you want to push it further:',
    // Straight apostrophe, as the component had it. Moving copy into the
    // catalogue is not the moment to restyle its punctuation.
    leadFix: "That happens — here's the usual fix.",
    confidenceLow: 'I’m guessing more than usual here — worth a try, not a rule.',
    confidenceMedium: 'Fairly confident, though your palate is the final word.',
    noData: 'No community data for this coffee yet — this is a general starting point.',
    basisBoth: 'Based on your {mine} and {theirs}.',
    // No "of this coffee" here — `brewCountMany` already carries it, and adding
    // it again reads "your 3 brews of this coffee of this coffee".
    basisMine: 'Based on your {mine}.',
    basisTheirs: 'Based on {theirs} of this coffee.',
    brewCountOne: '1 brew of this coffee',
    brewCountMany: '{count} brews of this coffee',
    communityCountOne: '1 community brew',
    communityCountMany: '{count} community brews',

    basedOn: 'Based on',
    workingOut: 'Working out a starting point…',
    getStarting: 'Get a starting recipe for my setup',
    lookingAt: 'Looking at the roaster’s notes and community brews…',

    /**
     * The starting-recipe card on a coffee page.
     *
     * `startingBodyNamed` and `startingBody` are two whole sentences rather than
     * one sentence around a `for {coffee}` fragment. The fragment version works
     * in English only by accident of word order — Spanish wants "para {coffee}"
     * in a different place, and a translator handed "for X" as a unit cannot
     * move it. Two sentences cost one duplicated clause and buy a translation
     * that reads like a sentence.
     */
    startingTitle: 'Not sure where to start?',
    startingBodyNamed:
      'A starting point for {coffee} on your gear — the roaster’s recipe if there is one, what the community brews if there isn’t, and an honest note about which.',
    startingBody:
      'A starting point for this coffee on your gear — the roaster’s recipe if there is one, what the community brews if there isn’t, and an honest note about which.',
    startingUnavailable:
      'The recipe assistant isn’t available right now — the recipes below are a good place to start instead.',
    logWithThis: 'Log a brew with this',
    retry: 'Try again',
  },

  media: {
    uploading: 'Uploading your photo…',
    photoAdded: 'Photo added.',
    photoQueued: 'Saved on this device — it uploads when you have signal.',
    chooseDifferent: 'Choose a different photo',
    addPhoto: 'Add a photo',
    takeOrPick: 'Take one, or pick a file. Up to {limit}.',
    dropOrPick: 'Drop one here or pick a file. Up to {limit}.',
    tryAnother: 'Try another photo',
    replacePhoto: 'Replace photo',
    removePhoto: 'Remove photo',
    privacyNote: 'Location data is stripped from photos when they upload.',
    notAnImage: 'That file is not an image. JPEG, PNG, WebP or HEIC all work.',
    tooBigExact:
      'That photo is {size} — anything under {limit} works. A smaller export or a screenshot will do it.',
    emptyFile: 'That file came through empty. Try picking it again.',
    tooBig: 'That photo is over the {limit} limit. A smaller export will go through.',
    wrongType: 'That file type is not supported. JPEG, PNG, WebP or HEIC all work.',
    unreadable: 'We couldn’t read that image. Try a different file, or re-export it as JPEG.',
    outOfRoom: 'Your photo storage is full. Removing an old photo makes room for this one.',
    notSwitchedOn: 'Photos are not switched on yet. Everything else saved normally.',
    offline: 'You’re offline, so the photo is waiting on this device. It uploads when you have signal.',
    uploadFailed: 'That upload did not go through. Try again in a moment.',

    avatarLabel: 'Profile photo',
    avatarHint: 'A face, a cup, a bag — whatever you want people to see next to your name.',
    avatarCta: 'Add a profile photo',
    avatarSet: 'That is your profile photo now.',
    avatarRemoved: 'Photo removed. Your initials are back.',
    avatarNotSwitchedOn:
      'Profile photos are not switched on yet. Nothing else on this page is affected.',
    /** Alt text for an avatar shown away from the name it belongs to. */
    avatarAltNamed: "{name}'s profile photo",
    avatarAlt: 'Profile photo',
    avatarNoPhoto: 'No photo yet',
  },

  coffeePage: {
    eyebrow: 'Coffee',
    notFound: 'Coffee',
    loadErrorTitle: 'We could not load this coffee',
    loadErrorBody: 'That is on us, not on you. Try again in a moment, or',
    browseRest: 'browse the rest of the catalogue',
    roastedBy: 'Roasted by',
    breadcrumbHome: 'Home',
    breadcrumbCoffee: 'Coffee',

    // The lede is assembled from whatever this particular coffee actually has,
    // so no two pages open with the same sentence.
    ledeFrom: 'A {process}coffee from {origin},',
    ledePlain: 'A coffee',
    ledeRoaster: 'roasted by {roaster}.',
    ledeNotes: 'The roaster tastes {notes} in it.',
    anIndependentRoaster: 'an independent roaster',

    tastingNotes: 'Tasting notes',
    tastingNotesCaveat:
      'These are the roaster’s words for what they found. If you taste something else, you are not wrong — notes are a map, not a test.',

    provenance: 'Where it comes from',
    origin: 'Origin',
    farm: 'Farm or station',
    process: 'Process',
    processDetail: 'Process detail',
    varietals: 'Varietals',
    altitude: 'Altitude',
    masl: '{value} masl',
    harvest: 'Harvest',
    roastLevel: 'Roast level',
    bestFor: 'Best for',
    noLot:
      'We do not have lot-level provenance for this coffee yet — farm, varietal and altitude are still missing. That is a gap in our data, not a gap in the coffee.',

    whatItMeans: 'What that actually means in the cup',
    processHeading: '{process} process',
    roastHeading: '{roast} roast',
    brewedAs: 'Brewed as {use}',

    recipesHeading: 'Recipes for this coffee',
    recipesSubject: 'this coffee',
    gearHeading: 'Gear people brew it on',
    moreFrom: 'More from {roaster}',
    seeEverything: 'See everything from {roaster} →',
    keepLooking: 'Keep looking',
    moreFromOrigin: 'More coffees from {country}',
    moreProcess: 'More {process} coffees',
    browseWhole: 'Browse the whole catalogue',
  },

  profile: {
    title: 'Your profile',
    description: 'Your BrewCult account, equipment and data controls.',
    emailUnconfirmed: 'email not confirmed yet',
    verifyTitle: 'One small thing.',
    verifyBody:
      'Confirm your email address so we can send reset links and order updates. The link is in your inbox —',
    verifyLink: 'details here',
    photoHeading: 'Your photo',
    emailHeading: 'Email',
    emailBody:
      'We send a weekly recap of your own brews and a note when someone builds on one of your recipes. Both are one click to switch off, and we never send marketing.',
    emailSettings: 'Email settings',
    securityHeading: 'Signing in safely',
    securityBody:
      'Two-factor authentication means a sign-in needs your password and a code from a device you are holding. It takes about a minute to set up, and you can turn it off again whenever you like.',
    twoFactorLink: 'Two-factor authentication →',
    equipmentHeading: 'Your equipment',
    equipmentBody:
      'Whatever you own is the right starting point. Telling us about it lets suggestions talk in your grinder’s numbers instead of somebody else’s.',
    seeBrews: 'See your brews',
    coffeeHeading: 'Your coffee',
    coffeeBody: 'Bags you are drinking. Photograph one and the label fills the rest in.',
    personalisationHeading: 'Personalisation, in plain words',
    personalisationOne:
      'Every brew you log — coffee, grind, ratio, how it tasted — builds a taste profile that belongs to you. We use it for three things: suggesting coffees you are likely to enjoy, suggesting dial-in tweaks, and ordering what you see first. That is the whole list. We do not sell it, and it does not feed anybody’s advertising.',
    personalisationTwo:
      'You can switch personalisation off. Suggestions get more generic; nothing else changes, and no feature locks. The off switch ships with the taste profile itself — this page will hold it, and it will be a toggle, not a form.',
    personalisationThree:
      'Product email you always get (order status, password resets). Marketing email is opt-in only, and the weekly briefing is one click to stop. Read the full',
    privacyLink: 'privacy policy',
    personalisationThreeEnd: 'for the retention detail.',
    dataHeading: 'Your data is yours',
    dataBody:
      'Export gives you everything in a machine-readable file — brews, recipes, posts and taste profile. Deletion means deletion. Both are self-serve, because data you can walk away with is data worth investing in.',
  },

  account: {
    somethingWrong: 'Something went wrong on our side. Try again in a moment.',
    exportStarted:
      'We are packing up your data. You will get an email with a download link — it includes your brews, recipes, posts and taste profile.',
    exportSoon:
      'Export is nearly ready — the button will start working without you doing anything. Your data is not going anywhere in the meantime.',
    deletionScheduled:
      'Your account is scheduled for deletion. Public recipes other people have forked stay up with your name removed; everything personal is erased within 30 days.',
    deletionSoon:
      'Self-serve deletion is nearly ready. Until then, email us and a human will do it — no retention-offer runaround.',
    preparing: 'Preparing…',
    exportMine: 'Export my data',
    deleteMine: 'Delete my account',
    confirmLabel: 'Confirm account deletion',
    confirmBody:
      'This erases your account, brews, recipes and taste profile. Public recipes that other people have forked stay up with your name removed, so their work does not break. Order records are kept only as long as tax law requires. It cannot be undone.',
    deleting: 'Deleting…',
    yesDelete: 'Yes, delete it',
    keepMine: 'Keep my account',
  },

  notifications: {
    title: 'Email settings',
    description: 'Choose which BrewCult emails you receive.',
    back: '← Back to your profile',
    lede: 'Everything here is off by one click, and stays off. We do not send marketing.',
    loadFailed: 'We could not load your settings. Reload to try again.',
    saveFailed: 'That did not save. Try again in a moment.',
    loading: 'Loading your settings…',
    securityAlways:
      'Security emails — sign-in codes, password changes, two-factor changes — are always sent, and are not affected by these settings.',
    weeklyLabel: 'Weekly brew recap',
    weeklyBody:
      'A short summary of what you brewed, once a week. Your own data, nobody else’s. A week with no brews sends nothing at all.',
    forkedLabel: 'Someone builds on your recipe',
    forkedBody:
      'When another person forks a recipe you published, so you can see where it went.',
  },

  security: {
    title: 'Two-factor authentication',
    description: 'Add a second step to your BrewCult sign-in.',
    back: '← Your profile',
    heading: 'Signing in safely',
    lede: 'Two-factor authentication means a sign-in needs two things: your password, and a code that changes every thirty seconds on a device you are holding. It is the single most effective thing you can do for your account, and you can turn it off again whenever you want.',
    honestHeading: 'The honest version',
    honestOne:
      'Two-factor is not about us not trusting you. Passwords get reused, and the leak is usually somewhere else entirely — a forum from 2014, a shop that stored them badly. A second factor means that leak stops being your problem.',
    honestTwo:
      'If you hold a staff role, we require it, and the reason is narrow: everything done in the operator console is written to an append-only log with a name against it. That record is only meaningful if the person named is the only one who could have done it.',
    honestThree:
      'We never see your codes and we cannot generate them. If you lose your phone, the recovery codes are the way back in — which is why the setup makes such a fuss about saving them.',

    /** Role names, shown next to a handle and in the staff notice. */
    roles: {
      user: 'Member',
      moderator: 'Moderator',
      editor: 'Editor',
      seller_owner: 'Seller owner',
      admin: 'Admin',
    },

    mfa: {
      panelHeading: 'Two-factor authentication',
      on: 'On',
      off: 'Off',
      sessionDidNotUseIt: 'This sign-in did not use it',
      freshSignInHeading: 'One more step to use staff areas',
      freshSignInOne:
        'Two-factor is on your account, but the sign-in you are currently using happened without it — so this session still counts as password-only. That is why the operator console turns you away even though everything looks switched on.',
      freshSignInTwo:
        'Signing out and back in, with a code from your app, fixes it. Nothing about your account changes and you will not need to set anything up again.',
      signingOut: 'Signing out…',
      signOutAndBack: 'Sign out and sign back in',
      goToSignIn: 'Go to sign-in',
      verifiedNote:
        'Sign-ins ask for a code from your authenticator app. This session used one, so staff areas are open to you.',
      offPitch:
        'Right now your password is the only thing between someone and your account. Two-factor adds a second, short-lived code from an app on your phone, so a leaked or reused password is not enough on its own. It takes about two minutes to set up.',
      staffAlertTitle: 'You hold the {role} role.',
      staffAlertBody:
        'Staff areas need it. Suspending an account, changing a role or resolving a report is written to an append-only audit log with your name on it, and that signature is only worth something if nobody else can produce it. The operator console will not open until this is on and you have signed in with it.',
      gettingReady: 'Getting things ready…',
      turnOn: 'Turn on two-factor',
      backToProfile: 'Back to your profile',
      noticeOn: 'Two-factor is on for your account.',
      noticeCodesReplaced: 'Your recovery codes have been replaced.',
      noticeOff:
        'Two-factor is off. Your account is back to password-only, and any recovery codes you had no longer work.',
    },

    enrol: {
      heading: 'Pair your authenticator app',
      intro:
        'Any authenticator works — 1Password, Bitwarden, Authy, Google Authenticator, your phone’s built-in one. Scan the code, or type the key in by hand if that is easier.',
      qrLabel:
        'Setup QR code for BrewCult two-factor authentication. If you cannot scan it, use the setup key shown next to it.',
      meta: '{digits}-digit codes, refreshing every {seconds} seconds.',
      cantScanHeading: 'Can’t scan it?',
      cantScanBody:
        'Choose “enter a setup key” in your app and type this. The spaces are there to make it readable — apps ignore them.',
      copyKey: 'Copy setup key',
      codeLabel: 'Six-digit code from your app',
      codeHint:
        'This proves the pairing worked. If it says the code is not valid, wait for the next one and try again — nothing is lost.',
      checking: 'Checking…',
      submit: 'Turn on two-factor',
      cancel: 'Not right now',
    },

    manage: {
      regenHeading: 'New recovery codes',
      regenBody:
        'Makes a fresh set of ten and retires the old ones. Worth doing if you have used a few, or if you are not sure where the last set ended up.',
      codeLabel: 'Code from your app',
      generating: 'Generating…',
      generate: 'Generate new codes',
      disableHeading: 'Turn two-factor off',
      disableBody:
        'Your account goes back to password-only. You can turn it on again whenever you like.',
      disableStart: 'Turn off two-factor',
      consequenceStaff:
        'You will lose access to staff areas. The operator console checks for an MFA-backed session before it opens, so /admin will stop working for you until you turn two-factor back on and sign in again.',
      consequenceMember:
        'Your recovery codes stop working too, and a stolen password would be enough to get into your account on its own. If you ever take a staff role, you will need two-factor back before the operator console will open.',
      passwordLabel: 'Your password',
      disableCodeLabel: 'Current code from your app',
      disableCodeHint:
        'Both are needed, so that someone who only has your password — or only has your open laptop — cannot switch this off.',
      turningOff: 'Turning off…',
      confirmOff: 'Yes, turn it off',
      keepOn: 'Keep two-factor on',
    },

    codes: {
      headingEnrolled: 'Two-factor is on. Save these recovery codes.',
      headingRegenerated: 'Here is your new set of recovery codes.',
      warnTitle: 'You will not see these again.',
      warnBody:
        'We store them scrambled, so we genuinely cannot show them to you a second time. If you lose both your authenticator app and these codes, getting back in means proving who you are to a human, and that takes days.',
      regeneratedNote:
        'Your old codes stopped working the moment these were made. If you had them written down somewhere, replace them now.',
      listLabel: 'Your recovery codes',
      keepNote:
        'Each one works once, in place of a code from your app. Keep them somewhere that is not the phone your authenticator lives on — a password manager, or paper in a drawer.',
      copyAll: 'Copy all codes',
      download: 'Download as a text file',
      downloadBlocked:
        'Your browser blocked the download. Copy the codes above instead, or write them down — they are on screen and this is the only time we can show them.',
      ack: 'I’ve saved my recovery codes somewhere safe.',
      done: 'Done',
      /** The downloaded .txt — read outside the app, so it carries its own copy. */
      fileTitle: 'BrewCult recovery codes',
      fileAccount: 'Account: @{handle}',
      fileOnce: 'Each code works once, in place of your authenticator app.',
      fileWhere: 'Keep them somewhere that is not the device with your authenticator on it.',
      fileReplace: 'Generating a new set replaces every code below.',
    },

    copy: {
      copied: 'Copied',
      copiedAnnounce: '{label} to your clipboard.',
      failed:
        'Your browser would not let us reach the clipboard — select the text above and copy it by hand.',
    },
  },

  kit: {
    loadFailed: 'We could not load your equipment. Reload to try again.',
    saveFailed: 'That did not save. Try again in a moment.',
    loading: 'Loading your equipment…',
    empty:
      'Nothing here yet. Add the grinder and brewer you use most — that is enough for suggestions to talk in your numbers.',
    badgeDefault: 'Default',
    badgeYours: 'Yours',
    scaleSuffix: '{scale} scale',
    makeDefault: 'Make default',
    addLabel: 'Add equipment',
    searchPlaceholder: 'Search grinders, brewers, kettles, scales…',
    hintType: 'Type a brand or model — “niche”, “v60”, “stagg”.',
    hintSearching: 'Searching…',
    hintNothing:
      'Nothing matched. If your gear is missing we will add it — the catalogue is still growing.',
    hintMatchOne: '1 match',
    hintMatchMany: '{count} matches',
    addAsOwn: 'Add “{query}” as your own',
    customNote:
      'This stays on your account only — it will not appear in search or on any public page. You can still log brews with it straight away.',
    brand: 'Brand',
    model: 'Model',
    type: 'Type',
    addToMine: 'Add to my equipment',
    added: 'Added',
    add: 'Add',
  },

  suggestKit: {
    noClipboardImage: 'There is no image on the clipboard — copy one first, or choose a file.',
    clipboardBlocked:
      'The browser would not let us read the clipboard. Press Ctrl+V (or ⌘V) instead.',
    sendFailed: 'That did not send. Try again in a moment.',
    publishedTitle: '{label} is in the catalogue.',
    queuedTitle: 'Thanks — that is with us.',
    publishedBody: 'It has been added to your equipment too, so you can use it straight away.',
    queuedBody:
      'The assistant was not sure enough to add it, so a person will look. Anything you already recorded yourself keeps working in the meantime.',
    prompt: 'Think it belongs in the shared catalogue?',
    suggestIt: 'Suggest it',
    awaitingOne: ' — you have 1 awaiting review.',
    awaitingMany: ' — you have {count} awaiting review.',
    intro:
      'Describe it, or paste the manufacturer’s description. If the assistant recognises the product it is added to the catalogue and to your equipment right away. Anything it is unsure about waits for a person instead of guessing.',
    whatIsIt: 'What is it?',
    descriptionPlaceholder:
      'e.g. Option-O Lagom P100 — 64mm flat burr single-dose grinder, stepless…',
    photo: 'Photo',
    photoAlt: 'The photo you attached',
    paste: 'Paste from clipboard',
    pasteHintCan: 'Or press Ctrl+V (⌘V) anywhere in this box.',
    pasteHintCannot: 'Copy a screenshot, then press Ctrl+V (⌘V) anywhere in this box.',
    sending: 'Sending…',
    send: 'Send suggestion',
    historyOne: 'Your suggestions (1)',
    historyMany: 'Your suggestions ({count})',
    statusPending: 'waiting',
    statusApproved: 'added',
    statusRejected: 'not added',
  },

  search: {
    label: 'Search coffees, roasters and gear',
    placeholder: 'Yirgacheffe, Kalita, a roaster you like…',
    suggestions: 'Search suggestions',
    noMatches: 'No matches yet — try fewer letters.',
    matchOne: '1 match. Use the arrow keys to browse.',
    matchMany: '{count} matches. Use the arrow keys to browse.',
    hiccup: 'Search is having a moment. Browsing below still works.',
  },

  discover: {
    title: 'Discover coffee',
    metaDescription:
      'Browse specialty coffees by origin, process and roast level — with the tasting notes and the roasters behind them.',
    ogTitle: 'Discover coffee · BrewCult',
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
    clipboardEmpty: 'There is no image on the clipboard — copy one first, or choose a file.',
    clipboardBlocked:
      'The browser would not let us read the clipboard. Press Ctrl+V (or ⌘V) instead.',
    /** Stands in for the coffee's name when the label was too unclear to read one. */
    thatCoffee: 'That coffee',
    /** Only used when the assistant rejected a submission without saying why. */
    notABag: 'That did not look like a bag of coffee.',
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

  /**
   * The catalogue surfaces: the four hubs, their detail pages, and the
   * components they share.
   *
   * The DATA on these pages is never in here (see `lib/i18n.ts`) — a roaster is
   * called what it is called, tasting notes are the roaster's own words. Only
   * the frame around them is translated. The domain vocabulary (process, roast
   * level, grind category…) lives in `components/catalog/copy.ts`, which was
   * already bilingual; this namespace is the page copy that sits around it.
   */
  catalog: {
    breadcrumbLabel: 'Breadcrumb',
    results: 'Results',
    keepLooking: 'Keep looking',

    crumbs: {
      home: 'Home',
      coffee: 'Coffee',
      roasters: 'Roasters',
      equipment: 'Equipment',
      recipes: 'Recipes',
    },

    elsewhere: {
      heading: 'Elsewhere in the catalogue',
      coffees: 'Coffees',
      roasters: 'Roasters',
      equipment: 'Brewers and grinders',
      recipes: 'Brewing recipes',
    },

    filters: {
      apply: 'Apply filters',
      clear: 'Clear',
      coffeeLegend: 'Filter coffees',
      equipmentLegend: 'Filter equipment',
      recipeLegend: 'Filter recipes',
      origin: 'Origin',
      anyOrigin: 'Anywhere',
      process: 'Process',
      anyProcess: 'Any process',
      roastLevel: 'Roast level',
      anyRoast: 'Any roast',
      brewedAs: 'Brewed as',
      anyUse: 'Either',
      category: 'Category',
      anyCategory: 'Everything',
      brand: 'Brand',
      anyBrand: 'Any brand',
      method: 'Method',
      anyMethod: 'Any method',
    },

    pagination: {
      label: 'Pagination',
      back: '← Back to the start',
      next: 'Next page →',
      countOne: '1 result on this page',
      countOther: '{count} results on this page',
    },

    cards: {
      tastesLike: 'Tastes like: {notes}',
      discontinued: 'No longer roasted — kept for the recipes attached to it.',
      coffeeCountOne: '1 coffee in the catalogue',
      coffeeCountOther: '{count} coffees in the catalogue',
      adjustment: '{scale} adjustment',
      onThe: 'On the ',
      byRoaster: 'Published by the roaster',
      byAuthor: 'By {author}',
      communityMember: 'a community member',
    },

    coffeeHub: {
      /**
       * The faceted title, assembled from the active filters.
       *
       * `qualifierOrder` exists because English stacks adjectives before the
       * noun ("light washed coffee") and Spanish puts them after it, in the
       * other order ("café lavado claro"). Naming the order here keeps that a
       * translator's decision rather than a hardcoded `locale === 'es'`.
       */
      noun: 'coffee',
      qualifiedNoun: '{qualifiers} coffee',
      qualifierOrder: 'roast process',
      fromOrigin: ' from {origin}',
      forUse: ' for {use}',
      metaDescription:
        'Browse {noun} — origin, farm, process, varietal, altitude and roast level for every bag, with the roaster behind it and community brewing recipes.',
      lede: 'Every coffee here carries where it grew, how it was processed and how far it was roasted — in plain language, because none of that is obvious and pretending otherwise helps nobody.',
      loadError:
        'We could not load the catalogue just now — that is on us, not on you. Refresh in a moment.',
      emptyBody:
        'Nothing matches those filters yet. The catalogue is still growing, so an empty result usually means “not indexed yet” rather than “does not exist”.',
      emptyClear: 'Clear the filters',
      emptyOr: ' or ',
      emptyRoaster: 'start from a roaster',
    },

    roasterHub: {
      title: 'Coffee roasters',
      metaDescription:
        'Specialty coffee roasters and the coffees they roast — origins, processes, tasting notes and the community recipes for brewing them.',
      lede: 'The people who decide how a green coffee tastes by the time it reaches you. Every profile lists their coffees with full provenance — and the brews the community has logged on them.',
      sectionHeading: 'Roasters',
      loadError:
        'We could not load the roaster list just now — that is on us, not on you. Try again in a moment.',
      emptyBody:
        'No roasters listed yet. We are still filling the shelves — and we would rather show you an empty page honestly than pad it out.',
      emptyLink: 'Browse coffees instead',
    },

    roasterDetail: {
      eyebrow: 'Roaster',
      loadErrorTitle: 'We could not load this roaster',
      loadErrorBody: 'That is on us, not on you. Try again shortly, or ',
      loadErrorLink: 'browse the other roasters',
      ledeOne:
        '{name} has one coffee in the BrewCult catalogue{where}. It carries its origin, process and roast level, plus whatever the community has worked out about brewing it.',
      ledeOther:
        '{name} has {count} coffees in the BrewCult catalogue{where}. Each one carries its origin, process and roast level, plus whatever the community has worked out about brewing it.',
      ledeWhere: ', roasted in {location}',
      profile: 'Profile',
      location: 'Location',
      coffeesListed: 'Coffees listed',
      originsBought: 'Origins they buy from',
      verified: 'Verified',
      verifiedYes: 'Claimed and verified by the roaster',
      verifiedNo: 'Not claimed yet — this profile is maintained editorially',
      website: 'Website',
      theirCoffees: 'Their coffees',
      noCoffees:
        'No coffees listed for {name} yet. If you have a bag from them, the catalogue is exactly where it belongs.',
      retiredHeading: 'No longer roasted',
      retiredBody:
        'Lots rotate with the harvest. These pages stay up because the recipes and notes attached to them are still useful — and because a similar lot often comes back.',
      originsHeading: 'Origins they work with',
      allCountryCoffees: 'All {country} coffees',
      filterToRoaster: 'Filter the catalogue to {name}',
      allRoasters: 'All roasters',
    },

    equipmentHub: {
      noun: 'coffee equipment',
      fromBrand: ' from {brand}',
      metaDescription:
        'Specifications, brewing recipes and community grind data for {noun}. Every grinder page carries crowd-sourced setting conversions with the confidence and sample size shown.',
      title: 'Brewers, grinders and gear',
      brandTitle: 'Equipment from {brand}',
      lede: 'Gear pages exist to answer one question honestly: what does this thing actually change in the cup? No brand rankings, no “you need to upgrade” — specs, recipes and what the community has measured.',
      loadError:
        'We could not load the equipment list just now — that is on us, not on you. Try again shortly.',
      emptyBody:
        'Nothing matches those filters yet. If your grinder or brewer is missing, that is a gap in our catalogue — not a sign it is the wrong gear.',
      emptyClear: 'Clear the filters',
      byCategory: 'Browse by category',
      byCategoryNote:
        'Grinder pages carry community grind-setting conversions — the closest thing there is to a straight answer to “what number do I use on mine?”, with the uncertainty stated rather than hidden.',
    },

    equipmentDetail: {
      loadErrorTitle: 'We could not load this equipment',
      loadErrorBody: 'That is on us, not on you. Try again in a moment, or ',
      loadErrorLink: 'browse the rest of the gear',
      madeBy: 'Made by ',
      specifications: 'Specifications',
      category: 'Category',
      brand: 'Brand',
      grindAdjustment: 'Grind adjustment',
      yes: 'Yes',
      no: 'No',
      noSpecs:
        'We do not have detailed specs for this model yet. The recipes and grind data below are unaffected — they come from people using it, not from a spec sheet.',
      recipesHeading: 'Recipes for the {name}',
      recipesSubject: 'the {name}',
      allOfCategory: 'All {category}',
      moreFromBrand: 'More from {brand}',
      coffeeToBrew: 'Coffee to brew on it',
      allRecipes: 'All brewing recipes',
    },

    recipeHub: {
      title: 'Brewing recipes',
      metaTitleMethod: '{method} brewing recipes',
      metaDescription:
        'Community and roaster brewing recipes with dose, water, ratio, temperature, grind and full pour schedules — each one a starting point to dial in from, not a rule.',
      headingMethod: '{method} recipes',
      headingForCoffee: 'for {coffee}',
      headingOnBrewer: 'on the {brewer}',
      sectionHeading: 'Recipes',
      lede: 'Every recipe here carries its dose, water, ratio, temperature and grind — and a coarse grind category, because a dial number from someone else’s grinder does not transfer to yours. Take one as a starting point and change one thing at a time.',
      unknownCoffee:
        'We could not find a coffee with the slug “{slug}”, so that filter was ignored.',
      unknownBrewer:
        'We could not find equipment with the slug “{slug}”, so that filter was ignored.',
      notReadyBody:
        'Recipes are not switched on yet — the brewing API is being built right now. When it lands, this page fills up with community and roaster recipes, each one linked to the coffee and the gear it was written on.',
      notReadyMeanwhile: 'In the meantime, ',
      notReadyCatalogue: 'the coffee catalogue',
      notReadyAnd: ' and ',
      notReadyEquipment: 'the equipment pages',
      notReadyTail: ' are live — including community grind conversions for grinders.',
      loadError:
        'We could not load recipes just now — that is on us, not on you. Try again in a moment.',
      emptyBody:
        'No recipes match that yet. Empty is a real answer here — we would rather show you nothing than pad the page with recipes for a different coffee.',
      emptyClear: 'Clear the filters',
      emptyStart: 'Start from a coffee instead',
      howToReadHeading: 'How to read a recipe here',
      howToReadRatio: 'Ratio',
      howToReadRatioBody:
        ' is the part that travels — 1:16 means one gram of coffee to sixteen of water, whatever size you brew. ',
      howToReadGrind: 'Grind category',
      howToReadGrindBody:
        ' (fine, medium-fine, medium…) is the only grind information that survives a change of grinder; a dial number is always shown attached to the grinder it came from.',
      howToReadNote:
        'Nobody’s first attempt at someone else’s recipe tastes the same as theirs. That is water, beans and burrs, not you.',
    },

    recipeDetail: {
      notReadyTitle: 'Recipes are not switched on yet',
      notReadyBody:
        'Recipe pages are being built right now. If someone shared this link with you, it will start working shortly — the link itself is fine.',
      loadErrorTitle: 'We could not load this recipe',
      loadErrorBody: 'That is on us, not on you. Try again in a moment.',
      allRecipes: 'All recipes',
      browseCoffees: 'Browse coffees',
      browseEquipment: 'Browse equipment',
      eyebrow: '{method} recipe',
      byRoaster: 'Published by the roaster',
      byAuthor: 'By {author}',
      byCommunity: 'By a community member',
      forCoffee: ' · for ',
      onBrewer: ' · on the ',
      startingPoint: 'This is a starting point, not a rule.',
      numbersHeading: 'The numbers',
      ratioNote:
        'The ratio is the part worth keeping when you scale up or down — the absolute numbers matter less than their relationship.',
      grindHeading: 'Grind',
      grindConversionsLink: 'See grind conversions for the {name} →',
      poursHeading: 'Pour schedule',
      poursNote:
        'Times are from the moment water first hits the coffee. Weights are cumulative — the number on the scale, not the amount for that pour.',
      puckPrepHeading: 'Puck preparation',
      tastesOffHeading: 'If it does not taste right',
      tastesOffBody:
        'Change one thing at a time — that is the whole technique. If it is sour, thin or weak, the coffee is probably under-extracted: grind finer, or use hotter water, or give it longer. If it is bitter, harsh or drying, it is probably over-extracted: grind coarser, or cool the water slightly, or cut the brew short.',
      tastesOffNote:
        'A cup that misses on the first go is the normal outcome, not a verdict on your gear or on you.',
      aboutCoffee: 'About {name}',
      moreBrewerRecipes: 'More {name} recipes',
      moreMethodRecipes: 'More {method} recipes',
    },

    /**
     * schema.org strings for the recipe page's JSON-LD.
     *
     * Translated for the same reason the visible copy is: a Spanish page whose
     * structured data is in English is telling a search engine something the
     * page does not say.
     */
    recipeJsonLd: {
      coffeeGrams: '{grams} g coffee',
      waterGrams: '{grams} g water',
      waterAt: 'Water at {temp} °C',
      filterType: '{type} filter',
      espressoOut: '{grams} g espresso out',
      brewTemperature: 'Brew temperature {temp} °C',
      groundAs: 'Ground {category}',
      bloom: 'Bloom',
      pourN: 'Pour {n}',
      pourStep: 'At {at}, pour up to {to} g total.',
      pullShot: 'Pull the shot',
      pullShotStep: 'Dose {dose} g, target {yield} g out.',
      pullShotStepTimed: 'Dose {dose} g, target {yield} g out in about {seconds} seconds.',
      brew: 'Brew',
      brewStep: 'Brew {dose} g of coffee with {water} g of water.',
      brewStepTimed:
        'Brew {dose} g of coffee with {water} g of water, aiming for a total time of about {time}.',
      yieldEspresso: '{grams} g espresso',
      yieldFilter: '{grams} g brewed coffee',
    },

    freshness: {
      heading: 'Roast date and freshness',
      batchesIntro: 'Roast batches we know about for this coffee:',
      today: 'Today',
      dayOne: '1 day',
      dayOther: '{count} days',
      ageNote: 'Day counts are from today, so they move as the page ages — that is the point.',
      future: 'Roasted in the future, apparently — that is a data problem, not a coffee one.',
      veryFreshEspresso:
        'Very fresh and still degassing. Espresso from this will likely gush and taste sharp — give it a week.',
      veryFreshFilter:
        'Very fresh and still degassing. Expect a big bloom and a slower drawdown; it often gets easier around day 5.',
      restingEspresso:
        'Approaching its window for espresso — the last few days of rest usually settle the shot down.',
      inWindow: 'In the window most people find best for filter brewing.',
      pastPeak:
        'Past its brightest, but far from bad — expect sweeter, rounder, less aromatic. Try a slightly finer grind or hotter water.',
      wellPast:
        'Well past its peak. Still drinkable, and honestly still better than most coffee — just do not judge the lot by this bag.',
    },

    grindConversion: {
      heading: 'Grind settings on other grinders',
      intro:
        'A number on a grinder dial only means something on that grinder — even two units of the same model differ. So instead of pretending “18” travels, BrewCult records what people actually landed on after switching, and shows you the spread.',
      caption:
        'Community-recorded settings equivalent to a setting on the {name}. Every row is an approximate starting point.',
      colOn: 'On the {name}',
      colGrinder: 'Grinder',
      colApprox: 'Approximate start',
      colTrust: 'How much to trust it',
      thenAdjust: 'then adjust by taste',
      bandLow: 'Low confidence',
      bandMedium: 'Medium confidence',
      bandHigh: 'High confidence',
      bandWithPercent: '{band} ({percent})',
      unknownPercent: 'unknown',
      samplesOne: '1 community data point',
      samplesOther: '{count} community data points',
      sourceUnknown: 'Source not recorded.',
      unavailable: 'We could not load conversions just now — that is on us, not on you.',
      noneYet: 'Nobody has recorded a confirmed conversion from the {name} yet.',
      zeroPoints: '0 community data points',
      zeroPointsMid: ', so confidence is ',
      zeroPointsNone: 'none yet',
      zeroPointsTail:
        '. When you fork a recipe onto a different grinder and log a brew you liked, that pair gets recorded here — that is where every number on this page comes from.',
      useCategory:
        'In the meantime, use the coarse category on the recipe (fine, medium-fine, medium and so on). It is the one part of a grind setting that survives a change of grinder.',
      whyApproximate: 'Why these are approximate:',
    },

    recipesSection: {
      startingPoints:
        'Community recipes are starting points, not verdicts. Brew one as written, then change one thing.',
      browseAll: 'Browse all recipes for {subject} →',
      loadError:
        'We could not load recipes just now — that is on us, not on you. Everything else on this page is still accurate.',
      notReady:
        'Recipes are not switched on yet. They are coming, and when they are you will find the community’s brews for {subject} right here.',
      empty:
        'No recipes for {subject} yet — which means whoever writes the first one gets to set the tone. If you have brewed it, even a rough starting point helps the next person more than you would think.',
    },

    recipeBody: {
      noNumbers:
        'This recipe has not recorded its numbers yet. The method and grind below are still useful — treat the rest as your call.',
      doseIn: 'Dose in',
      yieldOut: 'Yield out',
      ratio: 'Ratio',
      ratioEspressoNote: 'dose to yield',
      ratioFilterNote: 'coffee to water',
      shotTime: 'Shot time',
      temperature: 'Temperature',
      preInfusion: 'Pre-infusion',
      basket: 'Basket',
      coffee: 'Coffee',
      water: 'Water',
      totalTime: 'Total time',
      grind: 'Grind',
      notRecorded: 'Not recorded',
      dialSetting: 'Dial setting',
      onGrinder: 'on the {name}',
      onAuthorsGrinder: 'on the author’s grinder',
      dialAppliesTo: 'That dial number only applies to ',
      authorsGrinder: 'the author’s grinder',
      dialAdviceBefore: '. On yours, start from the ',
      dialAdviceAfter:
        ' category and adjust by taste — grind is the one setting worth changing first.',
      noDial:
        'No dial number was recorded, which is fine: the category is the part that transfers between grinders anyway.',
      upTo: 'up to {grams} g',
      bloomNote: 'Bloom — wet the bed evenly and wait.',
      puckPrepLabel: 'Puck preparation',
      forkedFrom: 'Forked from ',
      forkedBy: ' by {author}',
      changeOne: ' — 1 change: {fields}.',
      changeOther: ' — {count} changes: {fields}.',
      grindSummary: '{category} grind',
    },
  },

  footer: {
    tagline: 'BrewCult — every great brewer started with bitter coffee.',
    privacy: 'Privacy',
    terms: 'Terms',
    discover: 'Discover',
  },

  notFoundPage: {
    metaTitle: 'Not found',
    title: 'That page is not here',
    lede: 'Wrong link, or something we moved. Either way, not your fault.',
    discover: 'Discover coffee',
    home: 'Back home',
  },

  privacyPage: {
    title: 'Privacy',
    metaDescription:
      'What BrewCult collects, why, how long we keep it, and how to take it back.',
    lede: 'The short version: we collect what makes your coffee better, we tell you what it is for, and you can take all of it with you or delete it whenever you like.',
    whatHeading: 'What we collect',
    whatBody:
      'Your account details (email, handle, display name), the brews and recipes you log, the equipment you tell us about, what you post, and — if you buy something later — the order records tax law makes us keep. Analytics are first-party and aggregate.',
    whyHeading: 'Why',
    whyBody:
      'Brew logs build a taste profile, which drives coffee suggestions and dial-in advice. That is the product. Email addresses let us send order updates and password resets. Marketing email is opt-in; the weekly briefing is one click to stop.',
    howLongHeading: 'How long',
    howLongBody:
      'Account data lives as long as the account does. Deleting your account hard-deletes personal data within 30 days. Public recipes other people have forked are anonymised rather than destroyed, so their work does not break — we say so plainly at the moment you delete, not afterwards.',
    controlsHeading: 'Your controls',
    controlsBefore: 'Export and deletion are self-serve from ',
    controlsLink: 'your profile',
    controlsAfter:
      '. Personalisation has an off switch; turning it off makes suggestions blander and locks you out of nothing. Age 16+ applies to accounts.',
    whoHeading: 'Who else sees it',
    whoBody:
      'Only the processors we need to run the service — hosting, email, payments (later), and the AI provider for brewing advice, with payloads kept minimal. Each one is listed in our processor inventory with what it holds and for how long.',
    note: 'This is the plain-language summary. The full reviewed policy is published before public launch; nothing in it will contradict this page.',
  },

  termsPage: {
    title: 'Terms',
    metaDescription: 'The rules of BrewCult, in plain language.',
    lede: 'The rules, in plain language. The reviewed legal text lands before public launch; nothing there will contradict what is on this page.',
    whoHeading: 'Who can join',
    whoBody: 'You need to be 16 or older to hold a BrewCult account.',
    behaviourHeading: 'How we expect people to behave',
    behaviourBody:
      'Beginner questions are welcome, always. Gear-shaming, budget-shaming and “just buy a better grinder” answers are not what this place is for. There are no public downvotes here by design — quality rises through usefulness, saves and forks. Explaining patiently is what earns standing.',
    contentHeading: 'Your content',
    contentBody:
      'Your recipes, brews and posts stay yours. You give us permission to show them on the platform and let other members fork recipes with attribution. Delete your account and your personal data goes; public recipes others have built on stay up with your name removed, so their work does not break.',
    ourSideHeading: 'Our side of it',
    ourSideBefore: 'We keep the service running, we tell you what we do with your data (see ',
    ourSideLink: 'Privacy',
    ourSideAfter:
      '), and we do not let paid placement change what the AI recommends. Suggestions are suggestions — brewing advice is not a guarantee about a cup of coffee.',
    endingHeading: 'Ending things',
    endingBefore: 'You can delete your account any time from ',
    endingLink: 'your profile',
    endingAfter:
      '. We may suspend accounts that break the behaviour rules above, and we will say which rule and why.',
  },

  unsubscribePage: {
    metaTitle: 'Unsubscribed',
    metaDescription: 'You will not get that kind of email from BrewCult again.',
    title: 'Email settings',
    noteBefore: 'Changed your mind, or want finer control? ',
    noteLink: 'Your email settings',
    noteAfter: ' has a switch for each kind.',
    noTokenTitle: 'Nothing to change.',
    noTokenBody:
      'That link is missing its code. Open your email settings to choose which messages you get.',
    working: 'Updating your settings…',
    doneTitle: 'Done — you are unsubscribed.',
    doneBody:
      'You will not get that kind of email from us again. Security emails, like sign-in codes and password changes, still come through: those are how you find out if someone else is using your account.',
  },
} as const;
