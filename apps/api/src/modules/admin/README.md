# Admin / operations module

The operator surface: user administration, seller onboarding intake, the
moderation queue, and the audit-log viewer. Everything here is staff-gated
through the central policy layer (EF §3.2) and every mutation writes an
append-only audit row (EF §3.7).

Public interface: [`index.ts`](./index.ts). Nothing outside
`apps/api/src/modules/admin/**` may import any other file in this folder —
`.dependency-cruiser.cjs` fails the build if it tries.

---

## 1. Bootstrapping the first admin (the chicken-and-egg)

**The problem.** Changing a role requires a staff actor *with MFA*:
`isStaff()` in `lib/policy.ts` returns false unless `actor.mfa === true`. On a
fresh install there is no staff account, so there is nobody who may create one.
Every route is behaving correctly and the platform is, correctly,
unadministrable.

Two ways out. **Both refuse an unverified email address**, and both funnel
through one function — `grantRoleByEmail()` in
[`bootstrap.ts`](./bootstrap.ts) — so neither can drift laxer than the other.

### (a) `ADMIN_EMAILS` allowlist — the normal path

Set the environment variable (already declared in `lib/env.ts`; comma-,
semicolon- or whitespace-separated):

```
ADMIN_EMAILS=you@example.com,cofounder@example.com
```

Then register normally through `POST /v1/auth/register`, confirm the emailed
code, and sign in. On the **2xx response** to either

- `POST /v1/auth/verify-email` — the address was just confirmed, or
- `POST /v1/auth/login` — the password was verified, and login already refuses
  accounts whose address is unconfirmed,

the account is promoted to `admin` and a `system`-actor audit row is written.

This is implemented as a Fastify `onResponse` hook that **this module registers
on the shared app**. The identity module's files are not touched. The hook reads
the request body (both routes carry `email`) and the response status; it never
inspects credentials, never alters the response, and swallows-and-logs its own
failures — a bootstrap problem must not turn a successful login into a 500.

The hook is not installed at all when `ADMIN_EMAILS` is empty, so the common
case costs nothing.

> **If the identity lane would rather own the trigger**, the alternative is one
> line in `modules/identity/routes/auth.ts` after `markEmailVerified` and after
> a successful login:
>
> ```ts
> await promoteAllowlistedAdmin(defaultAdminDb, user.email);
> ```
>
> `registerBootstrapHook` can then be deleted. Both are exported from
> `modules/admin/index.ts`.

### (b) Break-glass CLI — the documented recovery path

```bash
npm run admin:grant -w @brewcult/api -- --email you@example.com --role admin
npm run admin:list  -w @brewcult/api
```

(Add the passthrough scripts from [`index.ts`](./index.ts) to the root
`package.json` and the `-w @brewcult/api` disappears.)

Connects with `DATABASE_URL`, promotes by email, refuses an unverified address
or a non-active account, and writes the same `system` audit row with
`payload.mechanism = 'cli'`. Use it when a database has been restored into a new
environment, when the operator enrolled MFA *before* being promoted (the login
hook still fires, but the CLI is deterministic), or when nobody can sign in at
all.

`admin:list` prints every non-`user` account with its MFA state and warns about
staff accounts that cannot actually exercise their role.

### The step everybody forgets

**The grant is inert until MFA is enrolled.** `isStaff()` requires
`actor.mfa === true`, so a brand-new admin still receives `403` from every
`/v1/admin/**` route. The full first-run sequence is:

1. `POST /v1/auth/register` → confirm the code with `POST /v1/auth/verify-email`
2. `POST /v1/auth/login` → the allowlist hook promotes the account to `admin`
3. `POST /v1/auth/mfa/enrol` → scan the QR → `POST /v1/auth/mfa/confirm`
4. `POST /v1/auth/login` again → `POST /v1/auth/mfa/verify` → the session now
   carries `mfa: true`
5. `/v1/admin/**` works. **Remove the address from `ADMIN_EMAILS`.**

Step 2's promotion applies to the *next* token minted: the access token already
in flight carries the old role claim until it is refreshed.

### Security properties (each one is a test)

| Property | Why |
| --- | --- |
| Never promotes an unverified email | Otherwise "`admin@company.com` is allowlisted" is an invitation to whoever types that address into the signup form first |
| Never promotes a non-active account | A suspension must not be undoable by an environment variable |
| Idempotent — no audit row for a no-op | Otherwise every login by an admin appends to an immutable table forever |
| Grant is inert without MFA | EF §3.2's "MFA enforced" holds even for the founder |

---

## 2. Layout

| File | Responsibility |
| --- | --- |
| `index.ts` | Public interface + `registerAdminRoutes(app)` |
| `policies.ts` | `admin_user`, `seller_application`, `report`, `audit_log` — default-deny |
| `routes.ts` | HTTP surface, lockout guards, audit calls |
| `repository.ts` | All SQL; the one documented read-only exception (below) |
| `schemas.ts` | Fastify JSON schemas — `additionalProperties: false` everywhere |
| `bootstrap.ts` | Both first-admin paths + the `onResponse` hook |
| `sessions.ts` | The revoke-all seam onto identity |
| `audit.ts` | Seam onto identity's `recordAuditEvent` |
| `cursor.ts` | Opaque keyset cursors (uuid *and* bigint ids) |
| `types.ts` | Wire shapes, vocabularies, the `AdminDb` seam |

Tables owned by this module: `admin_seller_applications`, `reports`
(`db/migrations/0007_admin.sql`).

---

## 3. Seams this module needs from other lanes

### 3.1 `app.ts` — two lines (this lane must not edit that file)

```ts
import { registerAdminRoutes } from './modules/admin/index.js';
await registerAdminRoutes(app);   // AFTER registerIdentityRoutes(app)
```

### 3.2 identity — one line, to make suspension revoke sessions

Suspension must log the account out. `users.status` alone already closes both
doors identity guards (`login` and `refresh` each re-read the row), so a
suspension is never merely cosmetic — but the refresh-token *families* stay
live, which keeps the operator's session view green and would silently restore
every old device on reactivation.

`refresh_tokens` is identity's table, so this module must not `UPDATE` it.
Identity already has the right helper — `revokeAllFamiliesForUser` in
`modules/identity/tokens.ts` — but does not re-export it. The ask is one line in
`modules/identity/index.ts`:

```ts
export { revokeAllFamiliesForUser } from './tokens.js';
```

`sessions.ts` discovers it through identity's **public** interface
automatically, so nothing else changes anywhere — not here, not in `app.ts`.

Until it lands, `sessions_revoked` is `null` in the response *and* in the audit
payload, and the route logs a warning. A degraded control that reports itself
degraded is recoverable; one that reports success is a lie the next incident
review has to untangle. The status change itself is never conditional on the
revoker — refusing to suspend an abusive account because a seam is unwired
would be exactly the wrong failure mode.

Explicit injection also works, and is what the test suite uses (with identity's
real implementation, so the seam is proven rather than stubbed):

```ts
await registerAdminRoutes(app, { revokeSessions: revokeAllFamiliesForUser });
```

### 3.3 identity — widen `AuditAction` (cosmetic)

`AuditAction` is a closed union of identity's own actions. The admin actions are
declared in [`audit.ts`](./audit.ts) and cast to it at **one** seam, exactly as
the brewing lane does. Adding `admin.*` to identity's union removes the cast.

### 3.4 identity — own the admin user projection (follow-up)

`repository.ts` **reads** five identity-owned tables (`users`,
`auth_identities`, `user_mfa`, `login_attempts`, `refresh_tokens`) because an
operator console is definitionally a cross-cutting read of the account graph and
identity publishes only single-row lookups. The exception is bounded:

1. **Read-only.** Not one `INSERT`/`UPDATE`/`DELETE` against an identity table
   exists in this module — grep for it.
2. Every write goes through identity's published writers: `setUserRole`,
   `setUserStatus`, `recordAuditEvent`, and the injected session revoker.
3. The projection is declared once, in `ADMIN_USER_SELECT`, so the day identity
   publishes `listUsersForAdmin()` there is exactly one query to delete.

---

## 4. Behaviour worth knowing

**401 vs 403 vs 409.** `401` anonymous; `403` authenticated but not staff *or*
staff without an MFA-backed session (deliberately indistinguishable); `409` the
actor is entitled but the operation would break an invariant.

**The three lockout guards** (`routes.ts`), all 409:

1. An admin may not change their **own** role.
2. An admin may not suspend **themselves**.
3. No change may leave **zero active admins** — checked against the world as it
   *would* be, so the last admin cannot be removed by a peer either.

**`mfa_required` on role changes.** Promoting into `MFA_REQUIRED_ROLES` succeeds,
but the response flags `mfa_required: true`. The console must surface it or the
newly promoted moderator sees nothing but 403s with no explanation.

**Demotions revoke sessions**, promotions do not. A demoted admin's live access
token still carries the old role claim for up to its 15-minute TTL; a promotion
grants strictly more and is picked up on the next refresh.

**Approving a seller application** grants exactly `seller_owner`, and only to an
account whose role is `user`. An existing moderator/editor/admin is *not*
downgraded by approving their shop application — that would be a privilege
change smuggled through the marketplace queue. This is intake only; stores,
verification and payouts are Phase 4 (EF §3.6).

**One live report per (reporter, target)**, enforced by the partial unique index
`uq_reports_live_per_reporter_target` — in the database, so two concurrent
submissions cannot both pass an application-level check. `reviewing` counts as
live: a report a moderator has already claimed must not be re-filed underneath
them.

**The audit viewer is read-only and staff-only, with no owner exemption.** The
trail names who suspended whom and why; handing any slice of it to a non-staff
actor would leak both moderation decisions and other users' auth events.
