/**
 * Brewing HTTP surface (backlog REC-01..REC-05, REC-07, BREW-01/05/08, GC-02/03).
 *
 * Handlers do four things and nothing else: resolve (actor, action, resource)
 * through `authorize()` (EF §3.2), hand validated input to the repository,
 * emit the domain event / audit record, and return contract DTOs. No SQL, no
 * ownership `if`s, no ad-hoc validation — those live in `repository.ts`,
 * `policies.ts` and `schemas.ts` respectively.
 *
 * Every route that reads or writes an existing row loads its POLICY RESOURCE
 * first and authorizes against that, so the answer to "may I?" is always
 * computed from the stored row and never from what the caller claimed.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { listGrindConversions } from '../catalog/index.js';
import {
  defaultNotificationExec,
  findRecipient,
  sendNotification,
} from '../notifications/index.js';
import { requireAuth } from '../../lib/auth-plugin.js';
import { getEnv } from '../../lib/env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ANONYMOUS, authorize, can, type Actor } from '../../lib/policy.js';
import { recordBrewingAudit } from './audit.js';
import { decodeCursor, encodeCursor, paginate } from './cursor.js';
import { emitDomainEvent } from './events.js';
import { assertParamsMatchMethod, normaliseGrind, normaliseParams } from './params.js';
import {
  BREW_SESSION_RESOURCE,
  GRIND_SUGGESTION_RESOURCE,
  RECIPE_RESOURCE,
} from './policies.js';
import * as repo from './repository.js';
import {
  addToShelf,
  finishBag,
  listShelf,
  removeFromShelf,
} from './user-coffees.js';
import { defaultBrewingDb, withTransaction } from './repository.js';
import {
  addCustomEquipment,
  addOwnedEquipment,
  listOwnedEquipment,
  removeOwnedEquipment,
  setPrimaryEquipment,
  type EquipmentCategory,
} from './user-equipment.js';
import {
  brewListQuery,
  brewPrefillQuery,
  brewPutBody,
  grindSuggestQuery,
  idParams,
  recipeCreateBody,
  recipeForkBody,
  recipeListQuery,
  recipePatchBody,
  recipePutBody,
  recipeReviewBody,
  syncChangesQuery,
} from './schemas.js';
import { assertMediaUsable } from '../media/index.js';
import { diagnoseTaste } from './taste.js';
import { iso as isoOf } from './types.js';
import type {
  BrewParams,
  BrewPrefill,
  BrewSource,
  BrewingDb,
  GrindCategory,
  GrindConversionSuggestion,
  GrindSetting,
  Measurements,
  RecipeVisibility,
  SyncChange,
  SyncChangesResponse,
  SyncResourceType,
  TasteResult,
  WaterProfile,
} from './types.js';

export interface BrewingRouteOptions {
  /** Database seam; defaults to the shared pool. Tests inject PGlite. */
  db?: BrewingDb;
  /** Path prefix for every route in this module. */
  prefix?: string;
}

/**
 * §6.4 point 4: a converted grind setting is a starting point, never a fact.
 * The API states that in the payload so no client can accidentally drop it.
 */
const GRIND_DISCLAIMER =
  'Converted grind settings are approximate starting points derived from community data. ' +
  'Dial in by taste — burr alignment, wear and unit-to-unit variance all move the target.';

const CATEGORY_ONLY_DISCLAIMER =
  'No community data links these two grinders yet. Start from the coarse category and dial ' +
  'in by taste — this is a category match, not a converted setting.';

/** Sensible v1 filter defaults, matching the card in brew_logger_ux §3. */
const DEFAULT_FILTER_PARAMS: BrewParams = {
  method: 'filter',
  dose_g: 15,
  water_g: 250,
  temperature_c: 94,
  brew_time_s: 165,
};

const DEFAULT_ESPRESSO_PARAMS: BrewParams = {
  method: 'espresso',
  dose_in_g: 18,
  yield_out_g: 36,
  shot_time_s: 28,
  temperature_c: 93,
};

const defaultGrind = (method: string): GrindSetting => ({
  equipment_model_id: null,
  setting: null,
  scale_type: null,
  category: method === 'espresso' ? 'fine' : 'medium',
});

const actorOf = (request: FastifyRequest): Actor =>
  (request as FastifyRequest & { actor?: Actor }).actor ?? ANONYMOUS;

/** Every mutating route needs a user; `requireAuth` 401s before any handler runs. */
const authed = { preHandler: [requireAuth] };

function requireUserId(request: FastifyRequest): string {
  const id = actorOf(request).userId;
  if (id === null) throw badRequest('Authentication required.');
  return id;
}

export async function registerBrewingRoutes(
  app: FastifyInstance,
  options: BrewingRouteOptions = {},
): Promise<void> {
  const db = options.db ?? defaultBrewingDb;
  const prefix = options.prefix ?? '/v1';

  // -------------------------------------------------------------------------
  // Owned equipment — "what I actually have" (0010)
  //
  // Under /v1/my-equipment rather than /v1/equipment/... because catalog owns
  // that namespace and /v1/equipment/:slug is a public catalogue page. Two
  // different resources sharing a prefix is how you end up with a slug called
  // "mine".
  // -------------------------------------------------------------------------


  // -------------------------------------------------------------------------
  // What is in my cupboard (0014).
  //
  // Same namespace reasoning as /my-equipment: /v1/coffees/:slug is a public
  // catalogue page, and a personal collection sharing that prefix is how you end
  // up with a coffee called "mine".
  // -------------------------------------------------------------------------

  app.get(`${prefix}/my-coffees`, authed, async (request) => ({
    items: await listShelf(db, requireUserId(request)),
  }));

  app.post<{
    Body: {
      coffee_product_id?: string;
      roaster?: string;
      name?: string;
      roast_date?: string;
      notes?: string;
    };
  }>(`${prefix}/my-coffees`, authed, async (request, reply) => {
    const userId = requireUserId(request);
    const body = request.body ?? {};
    const productId = typeof body.coffee_product_id === 'string' ? body.coffee_product_id : null;
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!productId && name === '') throw badRequest('What is the coffee called?');
    if (name.length > 160) throw badRequest('That name is a bit long — 160 characters or fewer.');
    if (body.roaster !== undefined && body.roaster.length > 120) {
      throw badRequest('That roaster name is a bit long — 120 characters or fewer.');
    }
    if (body.notes !== undefined && body.notes.length > 2000) {
      throw badRequest('That note is a bit long — 2000 characters or fewer.');
    }
    // A roast date in the future is a typo and the database refuses it; saying
    // so here is friendlier than a constraint name.
    if (body.roast_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.roast_date)) {
      throw badRequest('Use a date like 2026-08-05 for the roast date.');
    }

    const result = await addToShelf(db, {
      userId,
      coffeeProductId: productId,
      customRoaster: body.roaster ?? null,
      customName: name || null,
      roastDate: body.roast_date ?? null,
      notes: body.notes ?? null,
    });

    if (result.status === 'not_found') throw badRequest('We do not know that coffee.');
    // Adding the same open bag twice is a double-click.
    const status = result.status === 'added' ? 201 : 200;
    return reply.status(status).send({ items: await listShelf(db, userId) });
  });

  app.post<{ Params: { id: string } }>(
    `${prefix}/my-coffees/:id/finished`,
    authed,
    async (request, reply) => {
      const userId = requireUserId(request);
      if (!(await finishBag(db, userId, request.params.id))) {
        throw notFound('No open bag with that id.');
      }
      return reply.send({ items: await listShelf(db, userId) });
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${prefix}/my-coffees/:id`,
    authed,
    async (request, reply) => {
      const userId = requireUserId(request);
      if (!(await removeFromShelf(db, userId, request.params.id))) {
        throw notFound('That is not on your shelf.');
      }
      return reply.send({ items: await listShelf(db, userId) });
    },
  );

  app.get(`${prefix}/my-equipment`, authed, async (request) => ({
    items: await listOwnedEquipment(db, requireUserId(request)),
  }));

  app.post<{ Body: { equipment_model_id?: string; nickname?: string; is_primary?: boolean } }>(
    `${prefix}/my-equipment`,
    authed,
    async (request, reply) => {
      const userId = requireUserId(request);
      const body = request.body ?? {};
      if (typeof body.equipment_model_id !== 'string' || body.equipment_model_id === '') {
        throw badRequest('Tell us which piece of equipment.');
      }
      if (body.nickname !== undefined && body.nickname.length > 60) {
        throw badRequest('That nickname is a bit long — 60 characters or fewer.');
      }

      const result = await addOwnedEquipment(db, {
        userId,
        equipmentModelId: body.equipment_model_id,
        nickname: body.nickname ?? null,
        isPrimary: body.is_primary === true,
      });

      // A model that is not in the catalogue is a bad request, not a 404 on
      // this collection — the thing that does not exist is what they sent.
      if (result.status === 'unknown_model') throw badRequest('We do not know that equipment.');
      if (result.status === 'already_owned') {
        // Adding the same thing twice is a double-click, not an error worth
        // showing somebody. Answer with the list they were going to reload.
        return reply.status(200).send({ items: await listOwnedEquipment(db, userId) });
      }

      await recordBrewingAudit(db, {
        actorId: userId,
        action: 'user_equipment.added',
        targetType: 'user_equipment',
        targetId: result.item.id,
        payload: { equipment_model_id: result.item.equipment_model_id },
      });
      return reply.status(201).send({ items: await listOwnedEquipment(db, userId) });
    },
  );

  const CATEGORIES: readonly EquipmentCategory[] = [
    'brewer',
    'grinder',
    'kettle',
    'scale',
    'machine',
    'accessory',
  ];

  /**
   * Gear the catalogue does not have (0011, tier 1).
   *
   * Deliberately NOT gated on review: somebody who owns an unlisted grinder
   * should be able to record it and get on with logging a brew. It is private
   * to them and never reaches the shared catalogue — that is what
   * /v1/equipment-requests is for.
   */
  app.post<{
    Body: { brand?: string; name?: string; category?: string; is_primary?: boolean };
  }>(`${prefix}/my-equipment/custom`, authed, async (request, reply) => {
    const userId = requireUserId(request);
    const body = request.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const category = body.category as EquipmentCategory | undefined;

    if (name === '') throw badRequest('What is it called?');
    if (name.length > 120) throw badRequest('That name is a bit long — 120 characters or fewer.');
    if ((body.brand ?? '').length > 80) {
      throw badRequest('That brand is a bit long — 80 characters or fewer.');
    }
    if (!category || !CATEGORIES.includes(category)) {
      throw badRequest('Tell us what kind of equipment it is.');
    }

    const result = await addCustomEquipment(db, {
      userId,
      brand: body.brand ?? null,
      name,
      category,
      isPrimary: body.is_primary === true,
    });

    if (result.status === 'unknown_model') throw badRequest('What is it called?');
    if (result.status === 'already_owned') {
      return reply.status(200).send({ items: await listOwnedEquipment(db, userId) });
    }

    await recordBrewingAudit(db, {
      actorId: userId,
      action: 'user_equipment.added',
      targetType: 'user_equipment',
      targetId: result.item.id,
      payload: { custom: true, category },
    });
    return reply.status(201).send({ items: await listOwnedEquipment(db, userId) });
  });

  app.patch<{ Params: { id: string } }>(
    `${prefix}/my-equipment/:id`,
    authed,
    async (request) => {
      const userId = requireUserId(request);
      // Scoped by user_id in the query, so somebody else's id reads as absent
      // rather than being found and then refused — no existence oracle.
      const updated = await setPrimaryEquipment(db, userId, request.params.id);
      if (!updated) throw notFound('Not in your equipment.');
      return { items: await listOwnedEquipment(db, userId) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${prefix}/my-equipment/:id`,
    authed,
    async (request) => {
      const userId = requireUserId(request);
      const removed = await removeOwnedEquipment(db, userId, request.params.id);
      if (!removed) throw notFound('Not in your equipment.');
      await recordBrewingAudit(db, {
        actorId: userId,
        action: 'user_equipment.removed',
        targetType: 'user_equipment',
        targetId: request.params.id,
        payload: {},
      });
      return { items: await listOwnedEquipment(db, userId) };
    },
  );

  // -------------------------------------------------------------------------
  // Recipes (REC-01..REC-05, REC-07)
  // -------------------------------------------------------------------------

  app.get<{
    Querystring: {
      author?: string;
      coffee_product_id?: string;
      method?: string;
      visibility?: RecipeVisibility;
      is_official?: boolean;
      parent_recipe_id?: string;
      cursor?: string;
      limit?: number;
    };
  }>(`${prefix}/recipes`, { schema: { querystring: recipeListQuery } }, async (request) => {
    const actor = actorOf(request);
    await authorize(actor, 'list', RECIPE_RESOURCE);
    const q = request.query;
    const limit = q.limit ?? 20;

    const author = q.author === 'me' ? actor.userId : q.author;
    if (q.author === 'me' && actor.userId === null) {
      throw badRequest("author=me requires an authenticated caller.");
    }

    const rows = await repo.listRecipeRows(db, {
      ...(author ? { authorId: author } : {}),
      ...(q.coffee_product_id ? { coffeeProductId: q.coffee_product_id } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.visibility ? { visibility: q.visibility } : {}),
      ...(q.is_official !== undefined ? { isOfficial: q.is_official } : {}),
      ...(q.parent_recipe_id ? { parentRecipeId: q.parent_recipe_id } : {}),
      viewerId: actor.userId,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit,
    });

    // The SQL predicate is an optimisation; the policy is the guarantee. Any row
    // the query let through that the policy would refuse is dropped here.
    const visible = await filterReadable(actor, rows, (row) => ({
      id: row.id,
      authorId: row.author_id,
      visibility: row.visibility,
      isOfficial: row.is_official,
      deleted: row.deleted_at !== null,
    }));

    const page = paginate(visible, limit, (row) => row.created_at);
    return { items: page.items.map(repo.toRecipe), next_cursor: page.next_cursor };
  });

  app.post<{ Body: RecipeBody & { id?: string } }>(
    `${prefix}/recipes`,
    { ...authed, schema: { body: recipeCreateBody } },
    async (request, reply) => {
      const actor = actorOf(request);
      await authorize(actor, 'create', RECIPE_RESOURCE);
      const userId = requireUserId(request);
      const body = request.body;
      assertParamsMatchMethod(body.method, body.params);

      const row = await withTransaction(db, async (tx) => {
        const created = await repo.createRecipe(tx, {
          id: body.id ?? crypto.randomUUID(),
          author_id: userId,
          ...recipeContent(body),
          visibility: body.visibility ?? 'private',
        });
        await emitDomainEvent(tx, {
          type: 'recipe.created.v1',
          aggregateType: 'recipe',
          aggregateId: created.id,
          actorId: userId,
          payload: { method: created.method, visibility: created.visibility },
        });
        await recordBrewingAudit(tx, {
          actorId: userId,
          action: 'recipe.created',
          targetType: 'recipe',
          targetId: created.id,
          payload: { visibility: created.visibility },
        });
        return created;
      });

      return reply.status(201).send(repo.toRecipe(row));
    },
  );

  app.get<{ Params: { id: string } }>(
    `${prefix}/recipes/:id`,
    { schema: { params: idParams } },
    async (request) => {
      const actor = actorOf(request);
      const resource = await repo.findRecipeResource(db, request.params.id);
      // 404 for a missing row, 403 for one the caller may not read. That does
      // distinguish "exists but private" from "does not exist" — acceptable
      // because recipe ids are client-minted UUIDv7 and therefore unguessable,
      // and because the alternative (404 for everything) makes a legitimate
      // permission problem undebuggable for the user who hit it.
      if (!resource) throw notFound('Recipe not found.');
      await authorize(actor, 'read', RECIPE_RESOURCE, resource);
      const row = await repo.getRecipeRow(db, request.params.id);
      if (!row) throw notFound('Recipe not found.');
      return repo.toRecipe(row);
    },
  );

  /** §6.6: "forked from @anna's recipe, 2 changes" — permanent attribution. */
  app.get<{ Params: { id: string } }>(
    `${prefix}/recipes/:id/lineage`,
    { schema: { params: idParams } },
    async (request) => {
      const actor = actorOf(request);
      const resource = await repo.findRecipeResource(db, request.params.id);
      if (!resource) throw notFound('Recipe not found.');
      await authorize(actor, 'read', RECIPE_RESOURCE, resource);
      const row = await repo.getRecipeRow(db, request.params.id);
      if (!row) throw notFound('Recipe not found.');
      const parent = await repo.getRecipeLineage(db, row.id);
      return {
        recipe_id: row.id,
        parent_recipe_id: row.parent_recipe_id,
        changed_fields: row.changed_fields ?? [],
        change_count: (row.changed_fields ?? []).length,
        // Attribution survives even if the parent is now private: the id and the
        // author are the credit, the content is not disclosed.
        forked_from:
          parent !== null
            ? { id: parent.id, author_id: parent.author_id, title: parent.title }
            : null,
      };
    },
  );

  /**
   * Idempotent upsert with conflict-copy semantics (EF §2.2, REC-03/REC-07).
   * The id is the client's UUIDv7, so a retried offline sync lands on the same
   * row instead of creating a second recipe.
   */
  app.put<{ Params: { id: string }; Body: RecipeBody & { base_version?: number } }>(
    `${prefix}/recipes/:id`,
    { ...authed, schema: { params: idParams, body: recipePutBody } },
    async (request) => {
      const actor = actorOf(request);
      const userId = requireUserId(request);
      const body = request.body;
      assertParamsMatchMethod(body.method, body.params);

      const existing = await repo.findRecipeResource(db, request.params.id);
      if (existing) await authorize(actor, 'update', RECIPE_RESOURCE, existing);
      else await authorize(actor, 'create', RECIPE_RESOURCE);

      const outcome = await repo.upsertRecipe(
        db,
        {
          id: request.params.id,
          author_id: userId,
          ...recipeContent(body),
          visibility: body.visibility ?? existingVisibility(existing) ?? 'private',
        },
        body.base_version,
      );

      if (outcome.conflictCopy) {
        await withTransaction(db, async (tx) => {
          await emitDomainEvent(tx, {
            type: 'recipe.conflict_copy_created.v1',
            aggregateType: 'recipe',
            aggregateId: outcome.conflictCopy!.id,
            actorId: userId,
            payload: {
              conflict_of_recipe_id: outcome.row.id,
              changed_fields: outcome.conflictCopy!.changed_fields ?? [],
            },
          });
          await recordBrewingAudit(tx, {
            actorId: userId,
            action: 'recipe.conflict_copy_created',
            targetType: 'recipe',
            targetId: outcome.conflictCopy!.id,
            payload: { conflict_of_recipe_id: outcome.row.id },
          });
        });
      }
      return outcome.result;
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<RecipeBody> }>(
    `${prefix}/recipes/:id`,
    { ...authed, schema: { params: idParams, body: recipePatchBody } },
    async (request) => {
      const actor = actorOf(request);
      const userId = requireUserId(request);
      const resource = await repo.findRecipeResource(db, request.params.id);
      if (!resource) throw notFound('Recipe not found.');
      await authorize(actor, 'update', RECIPE_RESOURCE, resource);

      const existing = await repo.getRecipeRow(db, request.params.id);
      if (!existing) throw notFound('Recipe not found.');

      const body = request.body;
      const method = body.method ?? existing.method;
      if (body.params) assertParamsMatchMethod(method, body.params);

      const row = await repo.patchRecipe(db, existing, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.coffee_product_id !== undefined
          ? { coffee_product_id: body.coffee_product_id }
          : {}),
        ...(body.coffee_style !== undefined ? { coffee_style: body.coffee_style } : {}),
        ...(body.method !== undefined ? { method: body.method } : {}),
        ...(body.brewer_model_id !== undefined ? { brewer_model_id: body.brewer_model_id } : {}),
        ...(body.grind !== undefined ? { grind: normaliseGrind(body.grind) } : {}),
        ...(body.params !== undefined ? { params: normaliseParams(body.params) } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      });

      if (body.visibility !== undefined && body.visibility !== existing.visibility) {
        await recordBrewingAudit(db, {
          actorId: userId,
          action: 'recipe.visibility_changed',
          targetType: 'recipe',
          targetId: row.id,
          payload: { from: existing.visibility, to: row.visibility },
        });
      }
      return repo.toRecipe(row);
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${prefix}/recipes/:id`,
    { ...authed, schema: { params: idParams } },
    async (request, reply) => {
      const actor = actorOf(request);
      const userId = requireUserId(request);
      const resource = await repo.findRecipeResource(db, request.params.id);
      if (!resource) throw notFound('Recipe not found.');
      await authorize(actor, 'delete', RECIPE_RESOURCE, resource);
      await repo.softDeleteRecipe(db, resource.id);
      await recordBrewingAudit(db, {
        actorId: userId,
        action: 'recipe.deleted',
        targetType: 'recipe',
        targetId: resource.id,
      });
      return reply.status(204).send();
    },
  );

  /**
   * Fork (§6.6). A copy with `parent_recipe_id`, a real diff of what changed,
   * and permanent upstream attribution. You may fork anything you can READ —
   * that is what makes a public recipe a public recipe.
   */
  app.post<{ Params: { id: string }; Body: ForkBody }>(
    `${prefix}/recipes/:id/fork`,
    { ...authed, schema: { params: idParams, body: recipeForkBody } },
    async (request, reply) => {
      const actor = actorOf(request);
      const userId = requireUserId(request);
      const resource = await repo.findRecipeResource(db, request.params.id);
      if (!resource) throw notFound('Recipe not found.');
      await authorize(actor, 'read', RECIPE_RESOURCE, resource);
      await authorize(actor, 'create', RECIPE_RESOURCE);

      const parent = await repo.getRecipeRow(db, request.params.id);
      if (!parent) throw notFound('Recipe not found.');

      const body = request.body ?? {};
      const params = body.params ?? parent.params;
      // The method is inherited: a fork that swapped espresso for filter is a
      // different recipe, not a fork, and its diff would be meaningless.
      assertParamsMatchMethod(parent.method, params);

      const row = await withTransaction(db, async (tx) => {
        const fork = await repo.forkRecipe(tx, parent, {
          id: body.id ?? crypto.randomUUID(),
          author_id: userId,
          title: body.title ?? parent.title,
          coffee_product_id:
            body.coffee_product_id !== undefined
              ? body.coffee_product_id
              : parent.coffee_product_id,
          coffee_style:
            body.coffee_style !== undefined ? body.coffee_style : parent.coffee_style,
          method: parent.method,
          brewer_model_id:
            body.brewer_model_id !== undefined ? body.brewer_model_id : parent.brewer_model_id,
          grind: body.grind ?? parent.grind,
          params,
          visibility: body.visibility ?? 'private',
        });
        await emitDomainEvent(tx, {
          type: 'recipe.forked.v1',
          aggregateType: 'recipe',
          aggregateId: fork.id,
          actorId: userId,
          payload: {
            parent_recipe_id: parent.id,
            parent_author_id: parent.author_id,
            changed_fields: fork.changed_fields ?? [],
          },
        });
        await recordBrewingAudit(tx, {
          actorId: userId,
          action: 'recipe.forked',
          targetType: 'recipe',
          targetId: fork.id,
          payload: { parent_recipe_id: parent.id, parent_author_id: parent.author_id },
        });
        return fork;
      });

      // Tell the parent's author, AFTER the transaction has committed.
      //
      // Outside the transaction on purpose: the delivery ledger must record a
      // fork that actually exists, and a mail claim rolled back with a failed
      // commit would silently permit a duplicate later. Awaited but never
      // allowed to throw — nobody should lose a fork because we could not tell
      // its author about it. The notifications module decides whether the
      // author wants to hear; this code does not check preferences itself.
      if (parent.author_id && parent.author_id !== userId) {
        const forker = await findRecipient(defaultNotificationExec, userId).catch(() => null);
        await sendNotification(
          defaultNotificationExec,
          {
            userId: parent.author_id,
            type: 'recipe_forked',
            // One notification per fork, however many times this runs.
            dedupeKey: `recipe_forked:${row.id}`,
            subject: 'Someone built on your recipe',
            data: {
              recipe_title: parent.title,
              forker_handle: forker ? `@${forker.handle}` : 'Someone',
              recipe_url: `${getEnv().APP_URL}/recipes/${row.id}`,
            },
          },
          request.log,
        );
      }

      return reply.status(201).send(repo.toRecipe(row));
    },
  );

  // --- recipe reviews --------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    `${prefix}/recipes/:id/reviews`,
    { schema: { params: idParams } },
    async (request) => {
      const actor = actorOf(request);
      const resource = await repo.findRecipeResource(db, request.params.id);
      if (!resource) throw notFound('Recipe not found.');
      await authorize(actor, 'read', RECIPE_RESOURCE, resource);
      return { items: await repo.listRecipeReviews(db, resource.id) };
    },
  );

  app.put<{ Params: { id: string }; Body: { rating: number; body?: string | null } }>(
    `${prefix}/recipes/:id/reviews`,
    { ...authed, schema: { params: idParams, body: recipeReviewBody } },
    async (request) => {
      const actor = actorOf(request);
      const userId = requireUserId(request);
      const resource = await repo.findRecipeResource(db, request.params.id);
      if (!resource) throw notFound('Recipe not found.');
      await authorize(actor, 'read', RECIPE_RESOURCE, resource);
      return repo.upsertRecipeReview(db, {
        recipe_id: resource.id,
        user_id: userId,
        rating: request.body.rating,
        body: request.body.body ?? null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Brew sessions (BREW-01, BREW-04's server half)
  // -------------------------------------------------------------------------

  /**
   * Prefill — the reason a 15-second log is possible (brew_logger_ux §1/§3).
   * Registered before `/brews/:id` so the literal path always wins.
   */
  app.get<{ Querystring: { coffee_product_id?: string; method?: string } }>(
    `${prefix}/brews/prefill`,
    { ...authed, schema: { querystring: brewPrefillQuery } },
    async (request): Promise<BrewPrefill> => {
      const actor = actorOf(request);
      await authorize(actor, 'list', BREW_SESSION_RESOURCE);
      const userId = requireUserId(request);
      const coffee = request.query.coffee_product_id ?? null;
      const method = request.query.method ?? null;

      const found = await repo.findPrefill(db, {
        userId,
        coffeeProductId: coffee,
        method,
      });

      if (!found) {
        return {
          coffee_product_id: coffee,
          recipe_id: null,
          brewer_model_id: null,
          grinder_model_id: null,
          grind: defaultGrind(method ?? 'filter'),
          params: method === 'espresso' ? DEFAULT_ESPRESSO_PARAMS : DEFAULT_FILTER_PARAMS,
          basis: 'defaults',
        };
      }

      return {
        coffee_product_id: found.coffee_product_id ?? coffee,
        recipe_id: found.recipe_id,
        brewer_model_id: found.brewer_model_id,
        grinder_model_id: found.grinder_model_id,
        // §6.4: a setting read off someone else's grinder does not transfer. When
        // the prefill comes from a recipe ground on a different machine we keep
        // the CATEGORY (the only value that survives) and drop the number rather
        // than pretend it is the user's setting. The client can then ask
        // /grind-conversions/suggest for a starting point, with its disclaimer.
        grind: reconcileGrind(found.grind, found.grinder_model_id),
        params: found.params,
        basis: found.basis,
        ...(found.last_session_id !== null ? { last_session_id: found.last_session_id } : {}),
      };
    },
  );

  app.get<{
    Querystring: {
      coffee_product_id?: string;
      recipe_id?: string;
      from?: string;
      to?: string;
      cursor?: string;
      limit?: number;
    };
  }>(`${prefix}/brews`, { ...authed, schema: { querystring: brewListQuery } }, async (request) => {
    const actor = actorOf(request);
    await authorize(actor, 'list', BREW_SESSION_RESOURCE);
    const userId = requireUserId(request);
    const q = request.query;
    const limit = q.limit ?? 20;

    const rows = await repo.listBrewSessionRows(db, {
      userId,
      ...(q.coffee_product_id ? { coffeeProductId: q.coffee_product_id } : {}),
      ...(q.recipe_id ? { recipeId: q.recipe_id } : {}),
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit,
    });

    const visible = await filterReadable(actor, rows, (row) => ({
      id: row.id,
      userId: row.user_id,
      deleted: row.deleted_at !== null,
    }), BREW_SESSION_RESOURCE);

    const page = paginate(visible, limit, (row) => row.brewed_at);
    return { items: page.items.map(repo.toBrewSession), next_cursor: page.next_cursor };
  });

  app.get<{ Params: { id: string } }>(
    `${prefix}/brews/:id`,
    { ...authed, schema: { params: idParams } },
    async (request) => {
      const actor = actorOf(request);
      const resource = await repo.findBrewSessionResource(db, request.params.id);
      if (!resource || resource.deleted) throw notFound('Brew session not found.');
      await authorize(actor, 'read', BREW_SESSION_RESOURCE, resource);
      const row = await repo.getBrewSessionRow(db, request.params.id);
      if (!row) throw notFound('Brew session not found.');
      return repo.toBrewSession(row);
    },
  );

  /**
   * PUT /v1/brews/{client_id} — the idempotent upsert the offline queue replays
   * (EF §2.2). Same body twice is a NOOP, not a second row; an older payload
   * never overwrites a newer server revision (last-write-wins).
   */
  app.put<{ Params: { id: string }; Body: BrewBody }>(
    `${prefix}/brews/:id`,
    { ...authed, schema: { params: idParams, body: brewPutBody } },
    async (request) => {
      const actor = actorOf(request);
      const userId = requireUserId(request);
      const body = request.body;

      if (body.id !== undefined && body.id !== request.params.id) {
        throw badRequest('The id in the body does not match the id in the path.', {
          path_id: request.params.id,
          body_id: body.id,
        });
      }

      const existing = await repo.findBrewSessionResource(db, request.params.id);
      if (existing) await authorize(actor, 'update', BREW_SESSION_RESOURCE, existing);
      else await authorize(actor, 'create', BREW_SESSION_RESOURCE);

      // The 0008 FK only stops a DANGLING media id. This stops the IDOR:
      // attaching a photo that belongs to someone else, or one uploaded for a
      // different purpose (an avatar, a catalog image).
      if (body.photo_media_id) {
        await assertMediaUsable(db, body.photo_media_id, userId, 'brew_photo');
      }

      const outcome = await repo.upsertBrewSession(db, {
        id: request.params.id,
        user_id: userId,
        recipe_id: body.recipe_id ?? null,
        coffee_product_id: body.coffee_product_id ?? null,
        roast_batch_id: body.roast_batch_id ?? null,
        brewer_model_id: body.brewer_model_id ?? null,
        grinder_model_id: body.grinder_model_id ?? null,
        grind: normaliseGrind(body.grind),
        params: normaliseParams(body.params),
        water: body.water ?? null,
        taste: body.taste ?? null,
        measurements: body.measurements ?? null,
        rating: body.rating ?? null,
        changed_fields: body.changed_fields ?? null,
        source: body.source,
        photo_media_id: body.photo_media_id ?? null,
        // null = "unchanged" on an existing row, `now()` on a new one — see
        // resolveSession() in repository.ts. Defaulting here would break the
        // idempotency hash for a client that omits it.
        brewed_at: body.brewed_at ?? null,
        client_updated_at: body.updated_at ?? null,
      });

      if (outcome.result.applied !== 'noop') {
        await withTransaction(db, async (tx) => {
          await emitDomainEvent(tx, {
            type: 'brew.logged.v1',
            aggregateType: 'brew_session',
            aggregateId: outcome.row.id,
            actorId: userId,
            payload: {
              applied: outcome.result.applied,
              source: outcome.row.source,
              method: outcome.row.params.method,
              coffee_product_id: outcome.row.coffee_product_id,
              recipe_id: outcome.row.recipe_id,
              rating: outcome.row.rating,
              // Server-authoritative (§6.7) — consumers never re-derive it.
              diagnosis: diagnoseTaste(outcome.row.taste),
              changed_fields: outcome.row.changed_fields ?? [],
            },
          });
          if (outcome.grindObservation) {
            await emitDomainEvent(tx, {
              type: 'grind_conversion.confirmed.v1',
              aggregateType: 'grind_conversion',
              aggregateId: outcome.grindObservation.grind_conversion_id,
              actorId: userId,
              payload: {
                from_model_id: outcome.grindObservation.from_model_id,
                to_model_id: outcome.grindObservation.to_model_id,
                data_points: outcome.grindObservation.data_points,
              },
            });
          }
        });
      }

      return outcome.result;
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${prefix}/brews/:id`,
    { ...authed, schema: { params: idParams } },
    async (request, reply) => {
      const actor = actorOf(request);
      const userId = requireUserId(request);
      const resource = await repo.findBrewSessionResource(db, request.params.id);
      if (!resource) throw notFound('Brew session not found.');
      await authorize(actor, 'delete', BREW_SESSION_RESOURCE, resource);
      await withTransaction(db, async (tx) => {
        await repo.softDeleteBrewSession(tx, resource.id);
        await emitDomainEvent(tx, {
          type: 'brew.deleted.v1',
          aggregateType: 'brew_session',
          aggregateId: resource.id,
          actorId: userId,
        });
      });
      return reply.status(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // Sync (BREW-05)
  // -------------------------------------------------------------------------

  /**
   * The pull half of the offline protocol (EF §2.2). Returns ONLY the caller's
   * own rows — enforced twice: the repository scopes by user, and every row is
   * then re-checked through the policy layer before it is serialised. Tombstones
   * (`deleted: true`) are included so a deletion propagates.
   */
  app.get<{ Querystring: { since?: string; types?: string; limit?: number } }>(
    `${prefix}/sync/changes`,
    { ...authed, schema: { querystring: syncChangesQuery } },
    async (request): Promise<SyncChangesResponse> => {
      const actor = actorOf(request);
      await authorize(actor, 'list', BREW_SESSION_RESOURCE);
      await authorize(actor, 'list', RECIPE_RESOURCE);
      const userId = requireUserId(request);

      const types = parseSyncTypes(request.query.types);
      const limit = request.query.limit ?? 100;
      const since = request.query.since ? decodeCursor(request.query.since) : null;

      const collected: { key: string; id: string; change: SyncChange }[] = [];

      if (types.includes('brew_session')) {
        const rows = await repo.listSessionChanges(db, { userId, since, limit });
        for (const entry of rows) {
          const allowed = await can(actor, 'read', BREW_SESSION_RESOURCE, {
            id: entry.row.id,
            userId: entry.row.user_id,
            // A tombstone must reach its owner, so `deleted` is not a read block
            // here — the policy's owner check is what matters.
            deleted: false,
          });
          if (!allowed) continue;
          collected.push({
            key: isoOf(entry.updated_at),
            id: entry.id,
            change: {
              type: 'brew_session',
              id: entry.id,
              updated_at: isoOf(entry.updated_at),
              ...(entry.deleted
                ? { deleted: true }
                : { resource: repo.toBrewSession(entry.row) }),
            },
          });
        }
      }

      if (types.includes('recipe')) {
        const rows = await repo.listRecipeChanges(db, { userId, since, limit });
        for (const entry of rows) {
          const allowed = await can(actor, 'read', RECIPE_RESOURCE, {
            id: entry.row.id,
            authorId: entry.row.author_id,
            visibility: entry.row.visibility,
            isOfficial: entry.row.is_official,
            deleted: false,
          });
          if (!allowed) continue;
          collected.push({
            key: isoOf(entry.updated_at),
            id: entry.id,
            change: {
              type: 'recipe',
              id: entry.id,
              updated_at: isoOf(entry.updated_at),
              ...(entry.deleted ? { deleted: true } : { resource: repo.toRecipe(entry.row) }),
            },
          });
        }
      }

      // Both streams are ordered on the same key, so a merge keeps the total
      // order the cursor depends on.
      collected.sort((a, b) => (a.key === b.key ? cmp(a.id, b.id) : cmp(a.key, b.key)));

      const has_more = collected.length > limit;
      const page = has_more ? collected.slice(0, limit) : collected;
      const last = page[page.length - 1];
      const cursor = last
        ? encodeCursor({ ts: last.key, id: last.id })
        : (request.query.since ?? encodeCursor({ ts: new Date(0).toISOString(), id: ZERO_UUID }));

      return { changes: page.map((entry) => entry.change), cursor, has_more };
    },
  );

  // -------------------------------------------------------------------------
  // Grind conversion suggestion (§6.4, GC-03)
  // -------------------------------------------------------------------------

  /**
   * The read path for the crowd-sourced conversion table. It goes through
   * catalog's PUBLIC interface (`listGrindConversions`) rather than querying
   * `grind_conversions` here — catalog owns that table (EF §1.2).
   *
   * `confidence`, `sample_size` and `disclaimer` are ALWAYS present, including
   * when there is no data at all: §6.4 point 4 forbids presenting a converted
   * setting as exact, and a zero-data answer that looks confident is exactly the
   * failure mode risk #9 describes.
   */
  app.get<{
    Querystring: {
      from_model_id: string;
      from_setting?: string;
      to_model_id: string;
      category: GrindCategory;
    };
  }>(
    `${prefix}/grind-conversions/suggest`,
    { schema: { querystring: grindSuggestQuery } },
    async (request): Promise<GrindConversionSuggestion> => {
      await authorize(actorOf(request), 'read', GRIND_SUGGESTION_RESOURCE);
      const { from_model_id, from_setting, to_model_id, category } = request.query;
      if (from_model_id === to_model_id) {
        throw badRequest('A grinder does not need converting to itself.');
      }

      const items = await listGrindConversions(db, {
        fromModelId: from_model_id,
        toModelId: to_model_id,
      });

      const match = pickConversion(items, from_setting);
      if (!match) {
        return {
          to_model_id,
          suggested_setting: null,
          category,
          confidence: 0,
          sample_size: 0,
          source: 'category_only',
          disclaimer: CATEGORY_ONLY_DISCLAIMER,
        };
      }

      return {
        to_model_id,
        suggested_setting: match.to_setting,
        category,
        confidence: match.uncertainty.confidence,
        sample_size: match.uncertainty.sample_size,
        source: match.uncertainty.source,
        disclaimer: GRIND_DISCLAIMER,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Handler helpers
// ---------------------------------------------------------------------------

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface RecipeBody {
  title: string;
  coffee_product_id?: string | null;
  coffee_style?: string | null;
  method: BrewParams['method'];
  brewer_model_id?: string | null;
  grind: GrindSetting;
  params: BrewParams;
  visibility?: RecipeVisibility;
}

interface ForkBody {
  id?: string;
  title?: string;
  coffee_product_id?: string | null;
  coffee_style?: string | null;
  brewer_model_id?: string | null;
  grind?: GrindSetting;
  params?: BrewParams;
  visibility?: RecipeVisibility;
}

interface BrewBody {
  id?: string;
  recipe_id?: string | null;
  coffee_product_id?: string | null;
  roast_batch_id?: string | null;
  brewer_model_id?: string | null;
  grinder_model_id?: string | null;
  grind: GrindSetting;
  params: BrewParams;
  water?: WaterProfile;
  taste?: TasteResult;
  measurements?: Measurements;
  rating?: number;
  changed_fields?: string[];
  source: BrewSource;
  photo_media_id?: string | null;
  brewed_at?: string;
  updated_at?: string;
}

const recipeContent = (body: RecipeBody) => ({
  title: body.title,
  coffee_product_id: body.coffee_product_id ?? null,
  coffee_style: body.coffee_style ?? null,
  method: body.method,
  brewer_model_id: body.brewer_model_id ?? null,
  grind: normaliseGrind(body.grind),
  params: normaliseParams(body.params),
});

const existingVisibility = (
  resource: { visibility: RecipeVisibility } | null,
): RecipeVisibility | null => resource?.visibility ?? null;

/**
 * Drops any row the policy layer would refuse. A list query's WHERE clause and
 * its policy must agree; when they do this is a no-op, and when a future edit
 * makes them disagree it fails CLOSED instead of leaking.
 */
async function filterReadable<TRow, TResource>(
  actor: Actor,
  rows: TRow[],
  toResource: (row: TRow) => TResource,
  resourceType: string = RECIPE_RESOURCE,
): Promise<TRow[]> {
  const out: TRow[] = [];
  for (const row of rows) {
    if (await can(actor, 'read', resourceType, toResource(row))) out.push(row);
  }
  return out;
}

/**
 * §6.4: a grind setting only means something on the grinder it was read from.
 * When the prefill's grind came from a different machine than the user's, keep
 * the category and drop the number.
 */
function reconcileGrind(grind: GrindSetting, userGrinderId: string | null): GrindSetting {
  if (grind.equipment_model_id === null) return grind;
  if (userGrinderId === null || grind.equipment_model_id === userGrinderId) return grind;
  return {
    equipment_model_id: userGrinderId,
    setting: null,
    scale_type: null,
    category: grind.category,
  };
}

const ALL_SYNC_TYPES: SyncResourceType[] = ['brew_session', 'recipe'];

function parseSyncTypes(raw: string | undefined): SyncResourceType[] {
  if (raw === undefined) return ALL_SYNC_TYPES;
  const requested = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const unknown = requested.filter((t) => !ALL_SYNC_TYPES.includes(t as SyncResourceType));
  if (unknown.length > 0) {
    throw badRequest(`Unknown sync type(s): ${unknown.join(', ')}`, { allowed: ALL_SYNC_TYPES });
  }
  return requested.length > 0 ? (requested as SyncResourceType[]) : ALL_SYNC_TYPES;
}

type CatalogConversion = Awaited<ReturnType<typeof listGrindConversions>>[number];

/**
 * Picks the row to convert from: an exact setting match when the caller gave
 * one, otherwise the nearest numeric setting, otherwise the highest-confidence
 * row for the pair. Never invents a value — if the list is empty the caller
 * falls back to the category-only answer.
 */
function pickConversion(
  items: CatalogConversion[],
  fromSetting: string | undefined,
): CatalogConversion | null {
  if (items.length === 0) return null;
  if (fromSetting === undefined) return items[0] ?? null;

  const exact = items.find((item) => item.from_setting === fromSetting);
  if (exact) return exact;

  const target = Number(fromSetting);
  if (!Number.isFinite(target)) return items[0] ?? null;

  let best: CatalogConversion | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const value = Number(item.from_setting);
    if (!Number.isFinite(value)) continue;
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best ?? items[0] ?? null;
}
