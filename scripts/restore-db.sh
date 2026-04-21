#!/usr/bin/env bash
# DB 복원: R2에서 dump 다운로드 → pg_restore (수동 실행 전용)
# Usage:
#   ./restore-db.sh 2026-04-21            # daily/2026-04-21.dump 복원
#   ./restore-db.sh weekly/2026-W17       # weekly/2026-W17.dump 복원

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <YYYY-MM-DD>  또는  $0 weekly/YYYY-Www" >&2
  exit 1
fi

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ -f "$REPO_DIR/.env" ]; then
  set -a; . "$REPO_DIR/.env"; set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER 필요}"
: "${POSTGRES_DB:?POSTGRES_DB 필요}"
: "${R2_REMOTE:?R2_REMOTE 필요}"

KEY="$1"
case "$KEY" in
  weekly/*) REMOTE_PATH="$R2_REMOTE/$KEY.dump" ;;
  *)        REMOTE_PATH="$R2_REMOTE/daily/$KEY.dump" ;;
esac

TMP_FILE="/tmp/db-restore-$$.dump"
trap 'rm -f "$TMP_FILE"' EXIT

echo "[1/3] 다운로드: $REMOTE_PATH"
rclone copyto "$REMOTE_PATH" "$TMP_FILE"

echo "[2/3] dump 헤더 검증"
docker exec -i slack-ai-agents-db pg_restore -l < "$TMP_FILE" | head -5

read -r -p "[3/3] '$POSTGRES_DB' DB를 위 dump로 덮어쓸까? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "취소됨."
  exit 0
fi

docker exec -i slack-ai-agents-db \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner --no-privileges < "$TMP_FILE"

echo "복원 완료."
