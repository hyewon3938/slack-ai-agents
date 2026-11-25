#!/usr/bin/env bash
# SQL 도구 전용 DB 역할 만들기 (수동 실행 전용, ADR-0067)
#
# 역할 속성·기본 설정·DB 접속·스키마 사용 권한까지 만든다. 테이블 권한은 봇이 시작할 때
# 동기화 단계가 맞추므로 여기서는 주지 않는다. 비밀번호는 실행 중에 psql \password로 입력받고
# 파일이나 명령 인자에 남기지 않는다. 몇 번을 실행해도 결과가 같다.
#
# Usage:
#   ./create-sql-tool-role.sh              # 역할 이름 sql_tool
#   ./create-sql-tool-role.sh my_tool_role # 역할 이름 지정
#
# 환경변수 (없으면 저장소 루트 .env에서 읽음):
#   POSTGRES_USER, POSTGRES_DB  관리 역할과 DB 이름
#   DB_CONTAINER                DB 컨테이너 이름 (기본 slack-ai-agents-db)

set -euo pipefail

ROLE="${1:-sql_tool}"
if ! [[ "$ROLE" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "역할 이름은 영문 소문자·숫자·밑줄만 쓸 수 있어: $ROLE" >&2
  exit 1
fi

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ -z "${POSTGRES_USER:-}" ] && [ -f "$REPO_DIR/.env" ]; then
  set -a; . "$REPO_DIR/.env"; set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER 필요}"
: "${POSTGRES_DB:?POSTGRES_DB 필요}"
DB_CONTAINER="${DB_CONTAINER:-slack-ai-agents-db}"

if [ "$ROLE" = "$POSTGRES_USER" ]; then
  echo "도구 역할은 앱 역할과 달라야 해: $ROLE" >&2
  exit 1
fi

echo "[1/2] 역할 '$ROLE' 만들기·속성 맞추기 (DB: $POSTGRES_DB)"
docker exec -i "$DB_CONTAINER" psql -X -q -v ON_ERROR_STOP=1 \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v role="$ROLE" <<'SQL'
SELECT format('CREATE ROLE %I', :'role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec

ALTER ROLE :"role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 5;
ALTER ROLE :"role" SET statement_timeout = '10s';
ALTER ROLE :"role" SET lock_timeout = '3s';
ALTER ROLE :"role" SET idle_in_transaction_session_timeout = '30s';

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'role') \gexec
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO :"role";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL

echo "[2/2] 비밀번호 설정"
if [ -t 0 ]; then
  docker exec -it "$DB_CONTAINER" psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\\password $ROLE"
  echo "완료. 서버 환경변수 SQL_TOOL_DATABASE_URL에 이 역할의 연결 문자열을 넣고 봇을 다시 시작해."
else
  echo "터미널이 아니라 비밀번호를 묻지 않았어. 직접 실행해:"
  echo "  docker exec -it $DB_CONTAINER psql -U <관리 역할> -d <DB> -c '\\password $ROLE'"
fi
