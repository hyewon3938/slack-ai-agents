#!/usr/bin/env bash
# DB 일일 백업 → Cloudflare R2 업로드.
# crontab: 0 19 * * * /home/ubuntu/slack-ai-agents/scripts/backup-db.sh  # UTC 기준 (= KST 04:00)

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

# .env 로드 (POSTGRES_USER, POSTGRES_DB, R2_REMOTE, SLACK_BOT_TOKEN, PROJECT_CHANNEL_ID, LOG_DIR)
# LOG_DIR/LOG_FILE 평가는 .env 로드 이후에 수행 (.env의 LOG_DIR이 적용되도록)
if [ -f "$REPO_DIR/.env" ]; then
  set -a; . "$REPO_DIR/.env"; set +a
fi

LOG_DIR="${LOG_DIR:-$HOME/.local/log/slack-ai-agents}"
LOG_FILE="$LOG_DIR/backup.log"

: "${POSTGRES_USER:?POSTGRES_USER 필요}"
: "${POSTGRES_DB:?POSTGRES_DB 필요}"
: "${R2_REMOTE:?R2_REMOTE 필요 (예: r2:slack-ai-agents-backup)}"
: "${SLACK_BOT_TOKEN:?SLACK_BOT_TOKEN 필요}"
: "${PROJECT_CHANNEL_ID:?PROJECT_CHANNEL_ID 필요}"

DATE=$(date +%Y-%m-%d)
DOW=$(date +%u)          # 1=월 ... 7=일
WEEK=$(date +%G-W%V)     # ISO 주차 (예: 2026-W17)
TMP_FILE="/tmp/db-backup-$DATE.dump"

mkdir -p "$LOG_DIR"
trap 'rm -f "$TMP_FILE"' EXIT

notify_failure() {
  local reason="$1"
  curl -sS -X POST https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    --data "$(printf '{"channel":"%s","text":":rotating_light: DB 백업 실패 (%s): %s. 로그: %s"}' \
      "$PROJECT_CHANNEL_ID" "$DATE" "$reason" "$LOG_FILE")" \
    >/dev/null || true
}

run_backup() {
  echo "[$(date -Iseconds)] === backup start ($DATE) ==="

  # 1) pg_dump (custom format + 최대 압축)
  docker exec -i slack-ai-agents-db \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 9 > "$TMP_FILE"

  local size
  size=$(stat -c%s "$TMP_FILE")
  if [ "$size" -lt 1024 ]; then
    echo "ERROR: dump 파일이 너무 작음 ($size bytes)"
    return 1
  fi
  echo "dump size: $size bytes"

  # 2) daily 업로드
  rclone copyto "$TMP_FILE" "$R2_REMOTE/daily/$DATE.dump"

  # 3) 일요일이면 주별 백업으로 복사 (server-side copy)
  if [ "$DOW" = "7" ]; then
    rclone copyto "$R2_REMOTE/daily/$DATE.dump" "$R2_REMOTE/weekly/$WEEK.dump"
  fi

  # 4) 보관 정책: daily 14일, weekly 56일
  rclone delete --min-age 14d "$R2_REMOTE/daily" || true
  rclone delete --min-age 56d "$R2_REMOTE/weekly" || true

  echo "[$(date -Iseconds)] === backup ok ==="
}

if ! run_backup >> "$LOG_FILE" 2>&1; then
  notify_failure "백업 스크립트 비정상 종료. 로그 확인 필요."
  exit 1
fi
