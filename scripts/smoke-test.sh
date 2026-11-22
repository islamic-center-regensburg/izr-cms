#!/bin/sh
# Smoke test against a running CMS. Usage: ADMIN_TOKEN=... scripts/smoke-test.sh [base_url]
set -eu

BASE_URL="${1:-http://127.0.0.1:${DIRECTUS_PORT:-8055}}"
: "${ADMIN_TOKEN:?ADMIN_TOKEN is required}"

fail() { echo "FAIL: $*" >&2; exit 1; }

health=$(curl -fsS "$BASE_URL/server/health") || fail "/server/health unreachable"
echo "$health" | grep -q '"status":"ok"' || fail "unhealthy: $health"
echo "OK /server/health"

# Collections that must be readable; the first two must also contain seeded data.
for collection in events news prayer_times campaigns donations screen_config screen_sections; do
  body=$(curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/items/$collection?limit=1&fields=*") \
    || fail "GET /items/$collection failed"
  echo "$body" | grep -q '"data"' || fail "/items/$collection returned no data key: $body"
  echo "OK /items/$collection"
done

for collection in events prayer_times; do
  body=$(curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/items/$collection?limit=1&fields=*")
  echo "$body" | grep -q '"data":\[\]' && fail "$collection has no seeded items (CMS_ENV=dev required)"
done

# Translations must expose slugs for the website.
body=$(curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/items/events?limit=1&fields=translations.slug")
echo "$body" | grep -q '"slug":"' || fail "events translations missing slug: $body"
echo "OK events translations"

# An invalid token must be rejected.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer invalid-token" "$BASE_URL/items/events")
[ "$code" = "401" ] || fail "invalid token returned $code, expected 401"
echo "OK auth rejection"
