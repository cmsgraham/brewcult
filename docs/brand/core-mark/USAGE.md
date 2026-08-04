# BrewCult core mark — usage rules

## Geometry (240-unit grid)
Sun: 48-radius disc centered (120, 86), flat-cut at y=124.
Cup: mug profile, rim (46,140)–(194,140), vertical shoulders, soft flat base at y=215.
Ear: open loop, centerline circle at (203,170) r=22, stroke 14 — part of the vessel, not a third element.
Gap: constant 16 units between sun cut and rim. Minimum render: 1px.

## Colors
Espresso #3B2A20 on Cream #F4EDE3. Reversed: cream mark on espresso. Never other colors, gradients, or shadows.

## Constructions
- `brewcult-mark.svg` — primary (loop ear). Use at 25px and above.
- `brewcult-mark-small.svg` — lug-ear construction. Use at 24px and below (favicon, notification). The swap is mandatory, not optional.
- `brewcult-mark-outline.svg` — outline variant, single 10-unit stroke.
- `brewcult-appicon.svg` / `appicon-1024.png` — full-bleed master, optically centered (+28 toward the ear). Do not paste the standalone mark into icon canvases.

## Golden rules
1. NEVER close the flat cut into a full circle. The truncated sun is the trademark; a round sun makes this a generic café logo.
2. Never close or shrink the gap below 1 rendered pixel.
3. No steam, beans, saucer, sparkles, rays, or text inside the mark. The saucer is reserved for the community badge only.
4. Ear points right by default; the mirrored mark is permitted at left edges of lockups.
5. Clear space around the mark: one sun radius (48 units) on all sides.
