# @brewcult/brand-tools

Reproducible export pipeline for every rasterized BrewCult brand asset. Reads the
canonical SVGs in `docs/brand/` and writes PNG/ICO/JSON outputs to `tools/brand/dist/`.
The SVGs are the single source of truth — never hand-edit anything in `dist/`.

## Run

```sh
cd tools/brand
npm install
npx tsx export.ts      # or: npm run export
```

The script exports everything, then runs a built-in verify step (existence, exact
pixel dimensions, alpha-channel expectations, ICO entry sizes, badge whiteness,
16px sun/cup gap). Any mismatch prints in the summary table and exits non-zero.

## Outputs (`dist/`)

| File | Source SVG | Notes |
|---|---|---|
| `icon-192.png`, `icon-512.png` | `core-mark/svg/brewcult-appicon.svg` | Full-bleed reversed master (optically centered), PWA `purpose: any` |
| `maskable-192.png`, `maskable-512.png` | `core-mark/svg/brewcult-mark-reversed.svg` | Cream mark centered in the central 80% safe zone on solid espresso `#3B2A20` — Android mask-crop safe |
| `apple-touch-icon-180.png` | `brewcult-appicon.svg` | Flattened, no alpha channel (iOS requirement) |
| `badge-96.png` | `brewcult-mark.svg` | Pure white `#FFFFFF` silhouette on transparency for web-push badges; both `fill` and `stroke` are recolored in SVG text (the ear is a stroked circle) |
| `favicon-16/32/48.png` | 16: `brewcult-mark-small.svg` (lug-ear, **mandatory ≤24px** per USAGE.md); 32/48: `brewcult-mark.svg` | Transparent background |
| `favicon.ico` | same as above | 16+32+48 bundled via `png-to-ico` |
| `og-1200x630.png` | `wordmark/svg/brewcult-lockup-horizontal.svg` | Espresso lockup centered on cream `#F4EDE3`, lockup width 60% of canvas |
| `email-header-800x240.png` | same lockup | Left-aligned, 48px padding; 2x asset for ~400×120 display |
| `manifest-icons.json` | — | `icons` array snippet for the PWA manifest (any + maskable) |

## Brand rules enforced

- The 16px favicon rasterizes from the **small (lug-ear) construction** — the swap
  at ≤24px is mandatory, not optional (`docs/brand/core-mark/USAGE.md`).
- Two colors only (espresso `#3B2A20` / cream `#F4EDE3`); the white push badge is
  the single sanctioned exception. No gradients are ever introduced.
- The flat sun cut and the sun/rim gap come straight from source geometry; the
  verify step asserts the gap survives rasterization at 16px (≥1 clear pixel row).
- App-icon canvases always come from the full-bleed `brewcult-appicon.svg` master;
  the standalone mark is never pasted into an icon canvas (the maskable safe-zone
  composition is specified by the execution plan and uses the reversed mark by design).

## Integration

`dist/` is committed (see local `.gitignore` negation of the root `dist/` rule).
The orchestrator wires outputs into `apps/web/public/` and adds the root script:

```json
"brand:export": "npm run export --workspace @brewcult/brand-tools"
```

(or `cd tools/brand && npx tsx export.ts` if tools are kept out of the workspace graph).
