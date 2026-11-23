# izr-cms

## Running Directus

Copy `.env.example` to `.env` and set a strong `DB_PASSWORD`, a long random
`SECRET`, `ADMIN_EMAIL`, a strong `ADMIN_PASSWORD`, and `ADMIN_TOKEN` (any
fixed random string). Keep the secret stable across restarts and keep `.env`
private. If you change `DIRECTUS_PORT`, update `PUBLIC_URL` to match. The port
is bound to localhost by default.

Run `make up`, then open `http://localhost:8055` (or your configured port).
Use `make logs` to follow logs, `make restart` to restart services, and
`make down` to stop them without removing their volumes. PostgreSQL data,
Directus uploads, and schema ownership use persistent Docker volumes. Back up
and restore these volumes together. The database credentials initialize a new
volume only; changing them in `.env` does not update an existing PostgreSQL
user.

Use `make reseed` to wipe these volumes (database, uploads, and schema state)
and start fresh, so schemas are reapplied and example seed data is loaded
again from scratch. This destroys all existing data, including anything added
outside the seeds. Do not use this destructive command on production data.
`ADMIN_TOKEN` is assigned to the default admin user on bootstrap (Directus's
own mechanism). Service users are recreated after reseeding, but their manually
generated tokens are lost unless the operator separately provisions them.

Directus 11.17.4 includes MCP support. Enable it in the Directus admin settings
before connecting a client to `/mcp`, and use an appropriately scoped user.
For deployments beyond localhost, configure a public HTTPS URL and appropriate
network access.

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

The `seeds` directory is organized by namespace with one YAML file per
collection (`collection` plus `items`). After synchronizing **all** schemas,
`scripts/seed-data.js` selects seeds using `CMS_ENV`:

- `dev` (the default when absent, also in Compose and `.env.example`): all
  existing development samples, unchanged.
- `prod`: **only `languages`, `screen_config`, `screen_sections`, and
  `iqama_times`**. Languages come from inline schema items; the other three
  use existing seed files. No new iqama values are generated.
- Any other value fails startup explicitly.

Set `CMS_ENV=prod` for production. Fabricated/unverified `prayer_times` examples
and sample news, events, campaigns, and donations are excluded. Selection does
not delete existing demo rows or clear any collection; previously stored
data remains. Application policies and technical users are reconciled
independently of seed selection in both environments.

Each collection is seeded only when it is completely empty, so existing data
is not overwritten; emptying an eligible collection re-seeds it on the next
start. Singletons such as `screen_config` are seeded when unsaved. Development
also retains its existing missing screen-control-default backfill; production
leaves saved singleton values untouched. The donation seeds
reference campaign ids 1 and 2, which assumes campaigns were seeded into a
fresh database. Prayer times cover 2026-11-15 to 2026-11-21 as examples.
Seed items may only use declared fields of managed collections. Rebuild the
image after editing seeds.

Inline schema `items` use the same environment selection and are inserted
only for missing stable primary keys, preserving authored language records.

## Application access policies

`policies/apps.yaml` defines two Directus v11 policies, reconciled through the
Directus metadata API after schema synchronization on every container start,
including after a fresh database bootstrap. Rebuild with `make up`. They grant
only `read`, no Directus app or administrator access, and do not change public
permissions, existing roles, or tokens. The loader refuses conflicting IDs,
unexpected permissions, or a policy with admin/app access rather than taking
them over. To remove an obsolete permission from a managed policy, remove it
manually first; the loader deliberately does not delete permissions.

* **IZR screen read-only** (`0f184c48-3ce0-4b6a-9b5b-1e1dc908a301`):
  12 read permissions. Includes screen settings and sections, prayer and iqama
  times, languages, currently visible published news, upcoming published
  events, currently active campaigns and their translations and eligible
  donations. The screen currently has no asset proxy and no file permission.
* **IZR website read-only** (`918cff57-335b-40ae-a033-6551876d379b`):
  13 read permissions. Includes screen settings/sections, prayer and iqama
  times, languages, published news (including expired history but not future
  publications), published events including past details, active and completed
  campaigns, their translations, eligible donations, and approved website files.
  Draft and archived campaigns are intentionally inaccessible by slug.

Translation permissions also filter by their parent content. Donations are
restricted to confirmed/pending rows belonging to accessible campaigns and
the fields `campaign`, `amount`, `currency`, `donated_at`, `method`,
and `status` (plus `id` for the website); refunded, general and inaccessible-campaign donations are
excluded. These permissions permit individual anonymous donation rows to the
server credential, not just aggregates. The existing website RPCs return rows
to callers; do not treat the policy as an aggregate-only boundary.

The website's `/api/assets/:id` proxy can retrieve files only in the dedicated
**IZR approved website assets** folder
(`8fa6098b-fd71-45a6-a092-19d6b3f53c31`). This is an operator-curated
alternative to reverse-reference filtering: it does **not** automatically
verify that files are referenced by currently visible content. Put only files
safe for public distribution in this folder, and promptly remove files when
their content becomes private. Files outside it remain inaccessible to this
policy; existing thumbnails must be reviewed and moved there before they work
with the website policy. Folder membership grants access even when a file is
unreferenced or its content is no longer visible.

The loader creates active, role-less service users **IZR Screen API Service**
(`fd54cc51-521a-4d0c-b6f7-47949aa53bfe`) and **IZR Website API Service**
(`9cfece03-1c78-48b6-af2c-5567759de7cc`) with no email, each directly linked
only to its corresponding policy. It refuses mismatched users or extra access
links rather than taking them over. It neither generates nor reads or changes
their credentials; existing tokens survive ordinary restarts.

An administrator should manually generate a static token for each service user
in Directus and store it only in the corresponding application's server-side
`DIRECTUS_READ_TOKEN`. Never expose it to browsers or commit it. Permissions
are additive: review public access and avoid additional roles or policies that
could grant broader access. Verify permissions and asset access before switching
production traffic. A destructive reseed removes these manual tokens; separately
provision them securely or generate new ones and update the applications.