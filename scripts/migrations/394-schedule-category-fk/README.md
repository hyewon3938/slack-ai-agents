# Migration: schedules 카테고리 FK 전환 (Issue #394)

`schedules.category TEXT` / `schedules.subcategory TEXT` →
`schedules.category_id INTEGER FK → categories(id)` + `categories.parent_id` 계층.

## 실행 환경

Oracle VM 내 PostgreSQL 컨테이너에서 직접 실행. `psql`로 접속하거나
`docker exec slack-ai-agents-db psql -U "$DB_USER" -d "$DB_NAME"` 패턴 사용.

## 실행 순서

| 단계 | 파일 | 설명 | 트랜잭션 |
|------|------|------|----------|
| 0 | (수동) | `pg_dump`로 전체 백업 파일 생성 — `backup-db.sh` 활용 가능 | - |
| 1 | `01-backup.sql` | DB 내부 백업 테이블 생성 + row count 검증 | 단일 트랜잭션 |
| 2 | `02-recovery.sql` | rename으로 끊긴 카테고리 데이터 복구 (실명 자리 placeholder) | 사용자 편집 후 실행 |
| 3 | `03-verify-prematch.sql` | 매칭 안 되는 row 0개 확인 (실행만, 변경 없음) | - |
| 4 | `04-migrate.sql` | 새 컬럼 + backfill + FK + 기존 TEXT 컬럼 제거 | 단일 트랜잭션 |
| 5 | `05-verify-postmigrate.sql` | 사후 검증: row count, dangling FK, NULL 분포 | - |
| 6 | (대기) | 1주 검증 기간 — 코드 동작 정상 확인 | - |
| 7 | `06-cleanup.sql` | 백업 테이블 DROP | 단일 트랜잭션 |
| ! | `99-rollback.sql` | 문제 발생 시 백업 테이블에서 복구 | 단일 트랜잭션 |

## 사전 준비

1. **`pg_dump` 백업 파일 생성** (가장 큰 안전망)
   ```bash
   # VM에서
   docker exec slack-ai-agents-db pg_dump -U "$DB_USER" "$DB_NAME" \
     > "$HOME/backup_pre_category_migration_$(date +%Y%m%d_%H%M).sql"
   ls -lh "$HOME/backup_pre_category_migration_"*.sql   # 0바이트면 실패
   ```

2. **`02-recovery.sql` 편집** — 카테고리 실명은 코드/PR 비공개 원칙이라 파일에
   placeholder만 들어있음. VM에서 직접 편집 후 실행.

## 실행 후 코드 배포

마이그레이션 완료 → 코드 PR 머지 → 자동 배포(GitHub Actions Deploy 워크플로우).
순서가 바뀌면 사이트가 일시 깨질 수 있으므로 반드시 마이그레이션 먼저.
