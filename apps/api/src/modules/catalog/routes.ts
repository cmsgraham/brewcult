/**
 * Catalog HTTP surface (second_draft §22 "Catalog", backlog CAT-04..CAT-07).
 *
 * Handlers do three things and nothing else: resolve the actor through
 * `authorize()` (EF §3.2), hand validated input to the repository, and return
 * DTOs. No SQL, no ownership `if`s, no ad-hoc validation — those live in
 * `repository.ts`, `policies.ts` and `schemas.ts` respectively.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorize } from '../../lib/policy.js';
import { badRequest, notFound, unauthorized } from '../../lib/errors.js';
import { actorOf, loadRequireAuth } from './auth-seam.js';
import {
  deleteCoffeeReview,
  listCoffeeReviews,
  ratingSummary,
  toggleHelpful,
  upsertCoffeeReview,
} from './coffee-reviews.js';
import * as repo from './repository.js';
import { defaultCatalogDb, type CatalogDb } from './repository.js';
import { assertValidSlug, normaliseQuery, slugify } from './text.js';
import {
  autocompleteQuery,
  coffeeCreateBody,
  coffeeListQuery,
  coffeeUpdateBody,
  equipmentCreateBody,
  equipmentListQuery,
  equipmentUpdateBody,
  grindConversionQuery,
  idParams,
  roasterCreateBody,
  roasterListQuery,
  roasterUpdateBody,
  searchQuery,
  slugParams,
} from './schemas.js';
import type {
  CoffeeStatus,
  EquipmentCategory,
  GrindConversionResponse,
  GrindScaleType,
  IntendedUse,
  LotProcess,
  RoastLevel,
} from './types.js';

export interface CatalogRouteOptions {
  /** Database seam; defaults to the shared pool. Tests inject PGlite. */
  db?: CatalogDb;
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

type EntityType = 'coffee' | 'roaster' | 'equipment';

const ALL_ENTITY_TYPES: EntityType[] = ['coffee', 'roaster', 'equipment'];

/** Parses the comma-separated `types=` parameter of the autocomplete endpoint. */
function parseTypes(raw: string | undefined): EntityType[] {
  if (raw === undefined) return ALL_ENTITY_TYPES;
  const requested = raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  const unknown = requested.filter((t) => !ALL_ENTITY_TYPES.includes(t as EntityType));
  if (unknown.length > 0) {
    throw badRequest(`Unknown entity type(s): ${unknown.join(', ')}`, {
      allowed: ALL_ENTITY_TYPES,
    });
  }
  return requested.length > 0 ? (requested as EntityType[]) : ALL_ENTITY_TYPES;
}

/** Client-supplied slug wins (editors curate URLs); otherwise derive from name. */
function resolveSlug(supplied: string | undefined, name: string): string {
  return supplied !== undefined ? assertValidSlug(supplied) : slugify(name);
}

export async function registerCatalogRoutes(
  app: FastifyInstance,
  options: CatalogRouteOptions = {},
): Promise<void> {
  const db = options.db ?? defaultCatalogDb;
  const prefix = options.prefix ?? '/v1';
  const requireAuth = await loadRequireAuth();

  /** Every editorial route: authenticated (401) then staff-checked (403). */
  const editorial = { preHandler: [requireAuth] };
  /**
   * A signed-in member write. Named apart from `editorial` on purpose: that one
   * guards catalogue edits and reads as staff-shaped, and a reviewer skimming
   * for "who may write here" should not have to check which is which.
   */
  const mutation = { preHandler: [requireAuth] };

  const auditEditorial = (
    request: FastifyRequest,
    action: string,
    resourceType: string,
    resourceId: string,
  ): void => {
    // The append-only audit_log table belongs to the identity module (0002), and
    // EF §1.2 forbids reaching into another module's tables. Until identity
    // exposes a `recordAuditEvent` interface this is a structured log line —
    // flagged in the lane report as an integration follow-up for CAT-05.
    request.log.info(
      { audit: true, action, resourceType, resourceId, actor: actorOf(request).userId },
      'catalog editorial mutation',
    );
  };

  // -------------------------------------------------------------------------
  // Coffees
  // -------------------------------------------------------------------------

  app.get<{
    Querystring: {
      roaster?: string;
      origin?: string;
      process?: LotProcess;
      roast_level?: RoastLevel;
      intended_use?: IntendedUse;
      status?: CoffeeStatus;
      cursor?: string;
      limit?: number;
    };
  }>(`${prefix}/coffees`, { schema: { querystring: coffeeListQuery } }, async (request) => {
    await authorize(actorOf(request), 'list', 'coffee_product');
    const q = request.query;
    return repo.listCoffees(db, { ...q, limit: q.limit ?? 20 });
  });

  app.get<{ Params: { slug: string } }>(
    `${prefix}/coffees/:slug`,
    { schema: { params: slugParams } },
    async (request) => {
      await authorize(actorOf(request), 'read', 'coffee_product');
      return repo.getCoffeeBySlug(db, request.params.slug);
    },
  );

  // -------------------------------------------------------------------------
  // Roasters
  // -------------------------------------------------------------------------

  app.get<{ Querystring: { verified?: boolean; cursor?: string; limit?: number } }>(
    `${prefix}/roasters`,
    { schema: { querystring: roasterListQuery } },
    async (request) => {
      await authorize(actorOf(request), 'list', 'roaster');
      const q = request.query;
      return repo.listRoasters(db, { ...q, limit: q.limit ?? 20 });
    },
  );


  // -------------------------------------------------------------------------
  // Notes on a coffee (0016).
  //
  // Reads are PUBLIC — a coffee page with its notes hidden behind a login is a
  // page search engines and undecided visitors see as empty. Writes need an
  // account, and each one is scoped to its author by the row itself.
  // -------------------------------------------------------------------------

  /** Resolves a slug to an id, or 404s. Every route below starts here. */
  const coffeeIdFor = async (slug: string): Promise<string> => {
    const coffee = await repo.getCoffeeBySlug(db, slug);
    return coffee.id;
  };

  app.get<{ Params: { slug: string } }>(
    `${prefix}/coffees/:slug/reviews`,
    { schema: { params: slugParams } },
    async (request) => {
      await authorize(actorOf(request), 'read', 'coffee_product');
      const coffeeId = await coffeeIdFor(request.params.slug);
      const viewer = actorOf(request).userId;
      return {
        items: await listCoffeeReviews(db, coffeeId, viewer),
        summary: await ratingSummary(db, coffeeId),
      };
    },
  );

  app.put<{
    Params: { slug: string };
    Body: { rating?: number; body?: string; brew_method?: string };
  }>(`${prefix}/coffees/:slug/reviews/mine`, mutation, async (request) => {
    const userId = actorOf(request).userId;
    if (userId === null) throw unauthorized();

    const coffeeId = await coffeeIdFor(request.params.slug);
    const review = await upsertCoffeeReview(db, {
      coffeeProductId: coffeeId,
      userId,
      rating: Number(request.body?.rating),
      body: request.body?.body ?? null,
      brewMethod: request.body?.brew_method ?? null,
    });
    return {
      review,
      items: await listCoffeeReviews(db, coffeeId, userId),
      summary: await ratingSummary(db, coffeeId),
    };
  });

  app.delete<{ Params: { slug: string } }>(
    `${prefix}/coffees/:slug/reviews/mine`,
    mutation,
    async (request) => {
      const userId = actorOf(request).userId;
      if (userId === null) throw unauthorized();

      const coffeeId = await coffeeIdFor(request.params.slug);
      const mine = (await listCoffeeReviews(db, coffeeId, userId)).find((r) => r.is_mine);
      if (!mine || !(await deleteCoffeeReview(db, mine.id, userId))) {
        throw notFound('You have not left a note on this one.');
      }
      return {
        items: await listCoffeeReviews(db, coffeeId, userId),
        summary: await ratingSummary(db, coffeeId),
      };
    },
  );

  app.post<{ Params: { slug: string; id: string } }>(
    `${prefix}/coffees/:slug/reviews/:id/helpful`,
    mutation,
    async (request) => {
      const userId = actorOf(request).userId;
      if (userId === null) throw unauthorized();

      const result = await toggleHelpful(db, request.params.id, userId);
      if (result === 'not_found') throw notFound('That note has gone.');
      if (result === 'own_review') {
        throw badRequest('You cannot mark your own note useful — everybody would.');
      }

      const coffeeId = await coffeeIdFor(request.params.slug);
      return {
        voted: result === 'added',
        items: await listCoffeeReviews(db, coffeeId, userId),
        summary: await ratingSummary(db, coffeeId),
      };
    },
  );

  app.get<{ Params: { slug: string } }>(
    `${prefix}/roasters/:slug`,
    { schema: { params: slugParams } },
    async (request) => {
      await authorize(actorOf(request), 'read', 'roaster');
      return repo.getRoasterBySlug(db, request.params.slug);
    },
  );

  // -------------------------------------------------------------------------
  // Equipment
  // -------------------------------------------------------------------------

  app.get<{
    Querystring: { category?: EquipmentCategory; brand?: string; cursor?: string; limit?: number };
  }>(`${prefix}/equipment`, { schema: { querystring: equipmentListQuery } }, async (request) => {
    await authorize(actorOf(request), 'list', 'equipment_model');
    const q = request.query;
    return repo.listEquipment(db, { ...q, limit: q.limit ?? 20 });
  });

  // Registered before `/equipment/:slug` would ever be consulted for it; kept on
  // a separate path so no equipment model can shadow it with slug "brands".
  app.get(`${prefix}/equipment-brands`, async (request) => {
    await authorize(actorOf(request), 'list', 'equipment_model');
    return { items: await repo.listEquipmentBrands(db) };
  });

  app.get<{ Params: { slug: string } }>(
    `${prefix}/equipment/:slug`,
    { schema: { params: slugParams } },
    async (request) => {
      await authorize(actorOf(request), 'read', 'equipment_model');
      return repo.getEquipmentBySlug(db, request.params.slug);
    },
  );

  // -------------------------------------------------------------------------
  // Origins
  // -------------------------------------------------------------------------

  app.get(`${prefix}/origins`, async (request) => {
    await authorize(actorOf(request), 'list', 'coffee_product');
    return { items: await repo.listOrigins(db) };
  });

  // -------------------------------------------------------------------------
  // Search (CAT-07) and autocomplete (CAT-06)
  // -------------------------------------------------------------------------

  app.get<{ Querystring: { q: string; type?: EntityType | 'all'; limit?: number } }>(
    `${prefix}/search`,
    { schema: { querystring: searchQuery } },
    async (request) => {
      await authorize(actorOf(request), 'list', 'coffee_product');
      const q = normaliseQuery(request.query.q);
      if (q.length === 0) throw badRequest('Search query must contain a non-space character.');
      const type = request.query.type;
      const types = type === undefined || type === 'all' ? ALL_ENTITY_TYPES : [type];
      const items = await repo.search(db, { q, types, limit: request.query.limit ?? 20 });
      return { query: q, items };
    },
  );

  app.get<{ Querystring: { q: string; types?: string; limit?: number } }>(
    `${prefix}/autocomplete`,
    { schema: { querystring: autocompleteQuery } },
    async (request) => {
      await authorize(actorOf(request), 'list', 'coffee_product');
      const q = normaliseQuery(request.query.q);
      if (q.length === 0) throw badRequest('Autocomplete query must contain a non-space character.');
      const items = await repo.autocomplete(db, {
        q,
        types: parseTypes(request.query.types),
        limit: request.query.limit ?? 10,
      });
      return { query: q, items };
    },
  );

  // -------------------------------------------------------------------------
  // Grind conversions (§6.4)
  // -------------------------------------------------------------------------

  app.get<{ Querystring: { from_model_id: string; to_model_id?: string } }>(
    `${prefix}/grind-conversions`,
    { schema: { querystring: grindConversionQuery } },
    async (request): Promise<GrindConversionResponse> => {
      await authorize(actorOf(request), 'list', 'equipment_model');
      const { from_model_id, to_model_id } = request.query;

      const from = await repo.getEquipmentById(db, from_model_id);
      if (!from) throw notFound('Source grinder not found.');
      if (to_model_id !== undefined) {
        const to = await repo.getEquipmentById(db, to_model_id);
        if (!to) throw notFound('Target grinder not found.');
      }

      const items = await repo.listGrindConversions(db, {
        fromModelId: from_model_id,
        toModelId: to_model_id,
      });
      return { items, disclaimer: GRIND_DISCLAIMER };
    },
  );

  // -------------------------------------------------------------------------
  // Editorial CRUD (CAT-05) — staff only, MFA enforced by `isStaff`
  // -------------------------------------------------------------------------

  app.post<{
    Body: { name: string; slug?: string; location?: string | null; verified?: boolean };
  }>(
    `${prefix}/roasters`,
    { ...editorial, schema: { body: roasterCreateBody } },
    async (request, reply) => {
      await authorize(actorOf(request), 'create', 'roaster');
      const body = request.body;
      const created = await repo.insertRoaster(db, {
        name: body.name,
        slug: resolveSlug(body.slug, body.name),
        location: body.location ?? null,
        verified: body.verified,
      });
      auditEditorial(request, 'create', 'roaster', created.id);
      return reply.status(201).send(created);
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; slug?: string; location?: string | null; verified?: boolean };
  }>(
    `${prefix}/roasters/:id`,
    { ...editorial, schema: { params: idParams, body: roasterUpdateBody } },
    async (request) => {
      await authorize(actorOf(request), 'update', 'roaster');
      const body = request.body;
      const updated = await repo.updateRoaster(db, request.params.id, {
        ...body,
        ...(body.slug !== undefined ? { slug: assertValidSlug(body.slug) } : {}),
      });
      auditEditorial(request, 'update', 'roaster', updated.id);
      return updated;
    },
  );

  app.post<{
    Body: {
      roaster_id: string;
      coffee_lot_id?: string | null;
      name: string;
      slug?: string;
      roast_level: RoastLevel;
      intended_use: IntendedUse;
      tasting_notes?: string[];
      status?: CoffeeStatus;
    };
  }>(
    `${prefix}/coffees`,
    { ...editorial, schema: { body: coffeeCreateBody } },
    async (request, reply) => {
      await authorize(actorOf(request), 'create', 'coffee_product');
      const body = request.body;
      const created = await repo.insertCoffee(db, {
        ...body,
        slug: resolveSlug(body.slug, body.name),
      });
      auditEditorial(request, 'create', 'coffee_product', created.id);
      return reply.status(201).send(created);
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      roaster_id?: string;
      coffee_lot_id?: string | null;
      name?: string;
      slug?: string;
      roast_level?: RoastLevel;
      intended_use?: IntendedUse;
      tasting_notes?: string[];
      status?: CoffeeStatus;
    };
  }>(
    `${prefix}/coffees/:id`,
    { ...editorial, schema: { params: idParams, body: coffeeUpdateBody } },
    async (request) => {
      await authorize(actorOf(request), 'update', 'coffee_product');
      const body = request.body;
      const updated = await repo.updateCoffee(db, request.params.id, {
        ...body,
        ...(body.slug !== undefined ? { slug: assertValidSlug(body.slug) } : {}),
      });
      auditEditorial(request, 'update', 'coffee_product', updated.id);
      return updated;
    },
  );

  app.post<{
    Body: {
      brand_id: string;
      category: EquipmentCategory;
      name: string;
      slug?: string;
      specs?: Record<string, unknown>;
      grind_scale_type?: GrindScaleType | null;
    };
  }>(
    `${prefix}/equipment`,
    { ...editorial, schema: { body: equipmentCreateBody } },
    async (request, reply) => {
      await authorize(actorOf(request), 'create', 'equipment_model');
      const body = request.body;
      const created = await repo.insertEquipmentModel(db, {
        ...body,
        slug: resolveSlug(body.slug, `${body.name}`),
      });
      auditEditorial(request, 'create', 'equipment_model', created.id);
      return reply.status(201).send(created);
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      brand_id?: string;
      category?: EquipmentCategory;
      name?: string;
      slug?: string;
      specs?: Record<string, unknown>;
      grind_scale_type?: GrindScaleType | null;
    };
  }>(
    `${prefix}/equipment/:id`,
    { ...editorial, schema: { params: idParams, body: equipmentUpdateBody } },
    async (request) => {
      await authorize(actorOf(request), 'update', 'equipment_model');
      const body = request.body;
      const updated = await repo.updateEquipmentModel(db, request.params.id, {
        ...body,
        ...(body.slug !== undefined ? { slug: assertValidSlug(body.slug) } : {}),
      });
      auditEditorial(request, 'update', 'equipment_model', updated.id);
      return updated;
    },
  );
}
