/**
 * The BrewCult horizontal lockup — mark + wordmark, the primary lockup for web
 * headers (WORDMARK-NOTES §Files).
 *
 * Brand law obeyed here:
 *  - The wordmark is the shipped SVG (outlined paths), never live text. Space
 *    Grotesk is loaded for UI copy; the logo is always the file.
 *  - Espresso on cream / cream on espresso only — the reversed asset is a
 *    straight colour swap of the same geometry (WORDMARK-NOTES rule 5).
 *  - Rendered at >= 132px wide, above the 120px horizontal-lockup floor (rule 3).
 *  - Clear space (cap height on all sides) is held by the header padding.
 *
 * Both variants ship in the markup and CSS picks one from
 * prefers-color-scheme, so the correct mark paints on the first frame with no
 * script involved — which matters under `script-src 'self'`. Because a
 * `display: none` image is invisible to assistive tech, the accessible name
 * lives in a visually-hidden span instead of on either <img>.
 *
 * Plain <img>, not next/image: these are vector brand files that must not be
 * rasterised or re-encoded.
 */
export function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`bc-lockup ${className}`.trim()}>
      <span className="bc-visually-hidden">BrewCult</span>
      <img
        className="bc-lockup__light"
        src="/brand/brewcult-lockup-horizontal.svg"
        alt=""
        aria-hidden="true"
        width={3044}
        height={563}
      />
      <img
        className="bc-lockup__dark"
        src="/brand/brewcult-lockup-horizontal-reversed.svg"
        alt=""
        aria-hidden="true"
        width={3044}
        height={563}
      />
    </span>
  );
}
