/**
 * BrewCult module-boundary rules (EF §1.2, backlog F-04).
 *
 * "A boundary that isn't lint-enforced doesn't exist."
 *
 * The api's domain modules live in apps/api/src/modules/<module>/ (identity,
 * catalog, brewing, community, news, commerce, intelligence, trust — Wave 2+).
 * Each module is consumable ONLY through its public interface (index.ts);
 * importing another module's internals is a hard error. The rules are written
 * now, before the modules exist, so the first cross-module reach-in fails CI.
 *
 * Run: npm run lint:boundaries  (wired into `npm run lint`)
 */
module.exports = {
  forbidden: [
    {
      name: 'api-no-cross-module-internals',
      severity: 'error',
      comment:
        'A module may import another module ONLY via its public interface ' +
        '(apps/api/src/modules/<module>/index.ts). Cross-module needs go through ' +
        'the exported interface or domain events (EF §1.2).',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/([^/]+)/',
        pathNot: [
          '^apps/api/src/modules/$1/', // own module — unrestricted
          '^apps/api/src/modules/[^/]+/index\\.ts$', // another module's public interface
        ],
      },
    },
    {
      name: 'api-core-no-module-internals',
      severity: 'error',
      comment:
        'Non-module api code (server bootstrap, shared plumbing) may only use a ' +
        'module through its index.ts.',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/modules/' },
      to: {
        path: '^apps/api/src/modules/[^/]+/.+',
        pathNot: '^apps/api/src/modules/[^/]+/index\\.ts$',
      },
    },
    {
      name: 'no-cross-app-imports',
      severity: 'error',
      comment:
        'Apps never import each other\'s source. Shared code lives in packages/* ' +
        '(EF §1.6); web talks to api over HTTP/OpenAPI only.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/[^/]+/', pathNot: '^apps/$1/' },
    },
    {
      name: 'packages-independent-of-apps',
      severity: 'error',
      comment: 'packages/* are leaves — they must never depend on apps/*.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are how monsters start.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['node_modules', '\\.next', '(^|/)dist/'] },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
