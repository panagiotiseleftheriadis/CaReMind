# Changelog

All notable changes to CaReMind are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Vercel Function entry point and deployment configuration for the Express API.
- Transactional one-time importer for copying the existing MySQL data into Neon PostgreSQL.
- Database-backed health endpoint for deployment verification.

### Changed

- Production persistence and ordered migrations now target PostgreSQL/Neon instead of MySQL.
- Serverless database pooling is limited per instance to protect the Neon connection allowance.

## [1.0.0] - 2026-08-13

### Added

- Browser-only portfolio demo with realistic vehicle, maintenance and cost data.
- Responsive branded login intro and mobile autofill protection.
- Non-destructive MySQL migration runner and opt-in development seed.
- API, authorization and demo-flow automated tests.
- GitHub Actions checks for tests, syntax and dependency vulnerabilities.
- Shared accessible toast, confirmation, loading and modal UI behavior.
- OpenAPI contract and recruiter-focused project documentation.

### Changed

- Password storage now uses bcrypt across registration, account and admin flows.
- Authentication uses validated JWT configuration and revocable refresh sessions.
- Vehicle, maintenance and cost writes enforce ownership and input validation.
- Notifications return only the signed-in user's reminder data.
- Frontend-generated markup escapes user-controlled values.

### Removed

- Public notification test endpoint that exposed contact information.
- Plaintext admin and guest seed passwords.
- Browser storage of administrator-created user passwords.
- Destructive legacy SQL bootstrap files and redundant root npm manifest.
