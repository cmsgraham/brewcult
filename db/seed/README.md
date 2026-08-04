# @brewcult/seed — deterministic dev seed

Populates a migrated BrewCult database with catalog seed data:
roasters, origins, farms, coffee lots/products, equipment brands/models
(grinders carry their `grind_scale_type`), and low-confidence seeded
grind-setting conversions (`source = 'seeded'`).

The script upserts by natural keys (slugs, `(country, region)`,
`(origin_id, name)`, the conversion 4-tuple), so it is **safe to re-run**:
row uuids are stable across runs, and edits to the JSON files overwrite the
corresponding rows in place. `user_confirmed` grind conversions are never
overwritten by re-seeding.

## Prerequisites

- The dev compose stack running (Lane B: `infra/`), with migrations applied
  by `db/migrate.sh` (files in `db/migrations/` in filename order).
- Node.js >= 22.6 (for `--experimental-strip-types`) — or use `npx tsx`.

## Run

```sh
cd db/seed
npm install            # installs the single dependency: pg
npm run seed
```

Against the dev compose database the default connection string already
matches; to target something else set `DATABASE_URL`:

```sh
# default (dev compose):
DATABASE_URL=postgres://brewcult:brewcult@localhost:5433/brewcult npm run seed
```

On success it prints per-table row counts, e.g.:

```
Seed complete (rows processed):
  roasters           5
  origins            8
  farms              8
  coffee_lots        20
  coffee_products    20
  equipment_brands   24
  equipment_models   31
  grind_conversions  26
```

(`coffee_lots` only counts *newly inserted* lots — on re-runs existing lots
are updated through their owning product, so the count drops to 0.)

## Data files

| File | Contents |
|---|---|
| `data/roasters.json` | 5 specialty roasters |
| `data/origins.json` | 8 origins (country/region) |
| `data/farms.json` | 8 farms / washing stations, referenced as `"Country\|Region"` |
| `data/coffee_products.json` | 20 products, each embedding its green-coffee lot |
| `data/equipment.json` | 31 equipment models (15 grinders with `grind_scale_type`, 9 brewers, 3 espresso machines, 2 kettles, 2 scales); brands are derived from this file |
| `data/grind_conversions.json` | 26 seeded grinder-setting conversion pairs, confidence 0.3–0.6 |

Enum values in the JSON must match the CHECK constraints in
`db/migrations/0003_catalog.sql` (`roast_level`, `intended_use`, `process`,
`status`, `category`, `grind_scale_type`) — the insert fails loudly otherwise,
which is intended.
