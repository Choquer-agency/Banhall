#!/bin/bash
# Dev-side setup for the client uploader kit (run this, not the client).
#
# Auto-provisions the INGEST_API_KEY on the Convex deployment (generating and
# setting one if missing), resolves the deployment site URL, and writes a
# ready-to-run uploader-config.json. Then the kit works immediately —
# double-click Run-Uploader.command / Run-Uploader.bat.
#
# Usage:
#   bash setup.sh                # dev deployment (URL from .env.local)
#   bash setup.sh --prod --url https://<prod-deployment>.convex.site
#   bash setup.sh --zip          # also produce ~/Desktop/banhall-uploader.zip

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PROD=0; MAKE_ZIP=0; URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prod) PROD=1 ;;
    --zip) MAKE_ZIP=1 ;;
    --url) shift; URL="$1" ;;
    *) echo "Unknown flag: $1"; exit 2 ;;
  esac
  shift
done

# Plain string (not array): empty arrays trip `set -u` on macOS bash 3.2.
PROD_FLAG=""
if [ "$PROD" -eq 1 ]; then PROD_FLAG="--prod"; fi

# 1. Resolve the site URL.
if [ -z "$URL" ]; then
  if [ "$PROD" -eq 1 ]; then
    echo "For --prod, pass --url https://<prod-deployment>.convex.site" >&2
    exit 1
  fi
  URL="$(sed -n 's/^PUBLIC_CONVEX_SITE_URL=//p' "$REPO_ROOT/.env.local" | head -1)"
  if [ -z "$URL" ]; then
    echo "Could not read PUBLIC_CONVEX_SITE_URL from .env.local — pass --url" >&2
    exit 1
  fi
fi
case "$URL" in
  https://*) : ;;
  *) echo "URL must start with https:// (got: $URL)" >&2; exit 1 ;;
esac

# 2. Get or create the ingest key on the deployment.
cd "$REPO_ROOT"
KEY="$(npx convex env get INGEST_API_KEY $PROD_FLAG 2>/dev/null || true)"
if [ "${#KEY}" -lt 32 ]; then
  echo "No INGEST_API_KEY on the deployment — generating one..."
  KEY="$(openssl rand -hex 32)"
  npx convex env set INGEST_API_KEY "$KEY" $PROD_FLAG
fi

# 3. Write the kit config.
cat > "$SCRIPT_DIR/uploader-config.json" <<EOF
{
  "url": "$URL",
  "key": "$KEY",
  "root": ""
}
EOF
echo "Wrote uploader-config.json"
echo "  url:  $URL"
echo "  key:  ${KEY:0:6}… (${#KEY} chars, stored on the deployment)"
echo "  root: auto-detect (OneDrive…/Applications)"

# 4. Optional hand-off zip (preserves the Mac launcher's exec bit).
if [ "$MAKE_ZIP" -eq 1 ]; then
  ZIP="$HOME/Desktop/banhall-uploader.zip"
  rm -f "$ZIP"
  (cd "$SCRIPT_DIR" && zip -qry "$ZIP" . -x "setup.sh" -x "DEV-HANDOFF.md" -x "upload-log.txt")
  echo "Wrote $ZIP (setup.sh and dev notes excluded)"
fi

echo ""
echo "Kit is ready: double-click Run-Uploader.command (Mac) or Run-Uploader.bat (Windows)."
