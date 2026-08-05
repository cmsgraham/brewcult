# BrewCult — Brew Logger UX (BREW-02)

> Design proposal for the single most important screen in the product.
> Gates Wave 3. Companion to `second_draft.md` §6 (domain), §10 (behavioural
> design), and risk #1 ("if brew logging isn't ≤15s, nothing downstream works").

---

## 1. The bar

**Median time-to-log ≤ 15 seconds**, measured from tapping "Log a brew" to a
persisted session — instrumented, not estimated (BREW-08 emits the timing).

Why this number is existential: every downstream asset — taste model, grind
conversions, community recipes, AI dial-in, the purchase→brew loop — is fed by
logged brews. A logger that takes 45 seconds gets used for three days and
abandoned, and then BrewCult is a catalog with a chat bot attached.

**The competitive read:** Beanconqueror is free, mature, and beloved, and its
known complaint is exactly this — logging is a form. We do not win on features.
We win on the ten seconds.

---

## 2. The core insight

A brew is not a form. It is **a repeat of yesterday with one thing changed.**

Real behaviour: a P2 enthusiast buys a bag, brews it 15–25 times over three
weeks, and across those brews changes *one variable at a time* — grind, then
dose, then temperature. Dose and brewer are effectively constant. Coffee changes
every few weeks.

So the logger's job is not "collect 12 fields". It is: **show me yesterday, let
me change the one thing, and get out of my way.**

That reframing is what makes 15 seconds achievable — and it is also why the
structured data ends up *better* than a form would produce: prefilled values are
real (they were used), and the changed field is explicitly marked as the
experiment, which is exactly the signal the grind-conversion dataset (§6.4) and
the AI dial-in need.

---

## 3. The three paths

The logger has one screen and three exits, ordered by frequency.

### Path A — "Same as last time" (≈2 seconds, ~40% of logs)

A single primary button at the top of the Brew tab, showing the last session for
the active coffee:

```
┌──────────────────────────────────────────┐
│  ☕ Ethiopia Chelbesa · V60              │
│  15g → 250g · 94°C · 2:45 · Ode 6.5      │
│                                          │
│  [        Brew this again        ]  ▸ tweak│
└──────────────────────────────────────────┘
```

Tap → session written, timestamped now, with `source: repeat`. A toast offers
"rate it" (Path C's rating step) but **does not block**. The user is back to
their coffee in two seconds.

This path exists because routine days are most days, and an unrated repeat is
still valuable data (it confirms a recipe was worth repeating).

### Path B — "Tweak one thing" (≈8–12 seconds, ~45% of logs)

Tapping `▸ tweak` (or long-pressing the repeat button) opens the same card with
every value **prefilled and inline-editable**. No modal, no page change.

```
┌──────────────────────────────────────────┐
│  Ethiopia Chelbesa            [change]   │
│  V60 · Fellow Ode Gen 2       [change]   │
│                                          │
│  Grind      ◂  6.5  ▸        ← tap-hold to scrub
│  Dose       ◂  15g  ▸                    │
│  Water      ◂ 250g  ▸        (1:16.7)    │
│  Temp       ◂  94°  ▸                    │
│  Time         2:45  ⏱ start              │
│                                          │
│  How was it?                             │
│  [😖 bitter] [😝 sour] [💧 weak] [✅ good]│
│                                          │
│  [            Log brew            ]      │
└──────────────────────────────────────────┘
```

Design rules that buy the seconds:

- **Steppers, not keyboards.** Every numeric field is `◂ value ▸` with sane
  increments (grind ±0.5, dose ±0.5g, water ±5g, temp ±1°). The mobile keyboard
  is the single biggest time sink in any logger; it should appear only if the
  user taps the number itself to type directly.
- **Ratio is derived, never entered.** Changing dose recalculates water at the
  locked ratio (and vice-versa when the user edits water). A small lock toggle
  switches which one follows.
- **The changed field is remembered as the experiment.** If the user only moved
  grind, the session stores `changed: ["grind"]` — that is the one-variable
  discipline from §7.2 captured for free, and it powers "you went finer and it
  got better" insights.
- **Timer is optional and non-modal.** `⏱ start` runs a timer that keeps
  counting if the app is backgrounded; the user can also just type 2:45. Never
  force the user to have started a timer to log.
- **Taste is one tap.** The four buttons map to the extraction diagnosis in
  §6.7 (bitter → over-extracted, sour/weak → under-extracted). "Good" is a
  first-class answer, not a neutral default.

### Path C — "New coffee" (≈25–40 seconds, ~15% of logs, once per bag)

Only when the coffee changes. This is the one place we ask for more, because it
is amortised across ~20 brews and it is where catalog entities get linked.

- Coffee picker is **search-first over the catalog** with the user's recent
  coffees pinned. Entity autocomplete (CAT-06) means "chelb" finds it.
- Not in the catalog? A three-field quick-add (roaster, name, roast level) that
  creates a provisional entity — never a dead end, never a blocked log.
- **Optional bag scan**: photograph the bag → the AI label extractor (§15.2)
  fills roaster/name/process/notes for confirmation. Delightful, but strictly a
  shortcut; the manual path is always right there.
- Starting recipe: if the coffee has an official roaster recipe or community
  recipes for the user's equipment, offer them as one-tap starting points
  (this is the purchase→brew loop closing).

---

## 4. What we deliberately do NOT ask

Every field here was considered and cut from the default flow. They exist in an
expandable "more" section for the users who want them, and they are *never* on
the critical path:

| Field | Why it's not default |
|---|---|
| Water chemistry | §6.5 scoped it down; presets only, and only for users who set one |
| Pour schedule / pulses | Power-user field; the default is total water |
| Bloom time/amount | Derived from the first pour when a pour schedule exists |
| TDS / extraction yield | Refractometer users are <2%; give them the field, not the friction |
| Tasting prose | Never required (§6.7). One-tap taste first; prose is optional |
| Photo | Optional, and never blocks the log — it's a sharing affordance |
| Roast date / batch | Prefilled from the bag when known, editable in the coffee record |

**The test for any future field:** does it change what the user or the AI would
do next? If not, it does not get a slot on the default screen.

---

## 5. Offline and speed mechanics

The logger must work in a kitchen with one bar of wifi, at 6am, one-handed.

- **Optimistic local write.** The session is persisted locally and rendered as
  logged *immediately*; the network sync happens after (EF §2.2 offline queue,
  BREW-04). The user never waits on a request to see success.
- **Client-generated UUIDv7 + idempotent PUT** so a retried sync can never
  double-log (EF §2.2).
- **Prefill comes from local cache**, so the screen is interactive before any
  network response.
- **One-handed layout**: primary actions in the bottom third (thumb zone),
  steppers large enough for imprecise taps, no drag targets.
- **Interruption-proof**: the draft survives backgrounding, a phone call, and
  app restart. Coffee brewing involves putting the phone down.

---

## 6. The psychology layer (why people keep doing it)

Per §10 — the habit already exists; we attach to it and make improvement visible.

- **Immediate payback.** After logging, the card shows one honest line of
  feedback: *"3rd brew of this bag — your ratings are trending up"* or, after a
  bitter rating, *"Try 0.5 coarser tomorrow?"* with a one-tap "remind me".
  Logging must return value in the same second it costs.
- **Progress, not streaks.** Never a streak counter (§10.3 — streaks punish
  vacations and turn a pleasure into an obligation). Instead: a per-coffee
  rating trend and "you've dialed in 4 coffees" style competence markers.
- **No shaming, ever.** A bitter brew is normal, not failure. Copy stays warm:
  "That happens — here's the usual fix."
- **Share is an offer, never a step.** After logging, an unobtrusive "share this
  brew" — the community post is a *consequence* of logging, not a tax on it.

---

## 7. Instrumentation (how we know it works)

Emitted from the logger itself (BREW-08 events):

| Metric | Target | Meaning if it misses |
|---|---|---|
| Median time-to-log | ≤15s | The design failed; cut fields, not corners |
| p90 time-to-log | ≤35s | Path C is leaking into daily use |
| Path A share of logs | ≥30% by week 2 | Repeat affordance isn't discoverable |
| Logs abandoned mid-flow | <10% | Something blocks — find the field |
| Week-1 users with ≥3 logs | ≥40% (Phase 1 exit) | Activation is failing |
| Offline logs synced without conflict | ~100% | Sync design needs work |

---

## 8. Design decisions (resolved 2026-08-05, Wave 3 kickoff)

1. **Filter first; espresso schema-ready, UI second.** The beachhead persona is
   the prosumer filter brewer (§2.2), and a single logger that serves both
   shapes well is harder than two focused ones. The *data model* carries both
   from day one (`FilterParams | EspressoParams` in the shared contract), so the
   espresso card is additive UI work with no migration. Espresso lands right
   after the filter logger clears its 15s bar with real users.
2. **Active bag with a fast switcher**, not a carousel. One repeat card for the
   coffee you're brewing now; switching bags is one tap from the card header.
   Revisit if usage shows people genuinely alternate within a session.
3. **Both rating paths.** Inline one-tap taste at log time (Path B), plus one
   optional nudge a few minutes later for people who logged before tasting.
   Never two prompts for the same session.
4. **Plain timer in the logger.** Optional, non-modal, survives backgrounding.
   Brew-along mode with pour prompts is a later delight feature, not Wave 3.

## 9. Build order (feeds Wave 3 tasks)

1. Path B card (prefilled, steppers, one-tap taste) — the core; BREW-03.
2. Local-first persistence + optimistic render — BREW-04.
3. Path A repeat button — trivial once B exists, huge for the median.
4. Path C coffee picker over catalog autocomplete — BREW-03/CAT-06 seam.
5. Post-log feedback line (trend / suggestion) — the retention hook.
6. Instrumentation dashboard for §7 — must exist before beta, not after.
7. Bag scan (AI label extraction) — Wave 4, strictly optional path.
