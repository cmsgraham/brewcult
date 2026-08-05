/**
 * BREAK-GLASS ADMIN CLI — bootstrap path (b).
 *
 *   npm run admin:grant -w @brewcult/api -- --email you@example.com --role admin
 *   npm run admin:list  -w @brewcult/api
 *
 * (Add the two passthrough scripts listed in `modules/admin/index.ts` to the
 * root package.json and the `-w @brewcult/api` disappears.)
 *
 * WHY THIS EXISTS
 *   Role changes require a staff actor with MFA. On a fresh install nobody
 *   qualifies, so the HTTP surface cannot mint the first admin — see the long
 *   note in `modules/admin/bootstrap.ts`. The ADMIN_EMAILS allowlist covers the
 *   normal case; this covers the rest: a database restored into a new
 *   environment, an operator who enrolled MFA before being promoted, or the
 *   moment nobody can log in at all. It is the path that only needs shell
 *   access and DATABASE_URL.
 *
 * WHAT IT WILL NOT DO
 *   It shares ONE code path with the allowlist — `grantRoleByEmail()` — so it
 *   cannot have laxer rules than the HTTP surface even by accident:
 *     * it REFUSES an unverified email address (the whole point: otherwise
 *       "admin@company.com is allowlisted" is an invitation to whoever types
 *       that address into the signup form first);
 *     * it REFUSES a non-active account;
 *     * it writes an append-only audit row with a NULL actor (0002's "system")
 *       and `payload.mechanism = 'cli'`, so a grant made from a shell is as
 *       visible in the trail as one made from the console.
 *
 * WHAT COMES NEXT (say it out loud, the operator will not guess)
 *   The grant is INERT until MFA is enrolled: `isStaff()` requires
 *   `actor.mfa === true`, so a brand-new admin still gets 403 from every
 *   `/v1/admin/**` route until they finish TOTP enrolment and sign in again.
 *   The success message says so.
 *
 * `console` is banned repo-wide (structured logs only, EF §7.2) — a CLI's
 * stdout is its UI, so this writes to the streams directly.
 */

import { closePool } from '../lib/db.js';
import {
  defaultAdminDb,
  grantRoleByEmail,
  listStaff,
  ASSIGNABLE_ROLES,
  type GrantOutcome,
  type Role,
} from '../modules/admin/index.js';

const out = (line: string): void => void process.stdout.write(`${line}\n`);
const err = (line: string): void => void process.stderr.write(`${line}\n`);

const USAGE = `
BrewCult admin CLI (break-glass; see apps/api/src/modules/admin/README.md)

  admin:grant --email <address> [--role <role>]   promote an account
  admin:list  [--all]                             list staff (--all: every role)

Options
  --email <address>   the account to promote (required for grant)
  --role  <role>      one of: ${ASSIGNABLE_ROLES.join(', ')}   (default: admin)
  --json              machine-readable output
  --help              this text

Environment
  DATABASE_URL        required; no default is guessed

The grant is refused if the address is unverified or the account is not active.
`.trim();

interface Args {
  command: string;
  email?: string;
  role?: string;
  json: boolean;
  all: boolean;
  help: boolean;
}

/**
 * Minimal, dependency-free flag parsing. Accepts `--flag value` and
 * `--flag=value`; anything unrecognised is a usage error rather than something
 * silently ignored — a typo'd `--emial` must not end with a confusing
 * "user not found".
 */
function parseArgs(argv: readonly string[]): Args {
  const args: Args = { command: '', json: false, all: false, help: false };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    if (!token.startsWith('--')) {
      rest.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);
    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      i += 1;
      const next = argv[i];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Option --${name} needs a value.`);
      }
      return next;
    };

    switch (name) {
      case 'email':
        args.email = takeValue();
        break;
      case 'role':
        args.role = takeValue();
        break;
      case 'json':
        args.json = true;
        break;
      case 'all':
        args.all = true;
        break;
      case 'help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option --${name}.`);
    }
  }

  args.command = rest[0] ?? '';
  if (rest.length > 1) throw new Error(`Unexpected argument '${rest[1] ?? ''}'.`);
  return args;
}

function isRole(value: string): value is Role {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

/** Human-readable rendering of every `GrantOutcome`; exit code comes with it. */
function reportGrant(outcome: GrantOutcome, role: Role): number {
  switch (outcome.status) {
    case 'granted':
      out(`GRANTED  ${outcome.user.email}  ${outcome.previous_role} → ${role}`);
      out(`         user_id: ${outcome.user.id}  handle: @${outcome.user.handle}`);
      out('');
      if (outcome.mfa_required) {
        out('NEXT: this role requires MFA. The account still gets 403 from /v1/admin/**');
        out('      until it enrols TOTP (POST /v1/auth/mfa/enrol, then /confirm) and');
        out('      signs in again — isStaff() refuses a session without actor.mfa.');
      }
      out('An audit row was written with actor=system, mechanism=cli.');
      return 0;

    case 'already_granted':
      out(`NO CHANGE  ${outcome.user.email} already holds the role '${outcome.user.role}'.`);
      return 0;

    case 'user_not_found':
      err(`REFUSED  no account with the address '${outcome.email}'.`);
      err('         The account must exist and be registered before it can be promoted.');
      return 1;

    case 'email_unverified':
      err(`REFUSED  ${outcome.user.email} has NOT verified their email address.`);
      err('         Promoting an unverified address would let anyone who can type it');
      err('         into the signup form claim the role. Verify first, then re-run.');
      return 1;

    case 'account_not_active':
      err(`REFUSED  account status is '${outcome.user.status}', not 'active'.`);
      err('         Reactivate the account before granting it a role.');
      return 1;
  }
}

async function runGrant(args: Args): Promise<number> {
  if (!args.email) {
    err('REFUSED  --email is required.');
    err('');
    err(USAGE);
    return 2;
  }
  const roleInput = args.role ?? 'admin';
  if (!isRole(roleInput)) {
    err(`REFUSED  '${roleInput}' is not a role. Expected one of: ${ASSIGNABLE_ROLES.join(', ')}.`);
    return 2;
  }

  const outcome = await grantRoleByEmail(defaultAdminDb, {
    email: args.email,
    role: roleInput,
    mechanism: 'cli',
  });

  if (args.json) {
    out(JSON.stringify(outcome, null, 2));
    return outcome.status === 'granted' || outcome.status === 'already_granted' ? 0 : 1;
  }
  return reportGrant(outcome, roleInput);
}

async function runList(args: Args): Promise<number> {
  const staff = await listStaff(defaultAdminDb);

  if (args.json) {
    out(JSON.stringify(staff, null, 2));
    return 0;
  }

  if (staff.length === 0) {
    out('No staff accounts. The platform has no operator.');
    out('');
    out('Bootstrap one:');
    out('  * set ADMIN_EMAILS=you@example.com and sign in with a VERIFIED account, or');
    out('  * npm run admin:grant -w @brewcult/api -- --email you@example.com --role admin');
    return 0;
  }

  out(`${staff.length} staff account(s):`);
  out('');
  for (const user of staff) {
    // MFA is the load-bearing column here: a staff account without it holds a
    // role it cannot actually exercise, which is exactly the state an operator
    // needs to see at a glance.
    const mfa = user.mfa_enabled ? 'mfa:on ' : 'mfa:OFF';
    out(
      `  ${user.role.padEnd(13)} ${mfa}  ${user.status.padEnd(11)} ` +
        `@${user.handle.padEnd(20)} ${user.email}`,
    );
  }
  const unusable = staff.filter((u) => !u.mfa_enabled);
  if (unusable.length > 0) {
    out('');
    out(
      `WARNING: ${unusable.length} staff account(s) have no MFA enrolled and therefore ` +
        'cannot use any staff-gated route (isStaff() requires actor.mfa).',
    );
  }
  return 0;
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (parseError) {
    err(`REFUSED  ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    err('');
    err(USAGE);
    return 2;
  }

  if (args.help || args.command === '' || args.command === 'help') {
    out(USAGE);
    return args.help || args.command === 'help' ? 0 : 2;
  }

  switch (args.command) {
    case 'grant':
      return runGrant(args);
    case 'list':
      return runList(args);
    default:
      err(`REFUSED  unknown command '${args.command}'.`);
      err('');
      err(USAGE);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((fatal: unknown) => {
    err(`ERROR    ${fatal instanceof Error ? fatal.message : String(fatal)}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
