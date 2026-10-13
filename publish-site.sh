#!/usr/bin/env bash
# Rebuild the static site from the live library and publish it.
#
#   yarn site:publish            build + deploy to the live URL
#   yarn site:publish --draft    build + deploy to a preview URL instead
#
# The build reads Strapi directly, so the stack has to be running. It refuses
# to publish a library it cannot verify is complete — see site/src/lib/strapi.ts.

set -euo pipefail

cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

# Reject anything unrecognised rather than falling through. A mistyped
# --draft used to leave DRAFT=false and publish to the live URL, which is
# the one mistake this script must not make quietly.
DRAFT=false
case "${1:-}" in
  "") ;;
  --draft) DRAFT=true ;;
  *) die "Unknown argument: $1
Usage: publish-site.sh [--draft]
  (no argument)  publish to the live URL
  --draft        publish to a preview URL instead" ;;
esac
[[ $# -le 1 ]] || die "Too many arguments. Usage: publish-site.sh [--draft]"

STRAPI_URL="${STRAPI_BASE_URL:-http://localhost:1340/api}"

[[ "${SITE_SKIP_STRAPI_FETCH:-}" == "1" ]] && {
  printf '\n\033[31m%s\033[0m\n' "SITE_SKIP_STRAPI_FETCH=1 is exported in this shell.
That flag is for typechecking; a build with it set loads no videos.
Unset it and run this again." >&2
  exit 1
}

# ── 1. Is there anything to build from? ──────────────────────────────────────
say "Checking Strapi at ${STRAPI_URL}"

if ! curl -sf --max-time 5 -o /dev/null "${STRAPI_URL}/videos?pagination%5BpageSize%5D=1"; then
  die "Strapi is not answering at ${STRAPI_URL}.
Start the stack first:  yarn start
Then run this again. (Publishing without it would ship an empty site, so the
build refuses rather than guessing.)"
fi

GENERATED=$(curl -s --max-time 10 \
  "${STRAPI_URL}/videos?filters%5BsummaryStatus%5D%5B%24eq%5D=generated&pagination%5BpageSize%5D=1" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["meta"]["pagination"]["total"])')

echo "  ${GENERATED} videos with a generated summary"
[[ "${GENERATED}" -gt 0 ]] || die "Nothing to publish: no video has a generated summary yet."

# ── 2. Build. The output guard runs as part of this and fails the build if
#       any retrieval state reached the output. ────────────────────────────────
say "Building"
yarn --cwd ./site build

PAGES=$(find site/dist -name 'index.html' | wc -l | tr -d ' ')
VIDEO_PAGES=$(find site/dist/v -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
INDEX_KB=$(( $(wc -c < site/dist/search-index.json) / 1024 ))
echo "  ${PAGES} pages (${VIDEO_PAGES} videos) · search index ${INDEX_KB} KB"

# Compare video pages only. Counting every index.html lets the home, topic
# and article pages pad the total, so a build that dropped most of the
# library could still clear the bar.
if [[ "${VIDEO_PAGES}" -lt "${GENERATED}" ]]; then
  die "Built ${VIDEO_PAGES} video pages from ${GENERATED} generated summaries.
Refusing to publish a partial library. Check the build output above."
fi

# ── 3. Publish. ──────────────────────────────────────────────────────────────
#
# The Netlify CLI reads the linked project from its WORKING DIRECTORY, not
# from --prefix or --dir. Run from the repo root it finds no link and quietly
# creates a brand new project instead of updating yours — which it did to me
# once. So: cd into site/, which is where the link and netlify.toml live.
[[ -f site/.netlify/state.json ]] || die "site/ is not linked to a Netlify project.
Link it once:  cd site && npx netlify link
Then run this again. (Without the link the CLI would create a new project
rather than updating the existing one.)"

if [[ "${DRAFT}" == true ]]; then
  say "Deploying a draft (not the live URL)"
  (cd site && npx netlify deploy --dir=dist)
else
  say "Deploying to the live URL"
  (cd site && npx netlify deploy --prod --dir=dist)
fi

say "Done."
