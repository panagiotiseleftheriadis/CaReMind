# CaReMind

Vehicle maintenance and operating-cost management for individuals and small fleets.

[**Open CaReMind**](https://car-remind.gr) · Public landing, account access and browser-only Demo

![CaReMind dashboard](screenshots/dashboard.png)

## What the project does

CaReMind gives each account a private workspace for its own vehicles. Users can register vehicles, schedule and complete maintenance, track costs, review upcoming reminders and manage notification recipients.

Version 1 deliberately uses one owner per fleet: all vehicle, maintenance and cost records are scoped by `user_id`. `companyName` is profile information, not a shared organisation or team boundary. Invitations and multi-user companies are intentionally deferred to a future version.

The Demo runs entirely in the browser. It loads realistic seed data into `localStorage`, implements the same API-shaped operations used by the real interface and can be reset at any time. Demo data never reaches the production backend.

## Highlights

- Public product landing page with separate login and registration routes
- Guided post-verification welcome with a direct handoff to the existing first-vehicle form
- Browser-only Demo with complete CRUD flows
- Access and refresh-token authentication with email verification
- Ownership checks for every vehicle, maintenance and cost mutation
- Expense summaries, charts, filters and CSV export
- Maintenance reminders and configurable email recipients
- Responsive vanilla JavaScript interface with accessible dialogs and feedback
- Non-destructive, checksum-protected PostgreSQL migrations
- Automated API, authorization and demo-flow tests in GitHub Actions

## Architecture

```mermaid
flowchart LR
  Visitor["Public visitor"] --> Landing["Product landing page"]
  Landing --> Demo["Browser demo store"]
  Demo --> LocalStorage["Browser localStorage"]

  User["Registered user"] --> Frontend["HTML / CSS / Vanilla JS"]
  Frontend -->|"HTTPS + JSON"| API["Express REST API"]
  API --> Auth["JWT access + refresh sessions"]
  API --> Neon["Neon PostgreSQL"]
  API --> Resend["Resend email service"]
  Scheduler["Protected cron request"] --> API
```

The frontend calls one API adapter. When demo mode is enabled, that adapter delegates to `demo-store.js`; otherwise it calls the Express API. This keeps the visible user flows consistent without requiring paid infrastructure for recruiter access.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | HTML5, CSS3, Vanilla JavaScript, Chart.js |
| Backend | Node.js 22, Express 5 on Vercel Functions |
| Database | Neon PostgreSQL, custom ordered migrations |
| Security | bcrypt, JWT, HttpOnly cookies, Helmet, rate limiting |
| Email | Resend |
| Quality | Node test runner, GitHub Actions, npm audit |

## Screens

| Login | Vehicles |
| --- | --- |
| ![Login](screenshots/login.png) | ![Vehicles](screenshots/vehicles.png) |

| Maintenance | Costs |
| --- | --- |
| ![Maintenance](screenshots/maintenances.png) | ![Costs](screenshots/costs.png) |

Additional screens: [registration](screenshots/register.png), [account](screenshots/account.png) and [admin](screenshots/admin.png).

## Run locally

Requirements: Node.js 22+, npm and PostgreSQL 17+ (or a Neon project).

```bash
git clone https://github.com/panagiotiseleftheriadis/CaReMind.git
cd CaReMind/backend
npm ci
copy .env.example .env
npm run db:setup
npm start
```

On macOS/Linux, use `cp .env.example .env`. Copy only if `.env` does not already exist. Set runtime `DATABASE_URL` and direct `MIGRATION_DATABASE_URL` in `.env` before running the migration. `npm run db:setup` applies every pending migration without dropping existing tables or data. For local development only, an unset migration URL can fall back to a loopback `DATABASE_URL`; remove the example migration placeholder if using this fallback.

For extensionless routes matching production, run `npm run frontend:serve` from `backend/`. The local entry URLs are `http://127.0.0.1:4174/` (landing), `/login`, `/register` and the authenticated `/onboarding`; `.html` requests canonicalize to extensionless paths. The deployed frontend automatically uses `https://api.car-remind.gr/api`; localhost uses `http://localhost:3000/api`.

### Optional development administrator

There is no default password or plaintext seed account. To create or update a local administrator, configure these development-only variables and run the separate seed command:

```dotenv
DEV_ADMIN_USERNAME=local-admin
DEV_ADMIN_EMAIL=admin@example.test
DEV_ADMIN_PASSWORD=use-a-strong-local-password
```

```bash
npm run db:seed
```

The seed refuses to run in production and hashes the password with bcrypt.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Application/runtime PostgreSQL connection; may use Neon pooling |
| `MIGRATION_DATABASE_URL` | Production/CI and remote migrations | Direct/non-pooled connection to the same database, used by the migration runner |
| `TEST_DATABASE_URL` | Integration tests only | Explicit shell variable for a disposable loopback `caremind_test` database; never used by the API |
| `DB_SSL` | Neon runtime | Enables TLS for the runtime adapter; does not configure migration TLS |
| `DB_POOL_MAX` | Optional | Maximum connections per serverless instance; defaults to 5 |
| `JWT_SECRET` | Yes | Access-token signing; the API refuses to start without it |
| `RESEND_API_KEY` | For email | Verification, reset and reminder delivery |
| `CRON_SECRET` | For reminders | Protects the maintenance cron endpoint |
| `COOKIE_DOMAIN` | Production | Refresh-cookie domain |
| `CORS_ORIGINS` | Optional | Additional comma-separated frontend origins |
| `VEHICLE_ARCHIVE_ENABLED` | Optional, default off | P3a compatibility gate for archive/restore, active-list default and legacy DELETE protection |
| `PORT`, `NODE_ENV` | Optional | Runtime configuration |

See [`backend/.env.example`](backend/.env.example) for a complete template. Never commit `.env`.

## Database migrations

Migration files live in `backend/migrations/` and execute in filename order. The runner:

- uses one dedicated `pg.Client` for the session advisory lock, ledger, every migration and unlock, then closes it even after failure;
- wraps each pending migration and its ledger insert in one transaction;
- creates the `schema_migrations` table when needed;
- records a SHA-256 checksum for every applied migration;
- skips migrations already applied;
- stops if an applied migration was later modified;
- never drops tables or seeds default credentials.

Use Neon's **direct/non-pooler** URL for `MIGRATION_DATABASE_URL`, while `DATABASE_URL` may remain pooled. Production (`NODE_ENV=production`), CI and Vercel fail before connecting if the explicit migration URL is absent. Outside those contexts, only `localhost`, `127.0.0.1` or `::1` runtime URLs qualify for the local fallback. Even a local endpoint must actually be direct: hostname checks cannot identify arbitrary proxies, aliases or SSH tunnels. Known `pooler`/`pgbouncer` host labels (including Neon's `-pooler` hosts) are rejected; explicit configuration is an operator assertion that the endpoint is direct, not proof obtained from the server.

Migration connections require certificate-verified TLS for remote hosts. `sslmode=require`, `verify-ca` and `verify-full` all use certificate and hostname verification; `disable` is allowed only on loopback. The runtime adapter's existing TLS behavior is unchanged. Private certificate authorities must be trusted by Node (for example through `NODE_EXTRA_CA_CERTS`); there is no insecure migration bypass. URL parameters cannot override host, database or TLS options: only `sslmode` and optional `channel_binding=prefer` are accepted. `channel_binding=require` fails explicitly because the installed pg client enables channel binding when offered but does not enforce it. Review provider URLs accordingly without weakening a required channel-binding policy. See [node-postgres TLS configuration](https://node-postgres.com/features/ssl).

The runner uses the `public` schema, a 10-second connection timeout and a 60-second server statement timeout (including lock waits), with a 65-second client query bound. A timed-out run fails and closes its session; investigate long-running migrations/competing deployments before retrying. CLI errors omit connection credentials. Importing the runner does not load dotenv or instantiate the runtime pool; the CLI and existing importer load their own configuration.

### Disposable PostgreSQL integration tests

`npm test` remains the database-stub/unit suite. Run `npm run test:postgres` separately against a disposable PostgreSQL 17+ server. The integration suite never loads `.env` and never falls back to `DATABASE_URL` or `MIGRATION_DATABASE_URL`. It rejects missing configuration, remote hosts, hostname aliases and database names other than `caremind_test`/`caremind_test_*`. Loopback checks cannot detect a locally forwarded production connection: use only a server you explicitly created for testing.

Create a disposable `caremind_test` database and a test-only login with `CREATEDB` permission, then set the URL in the same shell:

```bash
export TEST_DATABASE_URL='postgresql://caremind_test:disposable_password@127.0.0.1:5432/caremind_test?sslmode=disable'
npm run test:postgres
```

PowerShell: `$env:TEST_DATABASE_URL='postgresql://caremind_test:disposable_password@127.0.0.1:5432/caremind_test?sslmode=disable'`, then `npm.cmd run test:postgres`.

Tests create uniquely named `caremind_test_run_*` databases, exercise real migrations and drop only those generated databases in teardown. The supplied base test database is not reset or dropped. Copied temporary fixtures test checksum tampering and rollback without changing repository migrations. Two real runners verify blocking, single execution, lock cleanup and matching PostgreSQL session PID. Queries, polling and the suite have bounded timeouts. An OS/process kill can bypass teardown; inspect and remove abandoned `caremind_test_run_*` databases only on the disposable server.

CI runs this command in a separate job with a health-checked PostgreSQL 17 service, Node 22 and fake local credentials; existing syntax, unit and audit jobs remain. It needs no Neon credentials and performs no deployment.

Legacy installations are aligned by `002_align_legacy_schema.js`, which adds the missing authentication fields, indexes and database constraints. If legacy data violates a new constraint—for example duplicate chassis numbers for one user—the migration stops so the data can be reviewed instead of silently deleting or rewriting it.

### One-time MySQL import

Existing installations can be copied safely into an empty PostgreSQL database. Keep the old MySQL credentials only for the duration of the import, configure `DATABASE_URL` as the target and `MIGRATION_DATABASE_URL` as its direct connection to the same database, and run:

```bash
npm run db:import:mysql
```

The importer applies the PostgreSQL migrations, refuses to overwrite a non-empty target, copies all application tables inside a transaction and aligns every generated ID sequence. Remove the `MYSQL_SOURCE_*` values after verifying the new deployment.

## Distributed security rate limits (P0C)

`backend/security-rate-limit.js` owns policy, key construction and Express middleware.
`backend/rate-limit-store.js` implements Upstash Redis through its
[HTTPS REST API](https://upstash.com/docs/redis/features/restapi), using a single
atomic Lua `EVAL` to check and consume the applicable counters. Counters and expiry
live in Redis and are shared by all Function instances using the same database and
key secret. Windows start with the first admitted request and expire using Redis
TTL; blocked requests do not extend them. IP and identifier checks in a public
request are atomic together. Account endpoints check IP before authentication and
the authenticated user quota afterward (two store operations).

Upstash Redis was selected for serverless HTTP access without a persistent TCP
connection. The focused adapter uses Node's built-in `fetch`, an abort signal and
an outer deadline; no provider SDK is needed. This avoids relying on the Upstash
Ratelimit SDK's [default fail-open timeout](https://upstash.com/docs/redis/sdks/ratelimit-ts/features).
`express-rate-limit` and its unused `ip-address` dependency were removed;
`ipaddr.js` 2.3.0 is a direct dependency for canonical IP/subnet keys. There is no
overlapping legacy security limiter.

All paths below are **POST** under `/api`. Successful and invalid requests count
equally when admitted by the limiter; there is no existence/success-dependent quota.

| Endpoint | IP quota | Additional quota |
| --- | --- | --- |
| `/login` | 60 / 15 minutes | 10 / 15 minutes per normalized submitted username/email |
| `/register` | 20 / hour | 5 / hour per email, shared with resend and forgot-password |
| `/resend-verification` | 30 / hour | Same shared email-delivery quota |
| `/forgot-password` | 30 / hour | Same shared email-delivery quota |
| `/verify-email`, `/verify-reset-code` | Shared 120 / 15 minutes | Shared 10 / 15 minutes per email |
| `/reset-password` | 60 / 15 minutes | IP only; redemption already requires a signed purpose-specific token |
| `/account/send-code` | 30 / hour | 5 / hour per authenticated user |
| `/account/verify-code`, `/account/update` | Shared 120 / 15 minutes | Shared 20 / 15 minutes per authenticated user |
| `/refresh` | 300 / 5 minutes | IP only; opaque refresh cookie is never a limiter key |
| `/interest` | 5 / hour | IP only |

`/logout` is deliberately not rate limited. It only hashes an optional opaque
cookie and revokes the matching database session, so a limiter adds little abuse
resistance while making provider availability a prerequisite for a security action.
The existing cookie clearing and refresh-session revocation behavior is unchanged.

IP allowances are higher than account allowances to accommodate shared NAT/mobile
networks. There is no blanket `/api` throttle. CRUD, health, cron and CORS preflight
keep their existing behavior. Router matching preserves Express's case-insensitive
and optional trailing-slash semantics; those variants cannot create new buckets.

**Keys and privacy.** Keys contain a versioned application prefix, policy group,
identity type and HMAC-SHA-256 digest. Submitted identifiers use trim/lowercase
normalization without database lookups; IPs and authenticated user IDs are also
HMACed with `RATE_LIMIT_KEY_SECRET`, independent of `JWT_SECRET`. No raw email,
username, IP, password, code, cookie or JWT is stored in Redis keys or limiter logs.
Account keys use only `req.user.id` after authentication, never body `user_id` or
unverified token claims. Invalid/missing identifier fields still consume IP quota.
Username and email aliases of the same login have separate identifier buckets;
normalization can also conservatively combine case-sensitive usernames. No alias
lookup or account-existence signal is introduced. Existing login failures remain
unchanged; forgot-password now returns the same generic successful message for
existing and absent emails (the previous success text differed).

**Proxy/IP boundary.** Express `trust proxy` is now `false`: `req.ip` itself is the
socket peer and arbitrary forwarding headers are not trusted. Outside Vercel,
limiting uses the socket address. Only when the server environment has `VERCEL=1`
does the limiter use a validated single `x-vercel-forwarded-for` IP. It does not
accept an `X-Forwarded-For`, `Forwarded` or `X-Real-IP` fallback. Vercel documents
its [platform IP headers and forwarding-header overwrite](https://vercel.com/docs/headers/request-headers).
IPv4-mapped IPv6 is canonicalized to IPv4; IPv6 is grouped by /56 to resist
interface-address rotation. Missing/malformed platform IP yields temporary 503.
This assumes direct Vercel-managed ingress, not an externally accessible origin
with a manually spoofable platform header. Do not manually set `VERCEL=1` on a
standalone server. A proxy placed before Vercel may become the observed client IP
and share a quota; a custom/Enterprise trusted proxy configuration needs a separate
review. No arbitrary proxy deployment is automatically inferred or trusted.

**Failures and response contract.** Each store operation has a 1-second deadline
(up to two sequential operations for authenticated account changes), aborts pending
HTTP on timeout, disables redirects and does not retry. An exceeded quota returns
429 with `{ error: ... }`, `Cache-Control: no-store` and integer `Retry-After`
seconds rounded up from the blocking TTL. CORS exposes `Retry-After`. Missing or
invalid production configuration and invalid ingress identity return 503 with a
Greek temporary-unavailability error and `Retry-After: 30`. Provider errors and
timeouts have the same fail-closed behavior for login, registration, verification,
password reset, email delivery, account changes and interest submission, so those
protected operations do not run.

Refresh keeps distributed enforcement during normal operation. If an operational
distributed-store call fails or times out, refresh alone uses a bounded 300-per-
five-minute IP limiter held in that Function instance (up to 10,000 live keys).
This emergency fallback is best-effort session-continuity protection, not equivalent
to shared enforcement: each warm instance has independent counters and a cold start
begins empty. Failure or capacity exhaustion in the fallback returns 503. Missing or
invalid production configuration and invalid client IP still fail closed rather
than activating it. No other endpoint uses this fallback. Logout bypasses the
limiter so provider failure cannot prevent session revocation.
Configuration errors are logged at initialization; runtime failures emit a generic
log at most every 30 seconds per instance, without error payloads or credentials.
The next request can succeed after recovery; no permanent account lock is written.
A timed-out operation might already have consumed Redis quota; retries can therefore
be conservatively limited until its normal TTL.

**Local development and tests.** With neither Redis setting configured, nonproduction
local development uses explicitly logged, bounded process-local memory (10,000 live
keys, expired-key cleanup, no eviction of live quotas). It is not distributed
protection. Partial Redis configuration fails closed even locally. `NODE_ENV=test`
outside Vercel ignores all provider credentials and uses memory. Tests can inject a
shared fake store, clock or fake HTTP boundary; ordinary tests never call Upstash.
Demo stays browser-only and does not acquire server quotas. The ordinary suite
checks concurrency, shared instances, normalization, windows, route coverage,
spoofing assumptions, failure/recovery, generic responses and the REST boundary.
It does not establish actual Vercel rewriting or execute Lua against live Upstash.

**Manual setup before a later deployment (not performed by this PR):**

1. Provision a dedicated Upstash Redis database near the Function region. Use one
   database for all production instances, with separate databases for previews and
   staging. Size/monitor request and storage quotas; provider exhaustion denies
   protected requests. Configure the backend project's REST URL and write-capable
   REST token as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. Generate an independent random secret of at least 32 characters and configure
   `RATE_LIMIT_KEY_SECRET` identically on all instances of that environment. Keep all
   three variables backend-only. Rotation or changing the Redis database resets
   outstanding quotas; coordinate changes across instances. Do not configure
   `TEST_DATABASE_URL` on Vercel.
3. In an isolated staging deployment, verify platform IP rewriting on both the
   custom and deployment domains while supplying forged forwarding headers. Check
   stable identity and shared 429 enforcement across concurrent/warm/cold instances.
   Never perform load tests against real user accounts or production Redis.
4. Exercise registration/resend/verification, failed and successful login,
   forgot/reset, account send/verify/update, refresh and interest with test
   accounts. Check 429/Retry-After, natural window recovery and separate identities.
   Simulate unavailable configuration/provider in staging and check fail-closed 503
   behavior on abuse-sensitive routes, refresh fallback/recovery, successful logout
   revocation, and unaffected normal CRUD.
5. Check browser error feedback and retry after the window, then demo entry/account/
   logout with the backend unavailable to confirm no network fallback. No UI files
   changed; keyboard/mobile smoke checks should confirm the existing forms still
   display server errors and remain usable. These manual checks are not reported
   as executed by unit tests.

Remaining limitations: IP rotation across networks/botnets, login aliases, targeted
quota exhaustion, shared-NAT collisions, traffic before the limiter (JSON parsing,
CORS and network capacity), Redis availability/cost and fixed-window boundary
bursts. This is not CAPTCHA, WAF/DDoS protection, email delivery reliability or a
redesign of existing enumeration-sensitive verification/registration responses.
Monitor real traffic before tuning quotas. No migration is needed, 001/002 are
unchanged, and no 003, V2 product feature or deployment is part of P0C.

## Deploy the API on Vercel with Neon

Create a separate Vercel project from this repository and set its Root Directory to `backend`. Use the Other framework preset and add the production environment variables from `backend/.env.example`; at minimum the deployment requires `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `DB_SSL=true`, `NODE_ENV=production`, `JWT_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `RATE_LIMIT_KEY_SECRET`. The three rate-limit settings are backend-only and are also required for Vercel previews. See the setup and failure policy below before deployment.

Before the next real deployment, configure the backend Vercel project's `MIGRATION_DATABASE_URL` with the direct endpoint for the same Neon branch/database as runtime `DATABASE_URL`. Verify its TLS trust and direct-connection status. Do not set `TEST_DATABASE_URL` there. The build fails closed without the direct migration URL; setting it is a manual operator step, not an action performed by tests or CI.

The `vercel-build` command applies pending migrations during deployment. Vercel automatically detects the exported Express application in `server.js` and deploys it as one Vercel Function, preserving nested REST routes such as `/api/account/me`. After the deployment is healthy:

1. Add `api.car-remind.gr` as a custom domain in the backend Vercel project.
2. Replace the old Render DNS record with the CNAME value shown by Vercel.
3. Verify `https://api.car-remind.gr/api/health`, registration and login.
4. Remove the old Render service only after the production checks pass.

Do not store the Neon connection string or application secrets in Git; configure them through Vercel Environment Variables and the local ignored `.env` file.

## API

All routes use the `/api` prefix. The complete machine-readable contract is available in [`docs/openapi.yaml`](docs/openapi.yaml) and can be opened in Swagger Editor.

| Area | Endpoints |
| --- | --- |
| Authentication | `POST /login`, `/refresh`, `/logout`, `/register`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/verify-reset-code`, `/reset-password` |
| Vehicles | `GET/POST /vehicles`, `GET/PUT/PATCH/DELETE /vehicles/{id}`, `POST /vehicles/{id}/archive`, `POST /vehicles/{id}/restore` |
| Maintenance | `GET/POST /maintenances`, `PUT/DELETE /maintenances/{id}` |
| Costs | `GET/POST /costs`, `PUT/DELETE /costs/{id}` |
| Account | `GET /account/me`, account change-code flow, notification recipients |
| Notifications | `GET /notifications` |
| Administration | User CRUD under `/users` (admin role required) |
| Automation | `GET /cron/maintenance` with `X-Cron-Secret` |

### Email and maintenance reminder operation

Resend submission is successful only when its SDK returns no provider error. Returned provider errors and thrown/network failures are handled inside the email service; responses and logs do not include recipients, verification/reset codes, tokens or provider secrets. Newly stored security codes are removed when their email cannot be submitted. Registration keeps the newly created unverified account and returns `VERIFICATION_EMAIL_UNAVAILABLE`, directing the user to request a new code. Forgot-password and resend-verification responses remain account-enumeration neutral and do not claim that a message was sent.

The reminder endpoint selects only active users' noncompleted maintenance on active (non-archived) vehicles with a non-null due date and notification offset whose exact `next_date - notification_days` is today. A zero-day offset therefore sends on the due date. Each reminder targets the normalized primary account email plus active extra email recipients, with duplicates removed within that reminder. Submission runs with at most four concurrent provider calls; one recipient failure does not stop unrelated recipients. The response reports `candidateReminders`, `recipientsAttempted`, `submitted`, `failed`, `skippedNoRecipients` and `recipientLookupFailures`. `submitted` means accepted by the provider, not delivered to an inbox.

### P3a vehicle archive foundation

Migration `003_vehicle_identity_archive.js` additively introduces nullable vehicle identity/purchase metadata, `archived_at`, and positive `revision`. It does not relax the required legacy chassis number and does not infer VIN, plate, make, country, fuel or purchase data. Vehicle detail and allowlisted PATCH are available without activating archive as the foundation for P3b.

`VEHICLE_ARCHIVE_ENABLED` is false unless set exactly to `true`. While false, an omitted vehicle-list state retains the legacy `all` behavior and legacy `DELETE /vehicles/{id}` remains a physical cascade delete. Archive/restore return `VEHICLE_ARCHIVE_DISABLED`. After a separately coordinated activation, the omitted list default becomes `active`, archive/restore become available, and legacy vehicle DELETE returns `VEHICLE_ARCHIVE_REQUIRED` instead of destroying history. Explicit `state=active|archived|all` filters and archive-aware reminder exclusion are always available. Full administrator account deletion remains separate and continues to delete the complete owned graph. P3b Vehicle Detail/archive UI activation is still pending.

No scheduler is configured in this repository. Configure an external scheduler manually to call `GET /api/cron/maintenance` with the exact `X-Cron-Secret` header. The endpoint fails closed when `CRON_SECRET` is missing. Current exact-date reminders have no durable delivery ledger: repeating the endpoint can submit duplicates, while missing a day's invocation can miss reminders. Do not configure automatic retries that assume idempotency; durable deduplication, retry and catch-up belong to the future notification-delivery phase.

## Test and quality checks

```bash
cd backend
npm run check
npm test
npm audit --omit=dev
```

The test suite covers login, refresh, logout, expired tokens, inactive users, route protection, ownership isolation, vehicle/cost/maintenance CRUD, registration/reset validation and the browser-only portfolio flow. GitHub Actions runs backend tests, syntax checks, frontend syntax checks and the production dependency audit on every push and pull request.

## Security decisions

- Passwords are hashed with bcrypt; legacy plaintext rows are upgraded after one successful login.
- Refresh tokens are random, stored only as SHA-256 hashes and sent through HttpOnly cookies.
- Password changes revoke active refresh sessions.
- Authenticated resources are always filtered by the verified token user, never by a body-provided user ID.
- Security-sensitive POSTs use distributed Upstash Redis rate limits; Helmet adds browser security headers. Normal authenticated CRUD is not rate limited by this layer.
- User-controlled frontend values are escaped before insertion into generated markup.
- The cron route fails closed when `CRON_SECRET` is missing.
- Reminder selection verifies user/vehicle ownership joins and excludes inactive users, archived vehicles and completed maintenance.

## Technical decisions and challenges

**Zero-cost demo architecture.** The hosted demo must remain available even when the database is paused. A small browser store mirrors the API contract, which avoids maintaining a second demo UI and prevents demo visitors from modifying real records.

**Safe schema evolution.** The original SQL snapshot dropped tables and contained plaintext accounts. It was replaced with ordered, auditable migrations plus a separate opt-in development seed.

**Session compatibility.** Short-lived access tokens keep API authorization stateless, while revocable refresh-token records support logout, inactive-account enforcement and password-change invalidation.

**Vanilla frontend hardening.** The application remains framework-free. Shared `ui.js` and `ui.css` provide escaping, feedback, confirmation and modal accessibility without a rewrite.

## Roadmap

- Mileage history and recurring maintenance templates
- Receipt uploads and PDF export
- Personal-data export and account deletion
- Notification preferences
- Installable PWA experience
- Team invitations and shared company fleets in version 2

## Project metadata

- [Changelog](CHANGELOG.md)
- [MIT License](LICENSE)
- [OpenAPI specification](docs/openapi.yaml)

Developed by [Panagiotis Eleftheriadis](https://github.com/panagiotiseleftheriadis) as a full-stack portfolio project.
