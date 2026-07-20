#!/usr/bin/env bash
set -euo pipefail

: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the Neon direct database URL}"
: "${MIGRATION_EXPORT_DIR:?Set MIGRATION_EXPORT_DIR to the directory printed by export_from_supabase.sh}"
command -v psql >/dev/null 2>&1 || {
  echo "psql is required" >&2
  exit 1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
required_files=(
  source_users trips days route_segments photos notes places trip_members admin_requests
)

for file_name in "${required_files[@]}"; do
  if [[ ! -f "$MIGRATION_EXPORT_DIR/$file_name.csv" ]]; then
    echo "Missing migration file: $MIGRATION_EXPORT_DIR/$file_name.csv" >&2
    exit 1
  fi
done

psql "$TARGET_DATABASE_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --file="$script_dir/01_prepare_staging.sql"

load_csv() {
  local table_name="$1"
  psql "$TARGET_DATABASE_URL" \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --command="\\copy migration.${table_name} from '${MIGRATION_EXPORT_DIR}/${table_name}.csv' with (format csv, header true, null 'NULL')"
}

for table_name in "${required_files[@]}"; do
  load_csv "$table_name"
done

psql "$TARGET_DATABASE_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --file="$script_dir/02_apply_staging.sql"

psql "$TARGET_DATABASE_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --file="$script_dir/03_verify.sql"

echo "Database migration and verification completed successfully."
echo "Keep the Supabase project unchanged until the application cutover is verified."
