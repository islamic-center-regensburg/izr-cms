# izr-cms

## Running Directus

`make up` creates `.env` with random credentials on first use (it never
overwrites values), builds the image, applies pending revisions, and waits
until the backend is healthy; then open `http://localhost:8055`. Set
`ADMIN_EMAIL` and read `ADMIN_PASSWORD` from `.env`. Keep `.env` private. If you
change `DIRECTUS_PORT`, update `PUBLIC_URL` to match. The port is bound to
localhost.

`make logs` follows the logs, `make restart` re-runs startup, `make down` stops
the stack without removing volumes. Back up the database and uploads volumes
together. Database credentials initialize a new volume only.

**Rebuild the image after editing schemas, revisions, access, seeds or scripts**
(`make up`): they are baked into it.

`make reseed CONFIRM=yes` wipes the database and uploads volumes and re-applies
everything from scratch. It destroys all data, including static tokens. Never run
it against data worth keeping.

### Startup

On every start the entrypoint runs Directus `bootstrap`, starts a temporary
private server and runs `scripts/sync.js`: validate all YAML, apply pending
**revisions**, reconcile **access policies** and service users, enable the MCP
server (only when `MCP_TOKEN` is set), and load **seeds**. Only then does the
public server start. Any failure exits nonzero and nothing is served.

### Schemas and revisions

`schemas/<domain>/*.yaml` is the data model and the only place it is edited.
A change becomes a revision:

1. Edit the YAML, then `make revision m="short name"`. This starts a throwaway
   stack, diffs the YAML against the newest revision and writes
   `revisions/NNNN_name/` (`schema.json`, `changes.json`). Read the change list;
   every `-` line loses data.
2. If data has to move, add `up.sql` / `down.sql` next to it (data only, no
   `ALTER`/`CREATE`/`DROP`).
3. `make up` applies it. Commit the whole folder with the YAML.

Never edit a revision that was applied anywhere; make a new one. Roll back with
`make migrate-down` (newest first, with the image that contains the revision),
then deploy the older image. `make migrate-status` shows what is applied;
`make check` (also run in CI) fails if the YAML changed without a revision.
Revisions are recorded in `app_meta.revisions`. All primary keys of seeded
collections are UUIDs (`languages` uses `code`, `prayer_times` the date), so seed
rows have stable keys. Money is stored as exact decimals in euros.

### Deployment

`.github/workflows/deploy.yml` runs when a pull request is merged (a push) into
`dev` or `main` and calls the shared workflow of the superproject
(`islamic-center-regensburg/izr`, `.github/workflows/deploy.yml`). That workflow
posts to the deploy hook held in an organization secret: `DEPLOY_WEBHOOK_CMS_DEV`
for `dev`, `DEPLOY_WEBHOOK_CMS_PROD` for `main`. Runs of one branch are queued,
not cancelled.

### Environment variables

See `.env.example`: database and admin credentials, `SECRET`, `CMS_ENV`
(`dev` or `prod`; set it explicitly everywhere), `SEED_PUBLISH_DEMO` (never in
production), and one token per service user (below).

## Prayer schemas

The `schemas/prayers` directory contains one YAML collection definition per
file. These definitions use the Directus collection-creation payload shape,
with optional `relations` and seed `items`; they are not Directus schema snapshots.
On startup, the entrypoint bootstraps
Directus, starts it privately, and applies the definitions via the schema API
before starting the public server. The configured admin credentials must
remain valid for synchronization. A CSV import workflow has not yet been
implemented.

**Schema synchronization can delete data.** Fields removed from a managed
collection, and collections removed from the YAML definitions, are deleted
along with their data. Other collections are preserved. A collection whose
name appears in a YAML file becomes managed, even if it already exists.
Explicit field and collection metadata is applied; unspecified metadata and
relations on retained fields are preserved unless a collection declares a
`relations` array, which defines its complete set of outgoing relations.
Seed `items` are created only when their primary key is missing; existing items
are not overwritten. An empty schemas directory deletes all tracked collections.
Rebuild the image after editing schemas.

### `prayer_times`

One record per date. `date` is the primary key, and `hijri`, `fajr`,
`sunrise`, `dhuhr`, `asr`, `maghrib`, and `isha` are required. `hijri` is the
corresponding Hijri calendar date, stored as text in `YYYY-MM-DD` (Hijri
year-month-day) order since it is not a Gregorian date; it is not validated
against `date`. `jumuah` is an optional, separate Friday reference time,
required when calculating Jumu'ah iqama offsets. A CSV should use the header
`date,hijri,fajr,sunrise,dhuhr,jumuah,asr,maghrib,isha`, ISO Gregorian dates
(`YYYY-MM-DD`) for `date`, Hijri dates (`YYYY-MM-DD`) for `hijri`, and 24-hour
times (`HH:MM:SS`); leave `jumuah` empty on other days.

### `iqama_times`

Each record applies to a `prayer` and `weekday` every week. Multiple records
for the same prayer and weekday represent multiple iqama times, all of which
should be displayed. Sunrise is not a prayer and has no iqama. Jumu'ah rules
apply on Fridays only and use the separate `jumuah` time for offsets.

`type` is either `fixed` or `offset`. For `fixed`, set `fixed_time` to the
local time and leave `offset_minutes` empty. For `offset`, set
`offset_minutes` to signed minutes relative to the daily prayer time and leave
`fixed_time` empty. Zero is a valid offset. Resolve the weekday from the
prayer date in the mosque's local timezone; an offset can cross midnight.

The mutually exclusive `fixed_time`/`offset_minutes` rule and Friday-only
Jumu'ah rules are not yet enforced by the schema. Consumers must reject invalid
records, or an offset with no corresponding reference time, rather than silently
choosing a value.

## Content schemas

The `schemas/content` namespace contains news and event information only;
event registration is not included.

### `news`

Fields: auto-increment `id`, a `translations` editor, `status`
(`draft`, `published`, or `archived`; defaults to `draft`), and optional
`published_at` and `expires_at` timestamps.

Display clients should show only published news whose publication time has
arrived and whose expiry has not passed. An empty publication time means
immediate visibility when published; an empty expiry means no expiry.

### `events`

Fields: auto-increment `id`, a `translations` editor, required `starts_at`,
optional `ends_at`, and `status` (`draft`,
`published`, `cancelled`, or `archived`; defaults to `draft`).

Dates are timestamps representing instants; submit ISO 8601 values with a
timezone offset and display them in the mosque's timezone. Display clients
must explicitly filter statuses and dates; setting a status does not grant
public access. End/expiry times should follow their corresponding start times;
this cross-field rule is not yet enforced by the schemas.

### Content translations

The shared `languages` collection is seeded with `de`, `en`, and `ar`. German
and English use `ltr`; Arabic uses `rtl`. German is the initial editor language.

`news_translations` contains `id`, `news_id`, `languages_code`, required
`title`, required `slug`, required plain-text `body`, and optional
`meta_title`/`meta_description`. `events_translations` contains `id`,
`events_id`, `languages_code`, required `title`, required `slug`, optional
rich-text HTML `description`, optional plain-text `location`, and optional
`meta_title`/`meta_description`. Edit them through the parent collection's
translation editor. Dates and publication status are shared across languages.

`slug` is the URL path segment for that language (lowercase letters, digits,
and hyphens only, e.g. `community-dinner`); it must be unique per language
within its collection, but this is not enforced by the schema, since the
declarative field format here only supports single-column, not composite,
unique constraints. `meta_title` and `meta_description` are optional SEO
overrides for that language; display clients should fall back to `title`
and a trimmed `body`/`description` when empty.

Deleting news or an event deletes its translation records. Languages referenced
by translations cannot be deleted. All three translations are not required for
each item, and the schema does not enforce one record per item/language pair;
API writers should avoid duplicates, including duplicate slugs per language.
Display clients must explicitly choose a language and handle missing translations.

For example, create news via `/items/news` with:

```json
{
  "status": "draft",
  "translations": [
    { "languages_code": "de", "slug": "neuigkeiten", "title": "Neuigkeiten", "body": "Willkommen." },
    { "languages_code": "en", "slug": "news", "title": "News", "body": "Welcome." },
    { "languages_code": "ar", "slug": "akhbar", "title": "أخبار", "body": "مرحباً." }
  ]
}
```

## Screen schemas

The `schemas/screens` namespace configures one mosque display. There is no
screens inventory, Hijri-date configuration, or prayer/countdown mode.

### `screen_config`

A Directus singleton with `timezone`, ordered `languages`,
`mode` (`automatic` or `manual`), optional `manual_section`,
`manual_language` (`de`, `en`, or `ar`), `orientation`,
`refresh_interval_seconds`, and `show_clock`. Create/save its settings in
Directus before using the display. Set the IANA timezone explicitly; it defaults
to `UTC`, not the mosque's location.

Supported languages are `de`, `en`, and `ar`; the CSV field is exposed as an
array by Directus. The initial selection is all three. The first configured
language starts automatic rotation and is the translation fallback. The screen
always uses a dark theme. Orientation defaults to `landscape`.

### `screen_sections`

Fields: `id`, internal `name`, `type`, `enabled`, `sort`, `duration_seconds`,
optional `visible_from`/`visible_until`, and `max_items`. Types are `prayer_times`,
`news`, `events`, and `campaign_progress`. Campaign progress uses the donations
namespace.

Display clients should fetch sections in `sort,id` order and rotate only enabled
sections within their visibility window. Empty bounds mean no restriction; a
section is visible from its start inclusive until its end exclusive.
`visible_until` must follow `visible_from` when both are set; this cross-field
rule is not enforced by the schema. Durations, refresh intervals, and item limits
must be positive.

Sections reuse existing collections rather than duplicate their content.
`max_items` is ignored for prayer times. News and events still require their
own publication/date filters and language selection. These schemas store
configuration only; rendering and rotation belong to the display application.

The localized `news_translations`, `events_translations`, and
`campaigns_translations` schemas include an optional `screen_summary` field for
short display copy. It is intentionally separate from the long-form body or
description; the screen does not fall back to those fields. Summaries support
basic HTML paragraphs, line breaks, emphasis, and lists. The screen strips
attributes and unsupported elements before rendering.

## Donation schemas

The `schemas/donations` namespace contains three collections. Donations are
anonymous: no donor names, contact details, or payment credentials are stored.

### `campaigns`

Fields: `id`, `translations`, optional positive `target_amount`, `currency`
(defaults to `EUR`), optional `starts_at`/`ends_at`, and `status` (`draft`,
`active`, `completed`, or `archived`; defaults to `draft`).

### `campaigns_translations`

Uses the shared `languages` collection for `de`, `en`, and `ar`, with Arabic
right-to-left editing. Fields: `id`, `campaigns_id`, `languages_code`, required
`name`, required `slug`, optional `description`, and optional
`meta_title`/`meta_description`. Description uses the WYSIWYG rich-text HTML
editor and is stored as text. `slug` is the URL path segment for that language
and must be unique per language within the collection; as with the content
translations, this is not enforced by the schema. `meta_title` and
`meta_description` are optional SEO overrides for that language. Edit
translations through the campaign's translation editor. Deleting a campaign
cascades to its translations; referenced languages cannot be deleted. As with
other content translations, API writers must avoid duplicate language records
and duplicate slugs, and handle missing translations.

### `donations`

Fields: `id`, optional `campaign`, positive `amount`, `currency` (defaults to
`EUR`), required `donated_at`, `method` (`cash`, `bank_transfer`, or `online`),
and `status` (`pending`, `confirmed`, or `refunded`; defaults to `pending`).
An empty campaign means a general donation. Campaigns referenced by donations
cannot be deleted; archive them instead.

Amounts use decimal precision 12 and scale 2. Currency fields validate the
three-uppercase-letter format, not membership in ISO 4217. Donation currency
must match its campaign; this cross-collection rule is not enforced by the
schema. Do not change a campaign's currency after recording donations against
it. Campaign end dates should follow start dates; this is also a consumer-side
rule.

Calculate campaign progress from confirmed donations in the campaign's currency;
do not sum mixed currencies. Refunded donations are excluded entirely; partial
refunds are not modeled. Progress totals and percentages are not stored.
Public screens should receive campaign information and aggregate progress only,
not access to individual donation records. These schemas do not grant public
permissions or implement payment processing or display logic.

## Seed data

`seeds/` has two folders, one YAML file per collection (`collection` plus
`items`), applied in file-name order (`01-`, `02-`, ...):

- `seeds/reference/`: loaded in every environment. Only `languages` (de, en, ar).
- `seeds/examples/`: loaded only when `CMS_ENV=dev`: news, events, campaigns,
  donations, prayer and iqama times, screen sections and the screen config.

Every item has a stable primary key; translations are separate rows, not nested.
Seeding creates only **missing rows** and never overwrites existing ones, so
editing a seed does not update existing installs (use a revision's `up.sql`).
`SEED_PUBLISH_DEMO=true` publishes example rows that are still drafts. In `prod`
the screen config and sections are not seeded: create them in the admin.

## Access policies and service users

`access/*.yaml` defines managed roles, policies and service users. Policies are
matched by name and owned by the YAML: edits made in the Directus UI do not
survive a restart. Each file names the environment variable that holds its
user's static token (`user.token_env`); on every start the token from that
variable is applied to the user. An unset variable skips the user, a malformed
one (fewer than 32 letters, digits, `-`, `_`) fails startup. Tokens are never in
the YAML, image or logs. Do not edit a managed user in the UI; restart to reset
it.

| File | User | Token variable | Access |
| --- | --- | --- | --- |
| `screen.yaml` | IZR Screen | `SCREEN_TOKEN` | read-only, what is on air now |
| `website.yaml` | IZR Website | `WEBSITE_TOKEN` | read-only, published content, files in the approved folder |
| `mcp.yaml` | IZR MCP | `MCP_TOKEN` | read content; create and update news and events as drafts only; no delete, no donations, no users or schema |

Locally `tools/init-env.mjs` writes random tokens to `.env`. In deployments
Terraform (`izr-infra`) generates each token, stores it in Infisical, and passes
it to the CMS and to the application that uses it (as `DIRECTUS_READ_TOKEN`
for the screen and website).

The website policy lets the server read files only in the **IZR approved website
assets** folder (`8fa6098b-fd71-45a6-a092-19d6b3f53c31`). Put only files safe for
public distribution there. The policy permits individual donation rows (not just
aggregates) to the server credential.

The MCP server is at `/mcp` and needs `Authorization: Bearer <MCP_TOKEN>`. It is
enabled by startup when `MCP_TOKEN` is set, with deletes disallowed.
