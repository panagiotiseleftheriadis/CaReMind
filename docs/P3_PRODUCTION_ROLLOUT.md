# P3 production rollout rehearsal and runbook

Status: preparation only, 2026-09-23. This runbook does not authorize a production migration, merge, deployment, environment-variable change, or archive activation. Commands below are for a later explicitly approved rehearsal or production window. Never paste connection strings, passwords, tokens, or query output containing customer data into Git, tickets, or chat.

The reviewed V2 commit is `b5138c05c04819538d42b1fe63f2d47a7c14ca0c` on `feature/caremind-v2`.

## 1. Repository-derived deployment model

### What the repository establishes

- The frontend is a separate static Vercel project. [`frontend/vercel.json`](../frontend/vercel.json) permanently redirects `/index.html` to `/`, `/login.html` to `/login`, and any other one-segment `/:path*.html` to `/:path`. It rewrites `/` to `/index.html`, `/login` to `/login.html`, and `/:path` to `/:path.html`.
- The documented backend is a separate Vercel project whose Root Directory is `backend` and whose framework preset is Other. There is intentionally no backend `vercel.json` and no Edge `middleware.js`; Vercel auto-detects the exported Express app in `backend/server.js`.
- `backend/package.json` defines `vercel-build` as `npm run db:migrate`, and `db:migrate` as `node scripts/migrate.js`. Therefore every backend deployment whose Vercel build settings honor this package script attempts all pending migrations during its build. A manual migration before deployment does not suppress the build hook; the later build should run the migrator again and no-op.
- GitHub Actions runs checks and disposable PostgreSQL tests but contains no deployment job.
- Git itself does not define a Vercel Production Branch. The repository does not contain linked `.vercel` project metadata or dashboard settings.

### Manual dashboard checks required

The following cannot be determined from repository configuration:

| Question | Required check |
| --- | --- |
| Which Git branch each live Vercel project deploys to Production | **MANUAL DASHBOARD CHECK REQUIRED:** in both frontend and backend projects, inspect Settings -> Git -> Production Branch. Record the exact value and project ID/name. |
| Whether `main` is currently the Production Branch | **MANUAL DASHBOARD CHECK REQUIRED:** do not infer this from the local `main` branch or Vercel's common default. |
| Whether the backend Build Command is overridden or migration builds are skipped | **MANUAL DASHBOARD CHECK REQUIRED:** inspect the backend project's Build & Development Settings and deployment logs. |
| Which Neon project, branch, database, role, and endpoint the live variables address | **MANUAL DASHBOARD CHECK REQUIRED:** compare Vercel variable targets with Neon Connection Details without exposing values. |
| Whether migration 003 is already present in production | **MANUAL DATABASE CHECK REQUIRED:** use the read-only ledger/schema queries in this runbook against a separately confirmed target. |
| Whether a scheduler or other external caller exists | **MANUAL DASHBOARD CHECK REQUIRED:** no scheduler configuration is checked into this repository. |

Do not proceed merely because Vercel normally treats `main` as Production. The actual dashboard setting is authoritative.

### Runtime database configuration

`backend/db.js` creates a `pg.Pool` from `DATABASE_URL`:

- `DATABASE_URL` is required when `NODE_ENV=production`; a Neon pooled URL is appropriate for application traffic.
- TLS is enabled when `DB_SSL=true` or the URL contains `neon.tech` or `sslmode=require`. The current runtime setting uses `rejectUnauthorized: false`; migration TLS is configured independently and more strictly.
- `DB_POOL_MAX` defaults to 5 connections per serverless instance. Idle and connection timeouts are 30 seconds and 10 seconds.
- The runtime adapter parses PostgreSQL DATE values as `YYYY-MM-DD` strings and safe BIGINT IDs as JavaScript numbers.

`MIGRATION_DATABASE_URL` has a deliberately separate contract in `backend/scripts/migration-config.js`:

- It is mandatory in production, CI, Vercel, and for every remote migration. Only nonproduction loopback development may fall back to `DATABASE_URL`.
- It must be a PostgreSQL URL with explicit user and database and a direct/non-pooled endpoint. Known `pooler` or `pgbouncer` hostname labels, including Neon `-pooler` hosts, are rejected before connection.
- The runner cannot detect arbitrary aliases, proxies, or tunnels. The operator must match the endpoint to the intended Neon branch in the dashboard.
- Only `sslmode` and optional `channel_binding=prefer` URL parameters are accepted, each at most once. Remote `sslmode=disable`, fragments, host/database overrides, and `channel_binding=require` are rejected.
- Remote migration TLS verifies certificates and hostnames. The connection uses the `public` schema, a 10-second connection timeout, 60-second statement timeout, 65-second query timeout, and application name `caremind-migrations`.
- Runtime and migration URLs must address the same Neon branch and database, but the runtime URL may be pooled while the migration URL must be direct.

The migration runner uses one dedicated `pg.Client`, obtains a session advisory lock, creates/reads `schema_migrations`, validates each applied file's SHA-256 checksum, and runs each pending file plus ledger insert in one transaction. Files are sorted lexicographically. Running it twice is intended to be safe.

## 2. Schema/application compatibility finding

Migration 003 is additive. It adds nullable `registration_plate`, `registration_country`, `make`, `vin`, `fuel_type`, `purchase_date`, `purchase_amount`, `currency`, nullable `archived_at`, and `revision INTEGER NOT NULL DEFAULT 1`; it adds CHECK constraints and a partial active-vehicle index. It does not remove, rename, relax, or rewrite a legacy column, ID, foreign key, chassis value, mileage value, maintenance row, or cost row.

### Runtime queries that require migration 003

Every checked-in runtime SQL reference to a 003 column is listed here:

| Runtime file/path | 003-column dependency |
| --- | --- |
| `backend/routes/vehicles.js` `VEHICLE_PROJECTION` | Selects every identity/purchase column, `archived_at`, derived state, and `revision`; this projection is used by list, create response, detail, PUT response, PATCH response, archive, and restore. |
| `backend/routes/vehicles.js` list | Filters on `archived_at` for explicit/default active and archived states. |
| `backend/routes/vehicles.js` create/PATCH | May insert/update the new optional fields. |
| `backend/routes/vehicles.js` PUT/PATCH | Increments `revision`. |
| `backend/routes/vehicles.js` archive/restore | Updates `archived_at` and increments `revision`. |
| `backend/vehicle-ownership.js` | `findOwnedVehicle` selects `archived_at` and `revision`; PATCH/archive/restore use it. |
| `backend/routes/notifications.js` | Excludes rows whose vehicle has non-null `archived_at`. |
| `backend/routes/cron.js` | Excludes rows whose vehicle has non-null `archived_at`. |

Consequences verified from actual code:

- **New P3a/P3b application code before 003: unsafe.** Ordinary vehicle list/create/detail responses, PUT/PATCH, notification reads, and cron evaluation can fail with undefined-column errors even with `VEHICLE_ARCHIVE_ENABLED=false`. The flag gates archive transitions, the default list behavior, and legacy DELETE protection; it does not remove the new-column SQL dependencies.
- **Old application code after 003: schema-compatible.** The old code selects/writes only legacy columns. Its INSERT statements can omit the nullable fields and receive `revision=1`; legacy SELECT/UPDATE/DELETE statements remain valid. Integration coverage includes an old-style writer after 003.
- **Operational qualification:** old code is not safe after any vehicle has actually been archived. It does not filter `archived_at`, treats archived vehicles as active, includes them in reminders, and retains physical DELETE behavior. Therefore `old code + new schema` is a valid migration/deployment bridge only before archive activation and before any archived row exists.

## 3. Confirmed safe rollout order

1. Confirm the exact live Vercel projects, Production Branches, Neon production branch/database, current deployment commit, and current migration ledger. This is read-only.
2. Create a temporary Neon branch named `p3-rollout-rehearsal` from the **head/current state** of the confirmed production Neon branch.
3. Record the branch creation timestamp and obtain two branch-specific URLs: a pooled runtime URL and a direct migration URL.
4. Run the pre-migration SQL against the rehearsal branch and save results outside Git. Stop unless 001 and 002 are present with expected checksums and 003 is absent.
5. Apply migrations to the rehearsal direct URL. Expect 001/002 to skip and only 003 to run.
6. Run all post-migration SQL, then run the migrator a second time and require a complete no-op.
7. Run commit `b5138c05c04819538d42b1fe63f2d47a7c14ca0c` locally, or in a fully isolated Preview, with both database URLs targeting the rehearsal branch and `VEHICLE_ARCHIVE_ENABLED=true`. Complete the rehearsal checks.
8. Review rehearsal evidence, timings, logs, migration lock behavior, and any anomalies. Delete the rehearsal branch only after evidence is retained appropriately.
9. In a separately authorized production window, create and record a production checkpoint/restore point before any schema change.
10. Keep the current old application serving while running migration 003 once against the explicitly confirmed production **direct** URL.
11. Verify production schema/data read-only, then run the migrator a second time and require a no-op.
12. Deploy the V2 commit with `VEHICLE_ARCHIVE_ENABLED=false`. Its deployment build will also invoke the migrator and must no-op.
13. Complete the archive-OFF production smoke checks and confirm all serving instances are archive-aware; drain old instances.
14. Set `VEHICLE_ARCHIVE_ENABLED=true` for the backend Production environment and create a new deployment/redeployment.
15. Using only a controlled disposable test vehicle, archive, verify retained history, restore, and verify that no DELETE occurred.

Steps 9-15 are not authorized by this rehearsal-planning task.

## 4. Prerequisites

- Explicit operator approval for the rehearsal; later, separate approval for every production action.
- Confirmed Neon project, production parent branch, database, role, region, and endpoint identity.
- Confirmed Vercel frontend/backend projects, Root Directories, Production Branches, build overrides, environment scopes, and currently deployed Git SHA.
- A named operator and second reviewer for target/command verification.
- A secure location outside Git for timestamps, redacted screenshots, query output, counts, checksums, and logs.
- A controlled test account and nonvaluable test vehicle. Do not use a valuable real user vehicle for the first archive transition.
- For an isolated Preview, separate branch-scoped Preview values for `DATABASE_URL`, `MIGRATION_DATABASE_URL`, Upstash, email, secrets, cookie/CORS settings, and other writable integrations. No Preview variable may point to production.
- A production checkpoint/restore procedure validated in Neon before the eventual production window.

## 5. Create the Neon rehearsal branch manually

Neon documents that a branch created from a parent's current head contains the parent's schema and data at branch creation and then diverges independently. See [Neon branching workflow](https://neon.com/docs/get-started-with-neon/workflow-primer).

1. Sign in to the correct Neon organization and project.
2. Open Branches and identify the branch currently used by production. Compare its endpoint/database with the Vercel production configuration without copying secrets into the runbook.
3. Select New branch.
4. Set the parent to the confirmed current production branch.
5. Choose the current head/current point in time, not an older timestamp or schema-only branch.
6. Name it `p3-rollout-rehearsal` and record its branch ID and creation timestamp outside Git.
7. Create/confirm a read-write compute for the new branch. Do not move or reuse the production compute endpoint.
8. In Connection Details, select the same logical database and an appropriately scoped rehearsal role.
9. Copy the rehearsal **pooled** connection string for runtime `DATABASE_URL`. Its hostname normally contains `-pooler`.
10. Copy the rehearsal **direct/non-pooled** connection string for `MIGRATION_DATABASE_URL`. Its hostname must not contain `-pooler` or `pgbouncer`.
11. Confirm the two endpoint hostnames map to `p3-rollout-rehearsal`, not the parent, and that both URLs name the same logical database. Have the second reviewer repeat the comparison.

Required connection strings, held only in a password manager or ephemeral process environment:

- `DATABASE_URL=<pooled rehearsal runtime URL>`
- `MIGRATION_DATABASE_URL=<direct rehearsal migration URL>`

Never print, commit, paste into chat, or retain either secret in shell history. Changes on this branch are isolated from subsequent production writes; it is a point-in-time rehearsal copy, not a continuously synchronized replica.

## 6. Read-only pre-migration verification

Connect only after the dashboard identity check. Capture results outside Git under the recorded rehearsal branch ID/timestamp. The first query helps identify the database session but cannot by itself prove the Neon branch; dashboard endpoint matching remains mandatory.

```sql
SELECT current_database() AS database_name,
       current_user AS database_user,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       version() AS server_version;

SELECT id, name, checksum, executed_at
FROM schema_migrations
ORDER BY name, id;
```

Expected pre-migration ledger for this repository:

| Name | SHA-256 |
| --- | --- |
| `001_initial_schema.js` | `de92f5d0167a1a69afaea2140c214c66ad8bb711dc6190aacd2ddd9943a69358` |
| `002_align_legacy_schema.js` | `f2cbbf41371fc5118d09c34a7e3b03f21fcb3f164d58b0c1d86ab0bcf3544f6f` |

There must be exactly those two names, once each, and no 003 row. A missing, duplicate, changed, extra, or already-present entry is a STOP condition until explained and the plan is revised.

Capture table counts:

```sql
SELECT 'users' AS table_name, count(*) AS row_count FROM users
UNION ALL SELECT 'vehicles', count(*) FROM vehicles
UNION ALL SELECT 'maintenances', count(*) FROM maintenances
UNION ALL SELECT 'costs', count(*) FROM costs
ORDER BY table_name;
```

Capture deterministic legacy and relationship manifests. These are read-only; for an unexpectedly large table, stop and replace `string_agg` with a reviewed sorted export/hash procedure rather than imposing unmeasured load.

```sql
SELECT count(*) AS vehicle_count,
       md5(COALESCE(string_agg(
         concat_ws('|', id, user_id, chassis_number, COALESCE(current_mileage::text, '<NULL>')),
         E'\n' ORDER BY id
       ), '')) AS legacy_vehicle_manifest
FROM vehicles;

SELECT 'maintenances' AS relation,
       count(*) AS row_count,
       md5(COALESCE(string_agg(
         concat_ws('|', id, user_id, vehicle_id), E'\n' ORDER BY id
       ), '')) AS relationship_manifest
FROM maintenances
UNION ALL
SELECT 'costs', count(*),
       md5(COALESCE(string_agg(
         concat_ws('|', id, user_id, vehicle_id), E'\n' ORDER BY id
       ), ''))
FROM costs
ORDER BY relation;

SELECT
  (SELECT count(*) FROM maintenances m LEFT JOIN users u ON u.id = m.user_id WHERE u.id IS NULL) AS maintenance_user_orphans,
  (SELECT count(*) FROM maintenances m LEFT JOIN vehicles v ON v.id = m.vehicle_id WHERE v.id IS NULL) AS maintenance_vehicle_orphans,
  (SELECT count(*) FROM costs c LEFT JOIN users u ON u.id = c.user_id WHERE u.id IS NULL) AS cost_user_orphans,
  (SELECT count(*) FROM costs c LEFT JOIN vehicles v ON v.id = c.vehicle_id WHERE v.id IS NULL) AS cost_vehicle_orphans,
  (SELECT count(*) FROM maintenances m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.user_id <> v.user_id) AS maintenance_owner_mismatches,
  (SELECT count(*) FROM costs c JOIN vehicles v ON v.id = c.vehicle_id WHERE c.user_id <> v.user_id) AS cost_owner_mismatches;
```

Capture representative vehicles without placing output in Git. Keep the same ordered sample for post-migration comparison:

```sql
SELECT id, user_id, chassis_number, current_mileage
FROM vehicles
ORDER BY id
LIMIT 20;

SELECT id, user_id, chassis_number, current_mileage
FROM vehicles
ORDER BY id DESC
LIMIT 20;
```

## 7. Rehearsal migration

Use a new shell that has never held production URLs. Set both URLs explicitly to the rehearsal branch so later application commands cannot inherit a production runtime URL. Do not create or edit `.env`.

From `backend/`, the exact repository migration command is:

```powershell
$env:DATABASE_URL = '<pooled rehearsal runtime URL>'
$env:MIGRATION_DATABASE_URL = '<direct rehearsal URL>'
npm.cmd run db:migrate
```

POSIX equivalent:

```bash
DATABASE_URL='<pooled rehearsal runtime URL>' \
MIGRATION_DATABASE_URL='<direct rehearsal URL>' \
npm run db:migrate
```

Before pressing Enter, two operators must confirm that neither hostname is production, both endpoints belong to `p3-rollout-rehearsal`, both use the same database, and the migration hostname lacks `-pooler`/`pgbouncer`.

Expected first-run output is `skip 001_initial_schema.js`, `skip 002_align_legacy_schema.js`, `run  003_vehicle_identity_archive.js`, then `Database migrations are up to date.` Any other run/skip set is a STOP condition.

After completing the post-migration SQL below, execute the same command a second time. Expected output is a skip for 001, 002, and 003 and no `run` line. This verifies idempotent ledger behavior; it does not authorize a production run.

## 8. Read-only post-migration verification

Repeat the identity query first. If the session target differs, stop. Repeat every pre-migration count, manifest, orphan/mismatch, and representative-vehicle query and compare with the saved evidence. Counts and hashes must match exactly; all representative legacy IDs, chassis values, and mileage values must be unchanged.

Verify the new columns and definitions:

```sql
SELECT column_name, data_type, character_maximum_length,
       numeric_precision, numeric_scale, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'vehicles'
  AND column_name IN (
    'registration_plate', 'registration_country', 'make', 'vin',
    'fuel_type', 'purchase_date', 'purchase_amount', 'currency',
    'archived_at', 'revision'
  )
ORDER BY column_name;
```

Expect ten rows. The nine identity/purchase/archive columns are nullable. `revision` is non-null integer with default 1; `purchase_amount` is numeric(12,2); `archived_at` is timestamp with time zone.

Prove migration 003 fabricated no values and initialized archive/revision safely:

```sql
SELECT
  count(*) FILTER (WHERE archived_at IS NOT NULL) AS archived_rows,
  count(*) FILTER (WHERE revision <> 1 OR revision IS NULL) AS noninitial_revisions,
  count(*) FILTER (WHERE
    registration_plate IS NOT NULL OR
    registration_country IS NOT NULL OR
    make IS NOT NULL OR
    vin IS NOT NULL OR
    fuel_type IS NOT NULL OR
    purchase_date IS NOT NULL OR
    purchase_amount IS NOT NULL OR
    currency IS NOT NULL
  ) AS fabricated_identity_or_purchase_rows
FROM vehicles;
```

All three results must be zero immediately after 003 and before any V2 application writes.

Verify constraints and the active index:

```sql
SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = 'public.vehicles'::regclass
  AND conname IN (
    'chk_vehicles_purchase_amount',
    'chk_vehicles_registration_country',
    'chk_vehicles_currency',
    'chk_vehicles_revision'
  )
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'vehicles'
  AND indexname = 'idx_vehicles_user_active';
```

Expect four validated constraints and one partial index whose predicate is `archived_at IS NULL`.

Verify the ledger:

```sql
SELECT name, count(*) AS ledger_rows, min(checksum) AS checksum
FROM schema_migrations
GROUP BY name
ORDER BY name;

SELECT count(*) AS migration_003_rows
FROM schema_migrations
WHERE name = '003_vehicle_identity_archive.js'
  AND checksum = '2ec45a433501adac133ecd0d07ac957775da2d36ea937405f2c0b88ea58089f0';
```

Expect exactly one row for each of 001/002/003 and `migration_003_rows = 1`.

## 9. Run V2 against the rehearsal branch

### Preferred: local isolated process

Use an ephemeral shell, not a repository `.env`. Explicitly supply the rehearsal runtime and migration URLs, a nonproduction JWT secret, local CORS/cookie settings, and `VEHICLE_ARCHIVE_ENABLED=true`. Use a separate nonproduction Upstash configuration if the protected POST flows are exercised; local development with no Redis variables uses the documented bounded memory store. Do not reuse production email, cron, rate-limit, or cookie secrets.

Example launch shape from `backend/` (placeholders only):

```powershell
$env:NODE_ENV = 'development'
$env:DATABASE_URL = '<pooled rehearsal runtime URL>'
$env:MIGRATION_DATABASE_URL = '<direct rehearsal URL>'
$env:DB_SSL = 'true'
$env:JWT_SECRET = '<ephemeral nonproduction secret>'
$env:CORS_ORIGINS = 'http://127.0.0.1:4174'
$env:COOKIE_DOMAIN = ''
$env:VEHICLE_ARCHIVE_ENABLED = 'true'
Remove-Item Env:UPSTASH_REDIS_REST_URL -ErrorAction SilentlyContinue
Remove-Item Env:UPSTASH_REDIS_REST_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:RATE_LIMIT_KEY_SECRET -ErrorAction SilentlyContinue
Remove-Item Env:RESEND_API_KEY -ErrorAction SilentlyContinue
npm.cmd start
```

In a second shell, run `npm.cmd run frontend:serve` from `backend/` and open `http://127.0.0.1:4174`. Local frontend requests use `http://localhost:3000/api`; use consistent hostnames/cookie behavior and confirm CORS before testing.

### Alternative: isolated Vercel Preview

Do not create the Preview until branch-specific Preview variables are confirmed. Because `vercel-build` runs migrations, a Preview configured with production `MIGRATION_DATABASE_URL` could migrate production during build even if its runtime URL is safe. Set branch-specific Preview `DATABASE_URL` and `MIGRATION_DATABASE_URL` to the rehearsal branch first, together with isolated writable integrations and `VEHICLE_ARCHIVE_ENABLED=true`. Review deployment logs for 001/002/003 skips. Never promote this Preview to Production.

### Rehearsal checks

Use a controlled account and test vehicle only:

1. Login and logout/refresh behavior.
2. Registration only if a dedicated test address and isolated email behavior are understood. With no safe email adapter/key, skip registration and record that limitation; do not use production Resend.
3. Dashboard loads without SQL errors.
4. Active Vehicles list contains only active vehicles.
5. Vehicle Detail opens for an existing vehicle.
6. Edit a controlled test vehicle and confirm changed-fields-only PATCH behavior/revision.
7. Add a controlled vehicle with required chassis/type and new optional identity/purchase fields.
8. Open vehicle-specific maintenance and costs.
9. Record the test vehicle's maintenance/cost IDs and counts.
10. Archive the test vehicle; verify Active -> Archived and absence from active reminders.
11. Open archived list and archived detail.
12. Confirm the same maintenance/cost rows remain readable and unchanged.
13. Restore the test vehicle; verify Archived -> Active.
14. Confirm no vehicle DELETE request occurred in browser network logs and no dependent row disappeared.
15. Check desktop, 390px responsive layout, keyboard navigation, focus, confirmation dialog, error, empty, and loading states.

Demo remains browser-only and can be checked separately, but it does not prove the rehearsal database behavior.

## 10. Eventual production migration procedure — do not execute now

1. Freeze the rollout window. Keep the current old application deployed and serving.
2. **MANUAL DASHBOARD CHECK REQUIRED:** record the backend/frontend Vercel project IDs, Production Branch values, deployed Git SHA, Neon project ID, production branch ID/name, database, role, region, pooled runtime endpoint, and direct migration endpoint. Two operators compare them.
3. Confirm the production runtime URL is the pooled endpoint and the explicit migration URL is the direct endpoint for that exact same branch/database. Never substitute the pooled runtime URL into `MIGRATION_DATABASE_URL`.
4. Record an exact UTC pre-migration timestamp and create/verify the agreed Neon checkpoint/restore point. Record its identifier outside Git.
5. Run the pre-migration SQL. Require exact 001/002 ledger entries and checksums, no 003, stable counts/manifests, zero unexplained relationship anomalies, and the expected representative data.
6. Open a clean production migration shell. Set only the explicitly reviewed direct production `MIGRATION_DATABASE_URL`; set `DATABASE_URL` to the matching production runtime URL so no later command can target a different database. Do not edit repository `.env`.
7. From `backend/` at reviewed commit `b5138c05c04819538d42b1fe63f2d47a7c14ca0c`, run `npm.cmd run db:migrate` once. Require only 003 to run.
8. On timeout, disconnect, SQL error, or ambiguous output, stop. Do not repeatedly retry until the database state and ledger are inspected.
9. Run the complete post-migration SQL. Require unchanged counts/manifests/relationships/legacy samples, all new fields null, revisions 1, archived count zero, validated constraints/index, and exactly one correct 003 ledger row.
10. Run the same migrator command a second time. Require all three migrations to skip and no migration to run.
11. Only after approval of that evidence, deploy V2 with `VEHICLE_ARCHIVE_ENABLED=false`. The backend Vercel build should run the migrator and no-op; inspect its build logs.
12. Complete archive-OFF smoke checks. Confirm every serving backend instance is the archive-aware release and old instances are drained.
13. Proceed to archive activation only under the separate procedure below.

No data-modifying verification query is needed. Do not test production migration success by editing a real user's vehicle.

## 11. STOP conditions

Stop without migrating, deploying, enabling, retrying, or “repairing” data when any of these occurs:

- The Neon project, parent branch, branch ID, database, role, region, runtime endpoint, or migration endpoint is wrong or cannot be independently confirmed.
- A rehearsal/Preview endpoint matches production or a migration hostname unexpectedly contains `-pooler`, `pooler`, `pgbouncer`, an unreviewed alias, proxy, or tunnel.
- The production branch configured in Vercel is not the reviewed branch, or the deployed SHA/build settings are unexpected.
- `schema_migrations` is missing unexpectedly, contains extra/missing/duplicate names, has a checksum mismatch, or already contains 003 when the plan expects it absent.
- Migration 001 or 002 is proposed to run on the production-derived rehearsal/production target.
- The live schema differs from migrations 001/002 in a way not covered by the ledger, or 003 columns/constraints/index partially exist without the expected ledger row.
- Pre/post counts, manifests, IDs, chassis values, mileage values, ownership relationships, or orphan/mismatch results differ unexpectedly.
- Any preexisting `archived_at` is non-null, any post-003 existing revision is not 1, or any identity/purchase field was populated by the migration.
- Connection, advisory-lock, 60-second statement timeout, transaction, checksum, constraint validation, or migration execution fails.
- The first or second runner output differs from the expected run/skip set.
- V2 is observed against schema 002, an archive-unaware instance remains serving before activation, or a Preview has any production writable integration.
- A checkpoint/restore point is absent, unverified, or too old for the approved production window.

## 12. Rollback floor

| State | Safe operational response |
| --- | --- |
| **A. 003 applied, V2 not deployed** | Keep the old application serving. Code review confirms it remains schema-compatible because 003 is additive and all new values are null/defaulted. Investigate before deployment; do not attempt to remove 003. |
| **B. V2 deployed, archive flag OFF** | Roll back only to a release that is known to run safely on the expanded schema. The original old application is schema-compatible while no rows are archived, but prefer the archive-aware compatibility/V2 release so explicit state filters and reminder exclusions remain correct. Do not roll back the schema. |
| **C. Archive flag ON, no vehicles archived yet** | Operational choices remain broader because `archived_at` is still null for every row. The safest rollback is still an archive-aware release. If activation is reversed, confirm no archive write occurred and drain/redeploy all instances consistently. |
| **D. Any real vehicle archived** | Archive-aware behavior is the rollback floor. Do not deploy legacy code that lists archived rows as active, sends their reminders, or exposes physical DELETE. Do not disable archive awareness as a rollback. Restore forward with an archive-aware release. |

Database rollback means restore/recovery under a separately approved incident plan, not editing or deleting the immutable 003 migration. An application rollback never removes additive columns or the ledger row.

## 13. Vercel archive activation — later, not now

Vercel states that environment-variable changes are not retroactive and apply only to new deployments. Saving `VEHICLE_ARCHIVE_ENABLED=true` does not change already deployed Functions; the backend must receive a new deployment/redeployment. See [Vercel environment variables](https://vercel.com/docs/environment-variables) and [rotating variables/redeploy behavior](https://vercel.com/docs/environment-variables/rotating-secrets).

1. Confirm 003, archive-OFF smoke results, and that every serving backend is archive-aware.
2. Confirm no stale/archive-unaware deployment can receive production traffic.
3. In the backend Vercel project only, update the Production-scoped `VEHICLE_ARCHIVE_ENABLED` to exactly `true`.
4. Trigger a new production deployment/redeployment. Do not assume saving the variable updates existing serverless functions.
5. Inspect build logs: `vercel-build` invokes migrations and must skip 001/002/003.
6. Confirm the deployment uses the new value and is healthy before moving traffic/accepting the deployment as live.
7. Run the archive-ON smoke test with a newly created, controlled, disposable vehicle only.
8. After the first successful archive, record that archive-aware code is now the operational rollback floor.

## 14. Git integration recommendation

At inspection time:

- `feature/caremind-v2` HEAD is `b5138c05c04819538d42b1fe63f2d47a7c14ca0c`.
- `main` and `origin/main` are `109187a89aba86afffde624ba0ac90be7165c421`.
- The merge base is `109187a89aba86afffde624ba0ac90be7165c421`.
- Divergence is 0 commits unique to `main` and 11 commits unique to the feature branch.
- No unrelated commit is evident; the sequence contains JWT/dependency readiness, the V2 plan/P0A migration harness, P0B-P0D, P1, P2, P3a, and P3b.

Commits entering `main`, oldest first:

1. `482befe` `fix: enforce JWT token purposes`
2. `9eb93c9` `chore: update vulnerable dependencies`
3. `3196657` `docs: add CaReMind V2 architecture plan`
4. `dab3a80` `test: add PostgreSQL migration readiness harness`
5. `dc4592e` `fix: make security writes atomic`
6. `49cd3fd` `feat: add distributed security rate limiting`
7. `2fb47e3` `fix: harden email and reminder delivery`
8. `535930c` `feat: add public CaReMind landing experience`
9. `5717f20` `feat: improve registration and onboarding`
10. `9b93483` `feat: add vehicle archive schema foundation`
11. `b5138c0` `feat: add vehicle detail and archive experience`

Recommended method: open a reviewed PR and use a **merge commit**. Do not squash; the security, migration-readiness, UI, schema, and activation commits are useful audit and rollback landmarks. Rebase is unnecessary while the branch is 0 behind and would rewrite reviewed hashes. The recent repository history is linear, but preserving this unusually important migration/security sequence outweighs cosmetic linearity. Recheck divergence and CI immediately before the later merge. Do not merge as part of this runbook task.

## 15. Production smoke checks

### With archive flag OFF

- Landing page and canonical redirects.
- Registration only with an approved test identity and understood email behavior; otherwise verify login with a controlled account and record registration as not run.
- Login, refresh, and logout.
- Dashboard.
- Vehicles list and vehicle detail.
- Maintenance list and a controlled vehicle's maintenance history.
- Costs list and a controlled vehicle's cost history.
- Notifications and reminder projections return without SQL errors; do not trigger duplicate email delivery as a smoke test.
- New archive/restore controls report disabled as designed, and no UI path falls back to DELETE.
- Desktop, mobile, and keyboard/error-state spot checks.

### After archive flag ON

- Create or select one controlled, nonvaluable test vehicle with known maintenance/cost history.
- Record vehicle, maintenance, and cost IDs/counts.
- Archive it and verify Active -> Archived.
- Confirm it disappears from active/reminder projections and appears in Archived.
- Open archived detail and verify maintenance/cost history remains.
- Restore it and verify Archived -> Active.
- Confirm the same child IDs/counts remain and no `DELETE /api/vehicles/:id` request or SQL DELETE occurred.
- Do not use a valuable real user vehicle as the first destructive-state test.

## 16. Rehearsal cleanup

1. Stop local V2/frontend processes or disable the isolated Preview.
2. Confirm no Vercel Preview, local service, cron, or external integration still references either rehearsal URL.
3. Retain only redacted evidence required for approval; securely remove local files containing connection strings or copied customer data.
4. In Neon, re-confirm branch ID/name `p3-rollout-rehearsal`, parent, and that it is not production.
5. Delete the rehearsal compute/branch using the Neon dashboard under a separate explicit cleanup confirmation. Branch deletion is destructive; never delete by a guessed name or parent relation.
6. Confirm production remained unchanged and healthy.
7. Record cleanup timestamp and operator outside Git.

## 17. Rehearsal evidence and limitations

Record, without secrets: branch IDs/names, UTC timestamps, reviewed Git SHA, migration filenames/checksums, redacted endpoint host labels, first/second runner outcomes, pre/post count/hash comparisons, constraint/index checks, smoke results, browser/device coverage, failures, and cleanup.

Repository review cannot establish live Vercel branch settings, live build overrides, live environment values, the production Neon branch, current production ledger/schema/data, checkpoint availability, or scheduler configuration. All remain **MANUAL DASHBOARD CHECK REQUIRED**. The procedures above have not been executed against Neon or Vercel by this documentation task.
