# CaReMind engineering guidance

This file applies to the entire repository. It records the implementation inspected on 2026-09-16; verify affected code before relying on details that may have changed. Roadmap entries are not authorization to implement V2, rewrite the application, push, or deploy.

## 1. Product

CaReMind is a vehicle ownership, maintenance, reminder and operating-cost application for individuals and small fleets. The predominantly Greek interface provides vehicles, maintenance scheduling/completion, cost summaries/charts/CSV export, notifications, account settings and privileged user administration.

V1 uses one owning user per fleet. `companies`, `company_id`, `companyName` and individual/business account types exist, but company membership does not grant shared access to vehicles, maintenance or costs. Team invitations and shared company fleets are future work, not existing permissions.

## 2. Current architecture

### Repository and frontend

- `frontend/` is a static, multipage HTML/CSS/Vanilla JS application. There is no frontend package manifest, bundler, framework build, TypeScript setup or root npm workspace.
- Pages are `index.html` (public landing), `login.html` (login/password recovery/demo entry), `register.html`, `onboarding.html` (protected post-verification welcome), `dashboard.html`, `vehicles.html`, `maintenance.html`, `costs.html`, `account.html` and `admin.html`, with page-specific scripts/styles. Scripts use browser globals and depend on HTML script order; inspect each page before changing shared code.
- `api.js` exposes `window.api`. It uses `http://localhost:3000/api` on localhost/127.0.0.1 and `https://api.car-remind.gr/api` elsewhere. Requests include credentials and bearer tokens; a 401 triggers refresh and one request retry except for login. Refresh and logout have their own network paths and demo branches.
- Access tokens live in memory. `auth.js` and `auth-guard.js` manage page sessions; `currentUser` in localStorage is UI metadata, not an authorization source. `caremindExplicitLogout` prevents automatic session restoration after explicit logout.
- `ui.js`/`ui.css` provide escaping, toast/confirmation feedback, busy states, modal accessibility and navigation behavior. Reuse `window.CaReMindUI`. Other shared utilities include `maintenance-labels.js`, `costs-export.js`, `notifications.js` and `modal-fixes.js`.
- Chart.js is loaded from an unversioned jsDelivr URL on dashboard/cost pages. `database.js` is a legacy localStorage helper, not the server database or the demo store. Some dashboard/lookup fallback paths still read old localStorage collections.
- `screenshots/`, `frontend/assets/`, other frontend images and `frontend/public/` contain static presentation assets. `docs/openapi.yaml` is the checked-in REST specification; README and CHANGELOG provide product/history context.

### Backend and routes

- `backend/package.json` and `backend/package-lock.json` are the only npm manifest/lockfile pair. The lockfile is v3; dependencies include Express 5, pg, bcrypt, jsonwebtoken, cookie-parser, cors, Helmet, ipaddr.js, dotenv, Resend and mysql2. Node 22 is the CI baseline; README requests Node 22+ and PostgreSQL 17+.
- `backend/server.js` loads dotenv, configures Helmet, 100 KB request bodies, credentialed CORS, proxy trust and rate limiting, then exports the Express app. It listens on `PORT` (default 3000) only when executed directly.
- Route files contain HTTP handlers, business rules and SQL directly; there are no separate controller/service/repository layers. Shared modules are `authMiddleware.js`, `validation.js`, `db.js` and `emailService.js`.
- `/api` mounts authentication routes. Vehicles, maintenances, costs, notifications and account routes use `authenticateToken` at mount time. `/api/users` applies authentication and role checks inside its router. `/api/interest` is a rate-limited public form. `/api/cron/maintenance` requires `X-Cron-Secret` and fails closed when unconfigured.
- `GET /` is a service response; `GET /api/health` queries the database and returns 503 when unavailable.
- `admin` and `owner` are privileged roles. Only `owner` can PATCH `/api/users/:id/role` to promote/demote administrators. Privileged accounts have additional edit/deactivation/deletion protections. Administration is deliberately cross-user; ordinary resource access remains user-scoped.

### Authentication and sessions

- Login accepts username/email, checks bcrypt passwords (cost 12 for newly written hashes), and upgrades matching legacy plaintext passwords. Normal email-bearing users must verify email; admin/owner/guest roles have a login verification exemption.
- Registration requires the existing username/email/password contract, defaults to `individual`, and supports optional business metadata under account type `business`. Verification does not authenticate: the P2 browser flow returns to login with an allowlisted `/onboarding` next destination. Onboarding is protected by the ordinary auth guard and uses `/vehicles?add=1` to open the existing required chassis/type vehicle form; there is no persistent onboarding state.
- Access JWTs expire after 15 minutes and carry `purpose: "access"` from both login and refresh. `authenticateToken` requires that exact purpose and the access payload's `id`, verifies HS256 only, and reloads the user from the database on each request, rejecting missing/inactive users and using the current database role.
- Refresh tokens are random 32-byte values stored only as SHA-256 hashes, valid for 30 days and revocable in `refresh_tokens`. The HttpOnly cookie uses `/api`, SameSite=Lax, and Secure plus configured/default domain outside local requests. Refresh issues a new access JWT but does not rotate the refresh token.
- Logout revokes the cookie's matching refresh record. Password changes/reset revoke refresh sessions; existing access JWTs are not individually revoked. All JWT issuers explicitly use HS256 and all JWT verifiers accept only HS256. Password reset requires `purpose: "password_reset"`; the single shared email/username/password account-update flow requires `purpose: "account_change"`, plus a valid access session and matching user. Registration email verification uses database-backed codes, not JWTs.
- Legacy access JWTs without purpose are rejected; existing valid refresh cookies can mint typed access JWTs without a new login. Existing HS256 password-reset/account-change tokens retain their established purposes and remain usable only in their intended flows, subject to existing expiry/code checks. There is no legacy-purpose bypass in bearer authentication.
- P0B: reset/account-change redemption and registration email verification use `security-transaction.js` with one checked-out client. Lock order is owning user, code, then refresh-session writes; code ownership, purpose where applicable, unused state and wall-clock expiry are checked after the code lock. Password/account mutation, code consumption and required refresh revocation commit together. Hashing stays outside locks. Login rechecks credentials under the same user lock and atomically commits any legacy hash upgrade with session creation, preventing a stale login from undoing a password change or creating a session after its revocation.
- Administrator role changes and active-status toggles also lock the target user and commit required refresh revocation with the mutation. Existing administrator password edits already use one client/transaction for the password write and revocation. Privileged route permissions remain unchanged.

### Database and migration architecture

- Runtime persistence is PostgreSQL via `pg.Pool`, intended for Neon. `db.js` defaults to five connections per instance and preserves DATE strings and safely representable numeric IDs.
- The adapter (with pure query helpers in `postgres-query.js`, also reused by migrations) translates legacy `?` placeholders to PostgreSQL parameters, quotes camelCase aliases and adds `RETURNING id` to inserts. It exposes MySQL-shaped `[rows, fields]`, `insertId`, `affectedRows` and connection transaction helpers. This is a limited SQL translator, not an ORM; preserve its response contract and test new SQL patterns.
- Application tables: companies, users, vehicles, maintenances, costs, interest_requests, refresh_tokens, email_verification_codes, verification_codes, password_reset_codes and notification_recipients. Resource ownership uses `user_id`; routes also check vehicle ownership when attaching maintenance/costs. Foreign keys cascade dependent records on user/vehicle deletion. Recipients are soft-deactivated.
- `migrations/001_initial_schema.js` creates tables, indexes, constraints and updated_at triggers. `002_align_legacy_schema.js` adds legacy alignment fields/indexes/check constraints. Migration files export `up(connection)`.
- `scripts/migrate.js` sorts numbered JS filenames lexicographically, uses one dedicated `pg.Client` for a session advisory lock and all migration queries, runs each pending migration in a transaction and records its raw-file SHA-256 checksum in `schema_migrations`. It closes the session in finally. `MIGRATION_DATABASE_URL` must be direct/non-pooled and is required in production/CI/Vercel; only local development can fall back to a loopback `DATABASE_URL`. Known pooler host labels and URL host/database overrides are rejected. Arbitrary proxies cannot be detected: verify the actual endpoint. Migration TLS verifies remote certificates, independently of runtime `DB_SSL`; query URL parameters are limited to `sslmode` and optional `channel_binding=prefer`. Queries use the public schema and a 60-second server statement timeout. It aborts on changed applied files; keep existing migration bytes unchanged, including formatting/line endings.
- `scripts/import-mysql-to-postgres.js` is a separate, one-time importer. mysql2 is for this importer, not normal API persistence. It first migrates the target, requires empty application tables, imports rows transactionally and adjusts ID sequences. Do not run it as routine setup or against an unverified target.

### Email, deployment and configuration

- `emailService.js` lazily initializes Resend using `RESEND_API_KEY`, treats both returned provider errors and thrown/network errors as structured submission failures, and reports only accepted submissions as `submitted`. Sender and reply-to addresses are fixed to the car-remind.gr domain. Email supports registration verification, password reset, account changes and scheduled reminders. Phone recipients can be stored, but no SMS delivery implementation exists.
- The cron handler selects exact-date, noncompleted reminders for active users and matching owned vehicles. It sends to the normalized/deduplicated primary email plus active extra email recipients with concurrency capped at four, and reports aggregate attempted/submitted/failed counts. No cron schedule or worker configuration is checked in; an external scheduler must call `GET /api/cron/maintenance` with `X-Cron-Secret`.
- Frontend Vercel configuration is `frontend/vercel.json`: redirect `.html` URLs to extensionless paths and rewrite them to HTML files. The bundled local static server mirrors these canonical redirects and extensionless rewrites.
- The documented backend deployment uses a separate Vercel project rooted at `backend/`, auto-detecting the exported Express app. There is intentionally no backend `vercel.json` or Edge `middleware.js`; a test asserts this. `vercel-build` runs migrations. Repository configuration does not establish the current state of live hosting, DNS or database migrations.
- `.github/workflows/ci.yml` runs on pushes/PRs, installs with npm ci, runs backend syntax/tests/audit, and separately checks frontend JS syntax. A separate Node 22 job runs `test:postgres` against a health-checked disposable PostgreSQL 17 service with fake credentials. There is no deployment job.
- Use `backend/.env.example`, never real secrets, when documenting configuration. Variables cover `MIGRATION_DATABASE_URL`, `DATABASE_URL`, `DB_SSL`, `DB_POOL_MAX`, `JWT_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMIT_KEY_SECRET`, `RESEND_API_KEY`, `CRON_SECRET`, `COOKIE_DOMAIN`, `CORS_ORIGINS`, `PORT`, `NODE_ENV`, `MYSQL_SOURCE_*` and `DEV_ADMIN_*`. The static server separately reads `FRONTEND_HOST`/`FRONTEND_PORT`. `TEST_DATABASE_URL` is a shell-only integration-test setting (the suite does not load dotenv). Real `.env` and `.vercel` directories are ignored; do not print or commit their contents.

### Demo mode

- The same production pages and API adapter are used in demo mode. `demo-store.js` exposes `window.CaReMindDemo` and stores versioned seeded data under `caremindDemoData`, with `caremindDemoMode` selecting the adapter branch. It has start/end/reset behavior, resource CRUD with vehicle-delete cascades, notifications, simulated account changes and recipients.
- Demo requests, refresh and logout must stay browser-only. Unsupported demo endpoints throw; they must never fall through to the production backend. Demo authentication tokens/codes are simulations and must never become production credentials.
- `demo-tour.js`/`demo-tour.css` implement a resumable tour using `caremindDemoTourV1`. Admin navigation is excluded from demo. Demo validation and reminder calculations are not currently identical to the backend; sharing UI does not imply identical service behavior.

## 3. Critical invariants

- Existing authentication and refresh-token security must not be weakened.
- Every user-owned resource must remain scoped to the authenticated user. Preserve explicit backend authorization for privileged administration; never generalize it into company-wide resource access.
- Never trust a `user_id` supplied by the frontend for authorization. Derive ownership from `req.user.id`, and verify ownership of referenced vehicles and other parent records.
- Database migrations must be non-destructive and ordered.
- Existing migration checksums must never be modified.
- Never modify an already-applied migration; create a new migration instead.
- Never drop production data to simplify a migration. Stop and report incompatible legacy data rather than deleting it.
- Production secrets must never be committed.
- Demo mode must remain isolated from the production backend.
- When practical, new user-facing flows should also work in demo mode.
- The production frontend and demo frontend should share the same UI flows.
- Changes to REST API contracts must update `docs/openapi.yaml`.
- New backend behavior must receive automated tests.
- Existing tests must continue passing.
- Accessibility and responsive/mobile behavior must be considered for every frontend change.
- Do not perform a React/Vue/Next rewrite unless explicitly requested.
- Preserve the current Vanilla JS architecture unless a specific task requires otherwise.

## 4. Development workflow

Run npm commands from `backend/`. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`; do not change system policy to run repository commands.

| Purpose | Actual command / behavior |
| --- | --- |
| Install | `npm ci` using the committed backend lockfile |
| Configure local API | Copy `.env.example` to `.env` only if `.env` does not exist; fill local values without exposing secrets |
| Migrate | `npm run db:migrate`; `npm run db:setup` is an alias, not a destructive reset. Configure direct `MIGRATION_DATABASE_URL` before remote/production/CI use |
| Local API | `npm run dev` uses `node --watch server.js`; `npm start` uses `node server.js` |
| Static frontend | In a second terminal, `npm run frontend:serve`; defaults to `http://127.0.0.1:4174` |
| Optional local admin | `npm run db:seed`; requires DEV_ADMIN_USERNAME/EMAIL and a password of at least 12 characters; refuses NODE_ENV=production |
| One-time legacy import | `npm run db:import:mysql`; only for an explicitly intended, verified empty PostgreSQL target |
| Backend syntax | `npm run check` recursively runs node --check on backend JS excluding node_modules |
| Automated tests | `npm test` runs `node --test --test-concurrency=1`; no real PostgreSQL required |
| PostgreSQL integration | `npm run test:postgres`; explicit shell `TEST_DATABASE_URL` for a disposable loopback IP `caremind_test`/`caremind_test_*` database, with a test-only CREATEDB role. No dotenv or application URL fallback; generated databases are dropped in teardown |
| Dependency audit | `npm audit --omit=dev`; do not automatically run audit fix or upgrade packages outside task scope |
| Deployment build hook | `npm run vercel-build` applies database migrations; this is not a harmless frontend build/check |

For local API access from the bundled static server, add `http://127.0.0.1:4174` to `CORS_ORIGINS` before starting the API, or serve on an already allowed origin such as `http://127.0.0.1:5500`. The default server port 4174 is not in the API's built-in CORS list. The static server does not load dotenv; set FRONTEND_HOST/FRONTEND_PORT in its shell if needed. Use the same hostname consistently for cookies. Demo mode needs only the static frontend and no database/email setup.

Frontend syntax check from the repository root, matching CI (Bash):

```bash
find frontend -name '*.js' -print0 | xargs -0 -n1 node --check
```

PowerShell equivalent that stops on failures:

```powershell
Get-ChildItem frontend -Recurse -Filter *.js | ForEach-Object {
  node --check $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Frontend syntax check failed" }
}
```

No separate frontend build, lint, typecheck, CSS/HTML validator or browser E2E command is configured. JS checks do not parse inline HTML scripts.

Tests live in `backend/test/`: API authorization/CRUD/auth tests use a local Express listener and stub `db.query`; ordinary PostgreSQL adapter tests inspect SQL translation/DDL without executing a real database; the separately invoked `backend/integration/postgres.js` suite checks fresh/idempotent migrations, fixture checksum tampering, transactional rollback, two-runner lock serialization and backend PID identity on real PostgreSQL; demo/logout/UI tests use VM contexts and DOM/storage stubs; other tests inspect tour targets, social preview assets and Vercel file conventions. Ordinary tests do not establish real PostgreSQL migration correctness. The separate integration suite verifies current migrations on disposable PostgreSQL, not live Neon routing, production legacy data, real email delivery or browser/mobile accessibility. Add meaningful coverage for changed behavior and verify relevant integration boundaries using isolated test data. Never use an unknown `.env` database for test migrations.

## 5. Definition of done

Every implementation task must end with:

- Summary of files changed and resulting behavior.
- Database migration notes, including whether any migration is needed/applied and compatibility implications.
- API contract changes and corresponding OpenAPI updates.
- Security considerations: authentication, ownership, permissions, input handling and secrets as applicable.
- Tests added/changed.
- Commands executed.
- Test results, including failures or checks not run and why.
- Remaining limitations.
- Manual verification steps for the affected real and demo flows, including mobile/keyboard checks for UI work.

Use "none" or "not applicable" when appropriate rather than omitting an item. Report observed results; do not describe an unexecuted command, live deployment or migration as verified.

## 6. Coding behavior

- Inspect existing patterns before creating new abstractions. Reuse existing utilities where sensible.
- Keep changes scoped; avoid unrelated refactors, reformatting, dependency churn and generated asset changes.
- Use semantic HTML, associated labels, keyboard-operable controls, visible focus and appropriate dialog/focus behavior. Respect responsive layouts and reduced motion.
- Escape user-controlled HTML, including email templates. Prefer textContent for plain text and the existing escapeHtml utility for markup interpolation; use context-appropriate escaping elsewhere.
- Handle loading, empty, success and error states. Do not silently substitute stale local data for failed server operations in new flows.
- Never expose secrets in browser code, localStorage, logs, screenshots or committed examples.
- Prefer backend-enforced permissions and entitlements; hiding controls and reading localStorage are not security controls. No billing/entitlement subsystem currently exists.
- Preserve parameterized SQL and validate IDs, referenced-resource ownership, dates, amounts and bounds. Keep transaction boundaries explicit for dependent writes.
- Keep demo routing in the shared adapter and extend the browser store when practical. Check script load order, API field casing, date strings and numeric conversion at database/UI boundaries.
- Maintain Greek UI text and UTF-8 encoding; avoid broad rewrites caused by terminal encoding artifacts.

### Known gaps to consider when working in affected areas

These are inspection findings, not authorization for unrelated fixes:

- **Remaining session risks:** refresh tokens are not rotated. P0B makes reset/account-update/email-verification writes atomic and serializes login session creation with password changes. Password changes do not immediately invalidate existing access JWTs; a refresh already in flight can still issue an access JWT. Separate outstanding codes retain their existing independent validity.
- **Serverless rate limiting (P0C):** `security-rate-limit.js` supplies endpoint-specific IP and HMAC identifier/user quotas; `rate-limit-store.js` uses atomic Upstash Redis EVAL over HTTPS. Production/Vercel requires `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and an independent >=32-character `RATE_LIMIT_KEY_SECRET`. Missing/invalid config and provider failures deny protected POSTs with 503/Retry-After: 30; 1-second deadline per store call, no production memory fallback. Local development without Redis uses bounded memory; NODE_ENV=test ignores credentials. Express trust proxy is false; limiter uses socket IP locally and the validated platform `x-vercel-forwarded-for` only when VERCEL=1. Keep the direct Vercel ingress assumption; verify it before deployment. See README for all quotas and manual setup. Ordinary CRUD is unaffected.
- **Database TLS/locking:** runtime still configures `rejectUnauthorized: false` when SSL is enabled. Migration connections now verify certificates and require explicit direct URLs for remote/production/CI use. Real local tests verify session locking; live Neon routing/TLS remains an operator verification step before deployment. An arbitrary proxy or loopback tunnel cannot be detected from the URL.
- **Email/reminders:** P0D now inspects Resend's returned error field, removes newly created security codes after failed submission, preserves enumeration-neutral public recovery responses and filters completed maintenance/inactive users. Cron delivery uses bounded concurrency and per-recipient outcomes. It still has no delivery ledger or idempotency key: repeated runs can duplicate reminders, missed exact-date runs can miss reminders, and provider acceptance is not proof of inbox delivery. Durable retry/catch-up/exactly-once work remains in the future notification-delivery phase.
- **Coverage:** `test:postgres` covers migrations plus HTTP security flows on generated disposable PostgreSQL databases: reset/account/email-verification rollback, single-use concurrency, lock-wait revalidation, login races and client cleanup. It injects the validated test pool without importing the dotenv-loading server or runtime database module. Other API coverage still uses database stubs; there is no full browser E2E suite or general real-database API suite. JWT purpose/algorithm regressions remain covered.
- **Documentation drift:** README calls OpenAPI complete, but `/health` is missing, the User enum omits owner, logout incorrectly requires bearer auth, and recipient creation documents 201 while the handler returns 200. README's "stateless" authorization description omits per-request user lookups. The bundled static server/CORS setup is also undocumented there.
- **Demo/legacy drift:** demo notifications use a fixed 14-day window and a seven-day warning threshold; backend notifications use each maintenance's notificationDays and a three-day warning threshold. Legacy localStorage fallbacks and unused `/notification-recipients` adapter methods do not represent the current `/account/recipients` API.

Recheck these findings against current code before fixing them. Keep guidance synchronized when an authorized change resolves a gap.
