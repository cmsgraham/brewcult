import { afterEach, describe, expect, it } from 'vitest';
import {
  ANONYMOUS,
  AuthorizationError,
  authorize,
  can,
  definePolicy,
  hasRole,
  isOwner,
  isStaff,
  resetPolicies,
  type Actor,
} from '../src/lib/policy.js';

interface Recipe {
  id: string;
  authorId: string;
  visibility: 'private' | 'public';
}

const alice: Actor = { userId: 'u-alice', role: 'user' };
const bob: Actor = { userId: 'u-bob', role: 'user' };
const admin: Actor = { userId: 'u-admin', role: 'admin', mfa: true };
const adminNoMfa: Actor = { userId: 'u-admin', role: 'admin' };

function registerRecipePolicy(): void {
  definePolicy<Recipe>('recipe', (actor, action, resource) => {
    if (action === 'create') return actor.userId !== null;
    if (!resource) return false;
    if (action === 'read') return resource.visibility === 'public' || isOwner(actor, resource.authorId);
    if (action === 'update' || action === 'delete') return isOwner(actor, resource.authorId);
    if (action === 'moderate') return isStaff(actor);
    return false;
  });
}

afterEach(() => resetPolicies());

describe('policy layer (EF §3.2)', () => {
  it('denies by default when no policy is registered', async () => {
    await expect(authorize(admin, 'read', 'unregistered_type', {})).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('lets an owner read and update their private resource', async () => {
    registerRecipePolicy();
    const recipe: Recipe = { id: 'r1', authorId: 'u-alice', visibility: 'private' };
    await expect(authorize(alice, 'read', 'recipe', recipe)).resolves.toBeUndefined();
    await expect(authorize(alice, 'update', 'recipe', recipe)).resolves.toBeUndefined();
  });

  it('blocks another user from reading or updating a private resource (IDOR)', async () => {
    registerRecipePolicy();
    const recipe: Recipe = { id: 'r1', authorId: 'u-alice', visibility: 'private' };
    await expect(authorize(bob, 'read', 'recipe', recipe)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(authorize(bob, 'update', 'recipe', recipe)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await can(bob, 'update', 'recipe', recipe)).toBe(false);
  });

  it('allows any reader on a public resource but still guards writes', async () => {
    registerRecipePolicy();
    const recipe: Recipe = { id: 'r2', authorId: 'u-alice', visibility: 'public' };
    expect(await can(bob, 'read', 'recipe', recipe)).toBe(true);
    expect(await can(bob, 'update', 'recipe', recipe)).toBe(false);
  });

  it('uses 401 for anonymous and 403 for authenticated-but-forbidden', async () => {
    registerRecipePolicy();
    const recipe: Recipe = { id: 'r1', authorId: 'u-alice', visibility: 'private' };
    await expect(authorize(ANONYMOUS, 'read', 'recipe', recipe)).rejects.toMatchObject({ statusCode: 401 });
    await expect(authorize(bob, 'read', 'recipe', recipe)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('requires MFA for staff actions', async () => {
    registerRecipePolicy();
    const recipe: Recipe = { id: 'r1', authorId: 'u-alice', visibility: 'private' };
    expect(await can(admin, 'moderate', 'recipe', recipe)).toBe(true);
    expect(await can(adminNoMfa, 'moderate', 'recipe', recipe)).toBe(false);
  });

  it('refuses duplicate policy registration for one resource type', () => {
    registerRecipePolicy();
    expect(() => registerRecipePolicy()).toThrow(/already registered/);
  });

  it('hasRole matches only the listed roles', () => {
    expect(hasRole('admin', 'moderator')(admin)).toBe(true);
    expect(hasRole('admin')(alice)).toBe(false);
    expect(hasRole('user')(ANONYMOUS)).toBe(false);
  });
});
