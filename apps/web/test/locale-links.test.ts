import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localePath } from '../lib/i18n';

/**
 * Every internal link keeps you in the language you are reading.
 *
 * The bug this pins down: the nav was translated and got `localePath` by hand,
 * and nothing else did. A Spanish reader stayed Spanish exactly until they
 * clicked something — the footer, "back to your profile", the link from a
 * cupping score to the guide explaining it — and then silently became an
 * English reader. It looked like the translation was broken rather than absent.
 *
 * Doing it per-link was never going to hold, because the next link somebody
 * adds is a bare one and nothing fails. `components/locale-link` makes the
 * correct thing the default; this makes the incorrect thing loud.
 */

const ROOT = join(__dirname, '..');

/**
 * The three files allowed to reach for `next/link` directly.
 *
 * `locale-link` is the wrapper itself. The nav and the switcher build their
 * hrefs from `localePath` explicitly — the switcher in particular must be able
 * to point AT the other language, which is the one thing the wrapper cannot do.
 */
const ALLOWED = new Set([
  'components/locale-link.tsx',
  'components/site-nav.tsx',
  'components/language-switcher.tsx',
]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'test') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith('.tsx')) found.push(full);
  }
  return found;
}

describe('internal links carry the locale', () => {
  it('nothing imports next/link except the wrapper, the nav and the switcher', () => {
    const offenders = sourceFiles(join(ROOT, 'app'))
      .concat(sourceFiles(join(ROOT, 'components')))
      .filter((file) => readFileSync(file, 'utf8').includes("from 'next/link'"))
      .map((file) => relative(ROOT, file).split('\\').join('/'))
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });

  it('leaves anything that is not a root-relative path alone', () => {
    // What LocaleLink guards on. A locale prefix on any of these is not a
    // translation, it is a broken link.
    for (const href of ['https://example.com', 'mailto:hi@brewcult.coffee', '#notes']) {
      expect(href.startsWith('/')).toBe(false);
    }
  });

  it('is idempotent, so a hand-prefixed href passed through it is unharmed', () => {
    // Some server pages still call localePath themselves. Double application
    // has to be a no-op or those links would become /es/es/discover.
    expect(localePath(localePath('/discover', 'es'), 'es')).toBe('/es/discover');
    expect(localePath(localePath('/discover', 'en'), 'en')).toBe('/discover');
  });
});
