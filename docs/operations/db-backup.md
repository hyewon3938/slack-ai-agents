# DB 자동 백업 & 복원 가이드

## 개요

- 매일 04:00 KST에 PostgreSQL → Cloudflare R2 백업
- 보관: 일별 14일 + 주별(일요일분) 8주
- 실패 시 `#project` 채널로 Slack 알림

---

## 1. 사전 준비 (1회 셋업)

### 1.1 Cloudflare R2 버킷 생성

1. Cloudflare 대시보드 → R2 → "Create bucket"
2. 버킷명: `slack-ai-agents-backup`
3. R2 → Manage R2 API Tokens → "Create API token"
   - 권한: Object Read & Write
   - 버킷 범위: 위 버킷
4. 발급된 Access Key ID / Secret Access Key / Account ID 별도 보관

### 1.2 rclone 설치 (VM)

```bash
sudo -v ; curl https://rclone.org/install.sh | sudo bash
rclone version   # 설치 확인
```

### 1.3 rclone remote 설정

```bash
rclone config
# n) New remote
# name> r2
# type> s3
# provider> Cloudflare
# env_auth> false
# access_key_id> <위 Access Key ID>
# secret_access_key> <위 Secret Access Key>
# endpoint> https://<ACCOUNT_ID>.r2.cloudflarestorage.com
# location_constraint> (빈값, Enter)
# acl> private
```

검증:

```bash
rclone lsd r2:
rclone lsf r2:slack-ai-agents-backup
```

### 1.4 .env에 R2_REMOTE 추가

```bash
echo "R2_REMOTE=r2:slack-ai-agents-backup" >> ~/slack-ai-agents/.env
```

### 1.5 스크립트 실행 권한 부여

```bash
chmod +x ~/slack-ai-agents/scripts/backup-db.sh
chmod +x ~/slack-ai-agents/scripts/restore-db.sh
```

---

## 2. 첫 백업 검증

셋업 직후 수동으로 1회 실행하여 정상 동작 확인:

```bash
cd ~/slack-ai-agents
./scripts/backup-db.sh
tail -20 ~/.local/log/slack-ai-agents/backup.log
rclone lsf r2:slack-ai-agents-backup/daily/
```

---

## 3. crontab 등록

> **주의**: VM 타임존은 `Etc/UTC`이므로 cron 시간도 UTC로 기입한다. KST 04:00은 UTC 19:00 (전날 기준).

```bash
crontab -e
```

아래 줄 추가:

```
0 19 * * * /home/ubuntu/slack-ai-agents/scripts/backup-db.sh  # UTC 19:00 = KST 04:00
```

등록 확인:

```bash
crontab -l
```

---

## 4. 복원 절차

> **주의**: 복원은 DB를 덮어쓰는 작업이다. 스크립트 실행 전 현재 상태를 백업하는 것을 권장한다.

```bash
# 특정 일자 복원
./scripts/restore-db.sh 2026-04-21

# 주별 백업 복원
./scripts/restore-db.sh weekly/2026-W17
```

스크립트는 dump 헤더 확인 후 `yes/no` 확인을 요구한다.

복원 리허설은 별도 테스트 DB 컨테이너에서 수행 권장:

```bash
docker run -d --name test-restore \
  -e POSTGRES_USER=agent -e POSTGRES_PASSWORD=test -e POSTGRES_DB=slack_ai_agents \
  postgres:17-alpine
REPO_DIR=. docker exec -i test-restore pg_restore ...
docker rm -f test-restore
```

---

## 5. 트러블슈팅

| 증상 | 원인 / 해결 |
|------|------------|
| Slack 알림 없는데 백업 누락 | crontab 미등록 확인 `crontab -l` / `~/.local/log/slack-ai-agents/backup.log` 확인 |
| `R2_REMOTE 필요` 에러 | `.env`에 `R2_REMOTE` 항목 누락 |
| `permission denied` on script | `chmod +x scripts/backup-db.sh` |
| dump 파일 너무 작음 에러 | DB 컨테이너 다운 상태 확인 `docker ps` / pg 권한 문제 |
| rclone delete 실패 | R2 토큰 권한이 read-only — write 권한으로 재발급 |
| `stat -c%s` 미지원 | macOS인 경우 `stat -f%z` 사용 (스크립트는 Linux/VM 전용) |

---

## 6. 정상 동작 확인 체크리스트 (정기)

- [ ] 매일 R2 버킷에 daily 백업 생성되는지 확인 (`rclone lsf r2:slack-ai-agents-backup/daily/`)
- [ ] 일요일에 weekly 백업 추가 생성 확인
- [ ] 14일 이상된 daily 자동 정리 확인
- [ ] 분기 1회 복원 리허설
