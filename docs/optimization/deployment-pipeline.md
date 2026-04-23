# 배포 파이프라인 최적화 (GHCR 기반 이미지 빌드)

> 2026-04-10, Issue #227 / PR #228, #229, #230

## TL;DR

기존에는 배포 대상 서버(리소스 제한된 VM)에서 직접 `docker compose up -d --build`를 돌려서
`yarn install` + `yarn build`까지 VM이 부담했다. 의존성이 바뀌거나 캐시가 증발하면
4\~10분이 걸렸고, 최악의 경우 SSH 타임아웃으로 배포가 실패했다.

GitHub Actions에서 이미지를 빌드해 GHCR에 푸시하고, VM은 pull + 재기동만 하도록 파이프라인을
분리했다. 실측 결과 **warm cache 상태에서 총 파이프라인 ~81초**(기존 중앙값과 동등 또는 약간
우위)로 고정되었고, 무엇보다 **의존성 변경 시 4\~10분 대기 + 간헐적 타임아웃 실패가 완전히
제거되어 편차가 13배 이상 → 2배 내로 축소**됐다. 단순 속도 개선보다 **예측 가능성과
신뢰성 확보**가 핵심 성과다.

---

## Before / After

### 파이프라인 구조

**Before (\~#226 까지)**

```
GitHub Actions (ubuntu-latest)
├── CI: yarn install → lint → test → build
└── Deploy via SSH
     └── VM: git pull → docker compose up -d --build
              ├── yarn install (--frozen-lockfile)
              ├── yarn build (tsc)
              └── yarn install --production
```

- CI와 VM에서 **yarn install/build를 이중으로 수행** (낭비)
- VM 리소스 제약(메모리·CPU)으로 빌드가 간헐적으로 느려지거나 실패
- Bot 프로세스와 Docker 빌드가 동일 VM에서 CPU 경쟁

**After (#228 이후)**

```
GitHub Actions (ubuntu-latest)
├── CI: yarn install → lint → test → build
├── Build and Push Image
│    ├── docker/setup-buildx-action@v3
│    ├── docker/login-action@v3 → ghcr.io (GITHUB_TOKEN)
│    ├── docker/metadata-action@v5 (tags: latest + sha-<short>)
│    └── docker/build-push-action@v6
│         ├── BuildKit cache mount (yarn)
│         ├── cache-from/to: type=gha
│         └── push: ghcr.io/hyewon3938/slack-ai-agents:{latest,sha-<short>}
└── Deploy via SSH
     └── VM: git pull → docker compose pull app → docker compose up -d app
```

- 빌드는 GitHub Actions 러너가 전담
- VM은 이미지 pull + 컨테이너 재기동만 → 봇 다운타임 최소화
- BuildKit GHA 캐시 + Dockerfile `RUN --mount=type=cache`로 warm build 최적화
- `latest`와 `sha-<short>` 이중 태그로 롤백 경로 확보

---

## 실측 데이터

### Pre-#228 "Deploy via SSH" 스텝 (VM에서 직접 빌드)

최근 15개 성공 배포 샘플 (단위: 초):

| # | Title | Deploy via SSH |
|---|-------|----------------|
| 1 | `fix(ci): 배포 SSH 타임아웃 30분으로 확장` | 61 |
| 2 | `fix(security): 다층 보안 강화` | 61 |
| 3 | `fix: SET statement_timeout 파라미터 바인딩` | 132 |
| 4 | `fix(insight): 컨텍스트 초과 일기 기록` | 129 |
| 5 | `fix(ci): db-proxy 테스트 미사용 import` | 127 |
| 6 | `docs: CLAUDE.md 보안 작성 규칙` | 53 |
| 7 | `fix(security): 코드 레벨 보안 강화` | 115 |
| 8 | `chore(security): 의존성 보안 업데이트` | 54 |
| 9 | `chore(security): 의존성 보안 업데이트` | 60 |
| 10 | `chore(security): 의존성 보안 업데이트` | 58 |
| 11 | `Merge pull request #210` | 57 |
| 12 | `Merge pull request #210` | 126 |
| 13 | `fix(web): 자체 서명 SSL 인증서 호환` | **471** |
| 14 | `fix(security): 보안 감사` | 48 |
| 15 | `Merge pull request #205` | 90 |

**통계:**
- **중앙값: 61초**
- 평균: 109초
- 최소: 48초 / 최대: 471초
- 추가로 **타임아웃(>600초) 실패 사례 다수** 존재 (특히 의존성 변경 시, #225, #212, Merge #212 등)

### 관찰
- 대부분의 배포는 60\~130초 — Docker 레이어 캐시가 유효할 때
- 의존성(`package.json`/`yarn.lock`) 변경 시 전체 `yarn install` 재실행 → 400\~600초
- VM 리소스 포화 시점에 타임아웃(600초) 실패
- **예측 불가능성이 가장 큰 비용**: "이번 배포가 얼마나 걸릴지" 알 수 없음

### Post-#228 측정값

| Run | 상태 | CI | Build and Push Image | Deploy to Server | 총 소요 |
|-----|------|-----|---------------------|------------------|---------|
| #229 (첫 빌드, 실패) | cold GHA cache | 20s | 72s | (skipped) | — |
| #230 (아키텍처 수정 후 첫 성공) | cold GHA cache | 34s | 72s | 63s | **178s** |
| #231 (docs PR) | **warm GHA cache** | 25s | **18s** | 38s | **81s** |

**Warm cache 효과 분석** (#231 build-image job 내부 스텝):
- Set up Docker Buildx: 7s
- Log in to GHCR: <1s
- Extract metadata: <1s
- **Build and push: 4s** (코드가 거의 변경되지 않은 경우 — 레이어 거의 전부 캐시 히트)
- Post 정리: \~6s

`--mount=type=cache` + `type=gha` 캐시 조합이 효과적으로 작동해 의존성과 소스가 변경되지
않았을 때 실제 빌드+푸시 단계가 4초에 끝났다. 코드가 변경된 경우에도 yarn install 레이어는
캐시 히트되고 `yarn build`만 다시 실행되므로 20\~30초 수준으로 예상된다.

---

## 개선 포인트 분석

### 1. 편차 및 예측 가능성 (가장 큰 개선)

| 지표 | Before | After |
|------|--------|-------|
| 중앙값 (총 파이프라인) | \~90s (Deploy via SSH 61s + CI 약 20\~30s) | **\~81s** (warm cache 실측) |
| 최악 케이스 | **471s \~ 타임아웃(600s+) 실패** | **\~180s** (cold cache 첫 빌드) |
| 변동 폭 | 48s \~ 600s+ (13배 이상) | \~80s \~ \~180s (2배 내) |
| 실패 유형 | VM 리소스 포화 / SSH 타임아웃 | 해당 없음 (빌드는 Actions) |
| Build 단계 시간 | VM에서 10s\~8분 (예측 불가) | **4s\~30s** (캐시 상태에 따라 결정적) |

**중앙값은 비슷하거나 약간 개선**됐고, **의존성 변경 시 4\~10분 대기 + 간헐적 타임아웃 실패가 완전히 사라졌다**.
변동 폭이 13배 이상 → 2배 내로 축소되어 "이번 배포가 얼마나 걸릴지" 예측이 가능해졌다.

### 2. VM 리소스 해방

- 이전: Bot 프로세스 + Docker 빌드가 동일 VM에서 CPU/메모리 경쟁. 빌드 중 봇 응답이 느려짐.
- 이후: VM은 pull + 재기동만. 빌드 중에도 봇 프로세스(이전 버전)는 정상 응답.

### 3. 롤백 경로 확보

- `sha-<short>` 태그로 과거 이미지 보존
- 롤백은 `docker-compose.yml`의 `image:` 필드를 해당 SHA 태그로 교체 후 `docker compose up -d app`
- 현재는 `latest` 단일 태그로 기본 배포. 필요 시 `.env`에 `IMAGE_TAG` 변수 추가로 확장 가능 (후속 개선)

### 4. CI/빌드 통합 관측성

- 이전: 실제 프로덕션 빌드 로그가 SSH 액션 안에 묻혀 있어 실패 원인 추적이 번거로움
- 이후: build-image job이 독립되어 Actions UI에서 빌드 단계별 시간/로그 확인

### 5. 이미지 누적 관리

GHCR은 push 시마다 새 SHA 태그 이미지가 생성되어 무제한 누적된다. 방치하면 레지스트리 용량이 계속 증가하고 롤백 대상 선택도 번거로워진다. 두 레벨에서 자동 정리한다:

**GHCR (원격 레지스트리)**
- `actions/delete-package-versions@v5`를 build-image job 마지막 스텝에 배치
- `min-versions-to-keep: 10` — 최근 10개 이미지 보존 (롤백 여유분)
- `ignore-versions: '^latest$'` — `latest` 태그는 항상 제외 (현재 배포 중인 이미지 보호)

**배포 서버 (로컬 Docker)**
- 매 배포 끝에 `docker image prune -f`로 dangling 이미지 제거
- 추가로 앱 이미지 최신 2개(현재 + 직전 버전)만 남기고 나머지 삭제
- 디스크 사용량 바운드 + 즉시 롤백 가능한 직전 버전 보존의 균형

---

## 기술 세부사항

### Dockerfile — BuildKit cache mount

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN yarn build

FROM node:22-slim
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY db/ ./db/
USER node
CMD ["node", "dist/app.js"]
```

- `# syntax=docker/dockerfile:1.6` 디렉티브로 BuildKit 최신 파서 활성화 (`RUN --mount` 지원)
- Yarn 캐시 경로(`/usr/local/share/.cache/yarn`)를 BuildKit cache mount로 외부화
- `sharing=locked`: 빌더/프로덕션 스테이지가 동일 캐시 접근 시 순차 대기
- **주의**: cache mount 경로에서는 `yarn cache clean`을 호출하면 안 된다. rmdir 대상이 마운트 포인트라 `EBUSY` 발생(PR #229 hotfix). cache mount는 최종 이미지 레이어에 포함되지 않으므로 clean 자체가 불필요.

### GitHub Actions workflow — build-image job

```yaml
build-image:
  name: Build and Push Image
  needs: ci
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v4
    - uses: docker/setup-buildx-action@v3
    - uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
    - id: meta
      uses: docker/metadata-action@v5
      with:
        images: ghcr.io/${{ github.repository }}
        tags: |
          type=raw,value=latest
          type=sha,format=short,prefix=sha-
    - uses: docker/build-push-action@v6
      with:
        context: .
        platforms: linux/amd64
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
        provenance: false
    - uses: actions/delete-package-versions@v5
      with:
        package-name: ${{ github.event.repository.name }}
        package-type: container
        min-versions-to-keep: 10
        ignore-versions: '^latest$'
```

- `permissions` 잡 스코프 최소화 (`contents: read`, `packages: write`)
- `secrets.GITHUB_TOKEN`으로 GHCR 로그인 — 별도 PAT 불필요
- `cache-from/to: type=gha` — Actions 캐시 백엔드 활용. Dockerfile cache mount와 조합해 warm build 최적화
- `provenance: false` — 단일 플랫폼 빌드 시 불필요한 attestation artifact("unknown/unknown") 제거

### docker-compose.yml — image 필드 전환

```yaml
app:
  image: ghcr.io/hyewon3938/slack-ai-agents:latest
  # build: .  ← 제거
  ...
```

### 배포 서버 측 `deploy.sh` (서버 전용, 저장소에 포함 안 함)

```bash
#!/usr/bin/env bash
set -euo pipefail

cd <repo-path>

# docker-compose.yml 및 마이그레이션 스크립트 등 빌드 외 리소스 동기화
git fetch origin main
git reset --hard origin/main

# 새 이미지 pull (인증은 ~/.docker/config.json에 저장되어 있음)
docker compose pull app

# app 컨테이너만 교체 (db는 건드리지 않음)
docker compose up -d app

# dangling 이미지 제거
docker image prune -f

# 앱 이미지는 latest + 직전 버전 1개만 유지 (롤백 여유분)
APP_IMAGE="ghcr.io/<owner>/<repo>"
KEEP=2
mapfile -t OLD_IMAGES < <(
  docker images "$APP_IMAGE" --format "{{.ID}} {{.Tag}} {{.CreatedAt}}" \
    | grep -v " latest " \
    | sort -k3 -r \
    | awk "NR>$KEEP {print \$1}"
)
if [ "${#OLD_IMAGES[@]}" -gt 0 ]; then
  docker rmi "${OLD_IMAGES[@]}" || true
fi
```

- `git reset --hard`는 유지: `docker-compose.yml`, 마이그레이션 스크립트 등 저장소 리소스 동기화 목적
- `docker compose build` 제거
- `docker image prune -f`: 교체된 dangling 이미지 정리 (볼륨/네트워크는 건드리지 않음)
- 앱 이미지 2개 유지 정책으로 디스크 사용량 바운드 + 즉시 롤백 가능

---

## 수동 사전 작업 (1회)

본 파이프라인이 동작하려면 배포 서버에 1회 사전 작업이 필요하다:

1. **GHCR pull 전용 크리덴셜 발급** — `read:packages` 스코프 하나만 부여한 전용 토큰. 다른 스코프와 섞지 않는다. 만료일은 1년 이내로 설정한다.
2. 배포 서버에서 `docker login ghcr.io` 수행 → `~/.docker/config.json` 저장 (파일 권한 `600`로 제한)
3. `deploy.sh`를 "pull + up -d" 버전으로 교체
4. 첫 이미지 푸시 후 GHCR 패키지 visibility를 **Private**으로 설정 (웹 UI에서만 가능)

### 크리덴셜 로테이션

- 만료일 관리는 GitHub 자동 만료 알림(이메일/웹) + 별도 개인 캘린더 리마인더의 이중화로 운영한다.
- 만료되면 동일 스코프로 재발급 → 배포 서버에서 `docker login ghcr.io` 재수행.
- 로테이션 작업 자체는 수 분 내로 끝나지만, 놓치면 배포가 즉시 중단되므로 선제 알림이 중요하다.
- 크리덴셜 값과 서버 경로/주소는 저장소에 커밋하지 않는다.

---

## 삽질 기록 (hotfix 두 번)

### PR #229: `yarn cache clean` EBUSY

첫 빌드에서 실패:
```
error Error: EBUSY: resource busy or locked, rmdir '/usr/local/share/.cache/yarn'
```

BuildKit cache mount 디렉토리는 컨테이너 내부에서 rmdir 불가. `yarn cache clean`은 cache mount와 호환되지 않으며, 애초에 cache mount는 이미지 레이어에 포함되지 않아 clean 자체가 불필요. 제거로 해결.

### PR #230: 빌드 플랫폼 미스매치

배포는 성공했으나 컨테이너가 재시작 루프에 빠졌다. 빌드 이미지의 대상 플랫폼이 실제 배포 서버의 런타임과 맞지 않아 실행 포맷 에러가 발생했다. 빌드 러너와 플랫폼 옵션을 배포 환경과 일치시켜 해결.

**교훈**: 외부 런타임과 엮인 파이프라인 설계 시 대상 환경의 실제 플랫폼/아키텍처를 설계 전 현장 검증하는 루틴을 선제적으로 추가해야 한다. 문서에 적힌 환경 정보가 최신 상태라고 가정하지 말 것.

---

## 참고

- [PR #228](https://github.com/hyewon3938/slack-ai-agents/pull/228) — 파이프라인 전환 (원본)
- [PR #229](https://github.com/hyewon3938/slack-ai-agents/pull/229) — hotfix: `yarn cache clean` 제거
- [PR #230](https://github.com/hyewon3938/slack-ai-agents/pull/230) — hotfix: 아키텍처 amd64로 수정
- [docker/build-push-action GHA cache](https://docs.docker.com/build/ci/github-actions/cache/)
- [BuildKit cache mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypecache)
