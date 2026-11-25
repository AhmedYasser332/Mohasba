#!/usr/bin/env bash
# ============================================================================
# Mohasba Tracker v2 — Weekly Verified & Encrypted Supabase Backup (pg_dump 17+)
#
# CRITICAL CONNECTION NOTE:
#   Set SUPABASE_DB_BACKUP_URL in a `chmod 600` env file (default:
#   /srv/mohasba/.backup.env) using the Supabase **Session Pooler URI** on
#   port **5432** (IPv4-safe). NEVER use the Transaction Pooler (port 6543),
#   which breaks pg_dump prepared statements and session state!
#
# Optional off-VPS encryption/upload env vars (in .backup.env):
#   AGE_RECIPIENT="age1..."             # Encrypt local copy with `age` public key
#   RCLONE_REMOTE="mohasba-crypt:backups" # Upload via encrypted `rclone crypt` remote
#   BACKUP_DIR="/srv/mohasba/backups"   # Local snapshot directory
#   KEEP_SNAPSHOTS="12"                 # Number of dated snapshots to retain
# ============================================================================
set -euo pipefail
umask 077

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/srv/mohasba/.backup.env}"
if [[ -f "$BACKUP_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$BACKUP_ENV_FILE"
fi

if [[ -z "${SUPABASE_DB_BACKUP_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_BACKUP_URL is unset (source $BACKUP_ENV_FILE or export it)." >&2
  exit 1
fi

if [[ "$SUPABASE_DB_BACKUP_URL" == *":6543/"* ]]; then
  echo "ERROR: Detected port 6543 (Transaction Pooler). Use the Supabase Session Pooler URI on port 5432." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found. Install postgresql-client-17 (PGDG repo)." >&2
  exit 1
fi

PG_DUMP_MAJOR="$(pg_dump --version | sed -nE 's/.* ([0-9]+)\..*/\1/p')"
if [[ -z "$PG_DUMP_MAJOR" || "$PG_DUMP_MAJOR" -lt 17 ]]; then
  echo "ERROR: pg_dump major version >= 17 required (found: $(pg_dump --version))." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-/srv/mohasba/backups}"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-12}"
DATE_STAMP="$(date -u +%Y-%m-%d)"
FINAL_FILE="${BACKUP_DIR}/mohasba-${DATE_STAMP}.sql.gz"
TMP_FILE=""

mkdir -p "$BACKUP_DIR"
TMP_FILE="$(mktemp "${BACKUP_DIR}/.mohasba-${DATE_STAMP}.XXXXXX")"

cleanup() {
  if [[ -n "$TMP_FILE" && -f "$TMP_FILE" ]]; then
    rm -f "$TMP_FILE"
  fi
}
trap cleanup EXIT

echo "[$(date -u +%FT%TZ)] Starting verified pg_dump backup (schema=public)..."
# Make plain-text dump idempotent & error-free on Supabase Cloud `psql -v ON_ERROR_STOP=1`:
#   1. Rewrite `CREATE SCHEMA public;` -> `CREATE SCHEMA IF NOT EXISTS public;` (public already exists on Supabase).
#   2. Strip Supabase-managed `public.rls_auto_enable()` function & its ACLs (bound to platform `ensure_rls` event trigger).
#   3. Strip `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` (`postgres` role lacks `supabase_admin` membership).
#   4. Never modify anything inside `COPY ... FROM stdin;` ... `\.` data blocks.
pg_dump --schema=public --no-owner --format=plain "$SUPABASE_DB_BACKUP_URL" \
  | awk '
      /^COPY .* FROM stdin;$/ { in_copy = 1; print; next }
      in_copy && /^\\\.$/ { in_copy = 0; print; next }
      in_copy { print; next }

      skip_rls_fn {
        if ($0 ~ /^(\$\$|\$[A-Za-z0-9_]*\$);$/) {
          skip_rls_fn = 0
        }
        next
      }

      /^CREATE SCHEMA public;$/ {
        print "CREATE SCHEMA IF NOT EXISTS public;"
        next
      }

      /^CREATE FUNCTION public\.rls_auto_enable\(\)/ {
        skip_rls_fn = 1
        next
      }

      /^(REVOKE|GRANT) .* ON FUNCTION public\.rls_auto_enable\(\)/ {
        next
      }

      /^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin / {
        next
      }

      { print }
    ' \
  | gzip -9 > "$TMP_FILE"

# Validate archive integrity and non-trivial size BEFORE promoting or rotating
if [[ ! -s "$TMP_FILE" ]]; then
  echo "ERROR: Backup output is empty — aborting without touching existing snapshots." >&2
  exit 1
fi

FILE_BYTES="$(wc -c < "$TMP_FILE")"
if [[ "$FILE_BYTES" -lt 128 ]]; then
  echo "ERROR: Backup archive suspiciously small (${FILE_BYTES} bytes) — aborting." >&2
  exit 1
fi

gzip -t "$TMP_FILE"
mv -f "$TMP_FILE" "$FINAL_FILE"
TMP_FILE=""
echo "[$(date -u +%FT%TZ)] Verified snapshot saved: $FINAL_FILE (${FILE_BYTES} bytes)"

UPLOAD_TARGET="$FINAL_FILE"
if [[ -n "${AGE_RECIPIENT:-}" ]]; then
  if ! command -v age >/dev/null 2>&1; then
    echo "ERROR: AGE_RECIPIENT is set but 'age' binary is not installed." >&2
    exit 1
  fi
  ENC_FILE="${FINAL_FILE}.age"
  age -r "$AGE_RECIPIENT" -o "$ENC_FILE" "$FINAL_FILE"
  UPLOAD_TARGET="$ENC_FILE"
  echo "[$(date -u +%FT%TZ)] Encrypted snapshot with age: $ENC_FILE"
fi

if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "ERROR: RCLONE_REMOTE is set but 'rclone' binary is not installed." >&2
    exit 1
  fi
  rclone copyto "$UPLOAD_TARGET" "${RCLONE_REMOTE}/$(basename "$UPLOAD_TARGET")"
  echo "[$(date -u +%FT%TZ)] Uploaded off-VPS copy to ${RCLONE_REMOTE}/$(basename "$UPLOAD_TARGET")"
fi

# Rotate local dated snapshots ONLY after a verified new snapshot succeeded
mapfile -t SNAPSHOTS < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'mohasba-*.sql.gz' | sort -r)
if [[ "${#SNAPSHOTS[@]}" -gt "$KEEP_SNAPSHOTS" ]]; then
  for OLD in "${SNAPSHOTS[@]:$KEEP_SNAPSHOTS}"; do
    rm -f "$OLD" "${OLD}.age"
    echo "[$(date -u +%FT%TZ)] Rotated old snapshot: $OLD"
  done
fi

echo "[$(date -u +%FT%TZ)] Backup completed cleanly."
