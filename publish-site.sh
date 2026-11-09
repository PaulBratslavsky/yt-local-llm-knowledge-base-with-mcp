#!/usr/bin/env bash
# Rebuild the static site from the library and publish it.
#
#   yarn site:publish            build + deploy to the live URL
#   yarn site:publish --draft    build + deploy to a preview URL instead
#
# The build reads Strapi with STRAPI_BASE_URL and the yt-kb-site token from
# site/.env, so the Strapi host has to be running. The loader in
# site/src/lib/strapi.ts fails the build when Strapi is unreachable, answers
# with an error, returns fewer videos than it reports, or has no generated
# summary, so this script does not check Strapi itself.

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

LIVE_URL="https://boisterous-lamington-cc0eed.netlify.app"

[[ "${SITE_SKIP_STRAPI_FETCH:-}" == "1" ]] && {
  printf '\n\033[31m%s\033[0m\n' "SITE_SKIP_STRAPI_FETCH=1 is exported in this shell.
That flag is for typechecking; a build with it set loads no videos.
Unset it and run this again." >&2
  exit 1
}

# ── 1. Build. The loader fails the build on an unreachable Strapi, a short
#       read or an empty library; the output guard fails it if any retrieval
#       state reached the output. ────────────────────────────────────────────
say "Building"
yarn --cwd ./site build

PAGES=$(find site/dist -name 'index.html' | wc -l | tr -d ' ')
VIDEO_PAGES=$(find site/dist/v -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
INDEX_KB=$(( $(wc -c < site/dist/search-index.json) / 1024 ))
echo "  ${PAGES} pages (${VIDEO_PAGES} videos) · search index ${INDEX_KB} KB"

# ── 2. Publish. ──────────────────────────────────────────────────────────────
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
  say "Deploying a PREVIEW — the live site is NOT being updated"
  (cd site && npx netlify deploy --dir=dist)
  # A draft run used to end on "Done." next to a URL, which reads exactly
  # like a successful publish. It is not one, and the difference is a
  # whole day of stale content before anyone notices.
  printf '\n\033[33m%s\033[0m\n' "PREVIEW ONLY — the live site still shows the previous build.
Open the draft URL above to check it, then publish for real with:
  yarn site:publish"
else
  say "Deploying to the live URL"
  (cd site && npx netlify deploy --prod --dir=dist)
  printf '\n\033[32m%s\033[0m\n' "Published live: ${LIVE_URL}"
fi
