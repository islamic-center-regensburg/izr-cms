# izr-cms

## Running Directus

Copy `.env.example` to `.env` and set a strong `DB_PASSWORD`, a long random
`SECRET`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD`. Keep the secret stable
across restarts and keep `.env` private. If you change `DIRECTUS_PORT`, update
`PUBLIC_URL` to match. The port is bound to localhost by default.

Run `make up`, then open `http://localhost:8055` (or your configured port).
Use `make logs` to follow logs, `make restart` to restart services, and
`make down` to stop them without removing their volumes. PostgreSQL data,
Directus uploads, and schema ownership use persistent Docker volumes. Back up
and restore these volumes together. The database credentials initialize a new
volume only; changing them in `.env` does not update an existing PostgreSQL
user.

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

One record per date. `date` is the primary key, and `fajr`, `sunrise`, `dhuhr`,
`asr`, `maghrib`, and `isha` are required local times. `jumuah` is an optional,
separate Friday reference time, required when calculating Jumu'ah iqama offsets.
A CSV should use the header `date,fajr,sunrise,dhuhr,jumuah,asr,maghrib,isha`,
ISO dates (`YYYY-MM-DD`), and 24-hour times (`HH:MM:SS`); leave `jumuah` empty
on other days.

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

`news_translations` contains `id`, `news_id`, `languages_code`, required `title`,
and required plain-text `body`. `events_translations` contains `id`, `events_id`,
`languages_code`, required `title`, optional rich-text HTML `description`, and
optional plain-text `location`. Edit them through the parent collection's translation editor.
Dates and publication status are shared across languages.

Deleting news or an event deletes its translation records. Languages referenced
by translations cannot be deleted. All three translations are not required for
each item, and the schema does not enforce one record per item/language pair;
API writers should avoid duplicates. Display clients must explicitly choose a
language and handle missing translations.

For example, create news via `/items/news` with:

```json
{
  "status": "draft",
  "translations": [
    { "languages_code": "de", "title": "Neuigkeiten", "body": "Willkommen." },
    { "languages_code": "en", "title": "News", "body": "Welcome." },
    { "languages_code": "ar", "title": "أخبار", "body": "مرحباً." }
  ]
}
```

## Screen schemas

The `schemas/screens` namespace configures one mosque display. There is no
screens inventory, Hijri-date configuration, or prayer/countdown mode.

### `screen_config`

A Directus singleton with `timezone`, `languages`, `default_language`,
`language_rotation_seconds`, `theme`, `orientation`,
`refresh_interval_seconds`, and `show_clock`. Create/save its settings in
Directus before using the display. Set the IANA timezone explicitly; it defaults
to `UTC`, not the mosque's location.

Supported languages are `de`, `en`, and `ar`; the CSV field is exposed as an
array by Directus. The initial selection is all three, with German as the
default. The default language must be included in the selection. Language
rotation is ignored for a single selected language. The display client must
validate the timezone and language selection, including this cross-field rule.
Theme defaults to `dark` and orientation to `landscape`; `auto` theme follows
the display device's preferred color scheme.

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
`name`, and optional `description`. Description uses the WYSIWYG rich-text HTML
editor and is stored as text. Edit translations through the campaign's
translation editor. Deleting a campaign cascades to its translations; referenced
languages cannot be deleted. As with other content translations, API writers
must avoid duplicate language records and handle missing translations.

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

The `seeds` directory contains example data for development, organized by
namespace with one YAML file per collection (`collection` plus `items`). It is
loaded by `scripts/seed-data.js` after schema synchronization, and only when
`CMS_ENV=dev` is set (see `.env`; the Compose default is `prod`, which skips
seeding entirely).

Each collection is seeded only when it is completely empty, so existing data
is never modified; emptying a collection re-seeds it on the next start.
Singletons such as `screen_config` are seeded when unsaved. The donation seeds
reference campaign ids 1 and 2, which assumes campaigns were seeded into a
fresh database. Prayer times cover 2026-11-15 to 2026-11-21 as examples.
Seed items may only use declared fields of managed collections. Rebuild the
image after editing seeds.

Seeding example data is separate from the inline `items` in schema files
(such as the `languages` records), which are reference data created in every
environment.