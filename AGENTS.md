# Project guide

This repository configures a Docker-based Directus 11.17.4 CMS backed by
PostgreSQL. See `README.md` for the data model, deployment, and access policies.

## Layout

- `schemas/<domain>/`: one YAML collection definition per file, including
  fields, relations, and optional inline reference items. These are project
  definitions, not Directus schema snapshots.
- `seeds/<domain>/`: collection example and configuration data.
- `policies/apps.yaml`: managed read-only application policies.
- `scripts/`: startup schema, seed, and policy reconciliation, unit tests, and
  the integration smoke test.
- `entrypoint.sh`: bootstraps Directus and runs synchronization before serving.

## Change safely

- Schema synchronization owns collections named in the YAML. Removing a managed
  field or collection deletes its data; unrelated collections are preserved.
  Review migrations against existing data, especially new required fields.
- Preserve existing snapshot metadata and unrelated collections when changing
  the schema loader. Apply relations after their collections and fields exist.
- Seed selection depends on `CMS_ENV`; production loads only the documented
  reference/configuration data. Collection seeds generally run only when the
  collection is empty, and inline reference items do not overwrite existing
  records. Do not assume changing a seed updates existing installations.
- Keep translations, language-specific slugs, and related seeds consistent.
  Slug uniqueness per language is currently an application responsibility.
- Maintain least-privilege policy boundaries; never commit credentials or tokens.
  Update the README when changing schema, seed, or access behavior.
- `make reseed` destroys database, upload, and schema-state volumes. Never run
  it against existing data without explicit approval; use isolated disposable
  Compose projects for destructive integration checks.

## Validation

- Run focused tests with `node --test scripts/<name>.test.js`; run all unit
  tests with `node --test scripts/*.test.js`.
- The CI workflow `.github/workflows/smoke-test.yml` documents the Docker smoke
  test and its required temporary credentials. Use an isolated environment;
  the workflow's cleanup removes volumes.
- `make up` rebuilds and starts the stack; `make restart` does not rebuild the
  image. Schema, seed, policy, and script changes require a rebuild.
