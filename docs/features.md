# features

현재 운영 중인 기능 카탈로그. 신규 합류자나 미래의 자신이 "이 프로젝트 뭐가 되지?"를 1분 안에 파악하기 위한 한눈 문서.

> **상세 스키마·API는** `docs/domains/<domain>.md` 참조. 이 문서는 **무엇이 있는지**만 다룬다.

## 도메인별 기능

### 일정 관리 (`#life` 채널)

- Slack 자연어로 일정 추가/조회/수정/삭제
- 일정 삭제 사유 수집 — 웹은 사유 선택 모달(고정 5종 + 기타 텍스트), Slack은 대화 수집. tombstone enrichment로 축적, 변심 취소는 패턴 신호화 (#590, ADR-0060)
- 카테고리 분류 (FK 기반, 2026-05-13 마이그레이션)
- 밀린 일정 자동 감지 + 잔소리
- 상세: [docs/domains/schedule.md](./domains/schedule.md)

### 루틴 관리 (`#life` 채널)

- 매일/주간/슬롯별 루틴 정의
- 체크/언체크 인터랙티브 버튼
- 연속 달성(streak) 추적
- 슬롯별 달성률 분석
- 자율 루틴 — 주기 없이 수행할 때마다 기록하는 추적 모드. 하루 여러 건 허용, 기존 루틴과 모드 상호 전환 가능 (`tracking_mode`/`entry_type`, #605, ADR-0061)
- 달성률·연속 달성 등 "기대된 발생" 집계는 주기형 기록만 측정 — 자율 기록 유입으로 기존 수치 의미가 바뀌지 않도록 격리
- 상세: [docs/domains/routine.md](./domains/routine.md)

### 사주 / 일기 (`#insight` 채널)

- 사주 원국 분석 (`saju_profiles`)
- 일운/월운/세운/대운 운세 분석 (`fortune_analyses`, 교과서 레이어)
- 월운/세운/대운 기간 해석 — 검증가능성 사다리 기반 측정·교과서 분리 발화 (`period_interpretations`, 절기/입춘/대운 전환 시 생성, #529)
- 월운/세운 예측 장부 — 사전등록 → 사후 채점(방향 적중 + 실측 delta, Brier 금지). baseline 동결·절기 시간게이트 무인 자기검증 (`period_forecasts`, #531, 대운 비편입)
- 일운 콜 장부 — 일운 예측 사전등록 → 주간 엔진이 밤마다 방향 적중 채점 → 월요일 통합 카드에 지난주 콜 판정 노출 (`fortune_calls`, #582/PR #584, ADR-0057)
- 일기 자동 저장 (`diary_entries`)
- 삶의 테마 관리 (`life_themes`, 자동 진화)
- ~~사주 패턴 누적~~ (`saju_patterns` — 갱신 2026-05-26 중단, 봇 프롬프트 참조 2026-07-05 제거 #583. 테이블·누적분은 이력으로 존치, 역할은 프로필 요약 + `pattern_links` 검증축이 대체)
- 사주 일일 매칭 시드 카탈로그 (`pattern_catalog`, Phase 3 — 결정론 매칭, 마스터 #434 Phase 1 rename per ADR-0026, 마스터 #434 Phase 2에서 6종 풀세트 161개 신규 시드 추가, Phase 2.5에서 `pillar_level` 차원 + `cumulative_pillar_count` trigger + 14 신규 시드 추가)
- 일기 LLM enum 26종 추출 (`diary_meta_tags`, Phase 3 — 059·102 확장)
- 주간 사주 회고 카드 (`weekly-saju-review-v2`, 매주 월요일 08:00 KST `#insight` — 마스터 #421)
- 일일 종합 인사이트 (`daily-insight` routine, 매일 08:00 KST `#insight` — 오늘 사주 일운 + 검증된 개인 패턴 신뢰도별 종합, 마스터 A A3 #475)
- 상세: [docs/domains/insight.md](./domains/insight.md)

### 지출 / 예산 (`#money` 채널 / 웹 대시보드)

- 웹 대시보드 기반 입력 (Slack 입력 경로 제거됨)
- 일일 예산 안정화 로직
- 할부 / 카드 결제 주기 / 고정비 관리 (고정비별 결제수단 설정)
- 결제수단별 출금 시점 + 자금 기준일 — 통장 잔액을 언제 적어 넣어도 같은 예산 기준선 (#615)
- 상세: [docs/domains/budget.md](./domains/budget.md)

## 횡단 기능

### 프로액티브 인사이트 엔진

- SQL 기반 패턴 감지 11종 (streak / sleepTrend / slotGap / weekComparison / overdueAlert / categorySkew / drift / recovery / lapseAlert / weeklyRegression / spottyPattern)
- 매일 morning(09:05) / night(23:55) — 텍스트 형식 짧은 잔소리
- 주간 리포트 — 월요일 09:00 Block Kit
- 임계치 단일 외부 파일 (`src/shared/insight-thresholds.ts`)
- 설계 흐름: [docs/design-notebook/insight-engine-v2.md](./design-notebook/insight-engine-v2.md)
- 결정 기록: [ADR-0014](./adr/0014-insight-engine-unification.md)

> v2 "LLM 자율 발견 슬롯"(Phase 2)은 은퇴됨 — #477 통계 기반 발굴(P5a)·LLM 신호 제안(P5b)으로 대체. [ADR-0043](./adr/0043-retire-v2-llm-autonomous-discovery.md).

### 사주 일일 매칭 (Phase 3)

- 60갑자 마스터 정규화(\~466 rows) 위에 시드 catalog를 얹어 사용자 임상 가설을 정량 검증
- polymorphic trigger 6종(stem / branch / ganji / element_density / sibiunsung / relation) + 메트릭 5방향(above_avg / below_avg / above_abs / below_abs / flag_present)
- 매일 07:00 일일 매칭 cron — 오늘 활성 시드 평가 → `seed_daily_activations` 기록(오늘 발현 시드 핸드오프, 08:00 종합 인사이트 선행, #475). 검증은 주간 off-day 엔진으로 이관(#477 P2)
- 일기 LLM enum 26종 자동 추출(허용 enum 외 출력 폐기) → `diary_meta_tags` 적재
- 약한 시드(누적 \~10건 + hit rate < 30%) 주간 알림 → 사용자 명령어로 active 토글
- 슬랙 조회/토글: `사주 시드 보기` / `사주 시드 모두 보기` / `사주 시드 끄기 #N` / `사주 시드 켜기 #N`
- 풀셋 시드(매트릭 없음, 마스터 #434 Phase 2): trigger만 평가하고 `seed_daily_activations.matched=NULL`로 evidence-only 누적. 60+일 후 LLM 매트릭 제안 슬롯(Phase 6)이 가설 후보 풀로 사용
- 주간 off-day 검증 엔진(#477 P2/P3, 월 06:00): (시드 × 신호) `pattern_links`를 발현일 vs 비발현일 2×2로 검증해 통계(effect·e-value·status)를 DB에 갱신. "본인 패턴"과 "base rate 높은 신호" 분리. **P3 통계 스택**(ADR-0032·0034·0035): 누적 e-value(순차 anytime-valid, optional stopping 통제)로 `e≥20` 확정 + block permutation(자기상관 보정)으로 BH-FDR + 연속 Mann-Whitney 효과크기 + empirical-Bayes 수축. **e-value는 null 시뮬 빌드 게이트**(무관 데이터 거짓양성 ≤ α). **#542(ADR-0052)**: 검증 현황은 별도 봇 카드 없이 주간 인사이트 통합 카드(routine, 월 08:04)가 단독 노출 — 봇은 DB 갱신·발굴 후보 발송만
- 신뢰도 3-tier 노출(#477 P3, ADR-0035): verified("검증됨", e≥20) / emerging("검증중", off-day 효과 leaning, effect≥1.3·발현일≥15) / recent("오늘 발현"). 느린 확정 수율을 침묵으로 만들지 않으면서 미검증을 확정처럼 노출하지 않음. 통합 카드(#542) 패턴 학습: ✅검증됨 / 🌱검증중 / ✗기각 카운트 + 항목(효과크기·표본·교란 ⚠️)
- 결정론 사주 feature 엔진(#477 P4, ADR-0036·0037·0038): 운 레벨 맥락을 통계 상호작용이 아니라 **결정론 feature**로 환원해 off-day 엔진에 태움(새 통계 코어 0). **P4a 강도**(`saju-strength`): 생조−극설 실효강도 + 월령 + 통근 → 상대 분위수 tertile 밴드(약/적정/강, 주간 컷 산출 → 일별 판정) + 절대 신강/신약 병행. **P4b 관계·합화**(`saju-hwa`): 합화(合化) 변환 pass(化신 통근 게이트 + 충개합 v1a → 강도·밴드·효과적 십성 일관 반영) + 효과적 십성 시드(`hwa_sipsung`) + 관계 확장(귀문·대표 암합). 명리 규칙은 전부 파라미터(깊은 합충 노브 기본 off, 헌장 ④). FDR 가족 3분리(`saju_strength`/`saju_relation`/`baseline`)로 자동 생성 batch가 빠른 트랙 확정을 늦추지 않게 격리. 검증=결정론 얕게(v1a) / 해석=narrative LLM(ADR-0038 §3)
- 패턴 발굴 엔진 + 승인 게이트(#477 P5a, ADR-0039): 링크 없는 (시드 × 신호) 여집합을 off-day 대조로 스캔(검증 프리미티브 재사용, 새 통계 코어 0) → 느슨한 발견 q로 후보만 surface → `#insight` 맥락 풍부 승인 카드([추적 시작]/[패스]) → `pending`→`active`→다음 주간 엔진이 엄격 e-value로 검정. P4a·P4b가 evidence-only로 남긴 결정론 시드(강도 밴드·관계)를 데이터 기반 검증에 연결. 사람은 노출·큐레이션만 게이트, 믿음은 통계(2층 분리). LLM 신호 제안은 P5b
- LLM 신호 제안 + 2단 방어(#477 P5b, ADR-0040): LLM이 새 측정 신호(`signal_defs`, `source='llm'`, `kind='sql'`)를 월간 자율 제안 → 사람 승인 게이트(P5a 재사용, `#insight` `[측정 시작]`/`[반려]`) → active 후 P5a 발굴이 시드와 연결 → off-day 통계가 판정(LLM은 생성만, 판정은 통계). 무인 실행되는 LLM-생성 SQL을 **untrusted**로 다뤄 2단 방어 — 게이트 #1 정적 검증(`validateSignalSql`: 단일 SELECT·`$1/$2`만·`user_id=$1` 강제·테이블 deny-by-default 화이트리스트·DDL/DML/위험함수 차단) + 게이트 #2 실행 격리(`source='llm'`만 read-only TX + 재검증 + row cap). 미승인 신호는 inert(`status='active'`만 실행 — 승인 전 SQL 0회 실행). 마이그레이션 0·새 통계 코어 0
- 운 레벨 차원(마스터 #434 Phase 2.5): 시드별 `pillar_level`(원국/대운/세운/월운/일운) 차원 도입. 누적 카운트 시드(화 오행·편재 N=1..5)·`cumulative_pillar_count` trigger·월 09:15 분포 분석 cron은 #508(ADR-0046)에서 강도 밴드(ADR-0036)로 위임·은퇴 — 고정 임계 누적이 baseline 포화 시 죽는 문제를 상대 분위수 밴드가 흡수. 트리거 코드·타입은 #514에서 제거(DB CHECK·마이그는 보존)
- 결정 기록: [ADR-0017](./adr/0017-saju-ganji-master-normalization.md), [ADR-0028](./adr/0028-pillar-level-and-threshold-pool.md), [ADR-0046](./adr/0046-signal-seed-precision.md)

### Slack fast path 명령어

> **정규식 매칭 → SQL 직접 조회 → Block Kit 응답 (LLM 호출 0회).** 약속된 명령어만 매칭 — 자유언어 추출 없음.

| 채널 | 명령어 | 동작 |
|------|--------|------|
| `#life` | `일정` / `오늘 일정` | 오늘 일정 조회 |
| `#life` | `내일 일정` | 내일 일정 조회 |
| `#life` | `백로그` | 밀린 일정 조회 |
| `#insight` | `일운` / `오늘 일운` | 오늘 일운 조회 |
| `#insight` | `내일 일운` | 내일 일운 조회 |
| `#insight` | `월운` / `세운` / `대운` (정확일치·접미·접두형 전부) | 기간 해석 조회 — `period_interpretations` 최신 행 결정론 렌더. 월운/세운은 예측 장부(`period_forecasts`) 동봉 (LLM 0회, #529·#531·#533 단일화) |
| `#insight` | `오늘 일기` | 오늘 일기 조회 |
| `#insight` | `사주 시드 보기` | 활성 시드 + hit rate 목록 (Phase 3) |
| `#insight` | `사주 시드 모두 보기` | 비활성 포함 전체 시드 (Phase 3) |
| `#insight` | `사주 시드 끄기 #N` | signal_id=N active=false (Phase 3) |
| `#insight` | `사주 시드 켜기 #N` | signal_id=N active=true (Phase 3) |

띄어쓰기·존댓말 어미는 유연하게 매칭(`일정 보여줘`, `오늘 일운` 등). 자세한 정규식은 각 에이전트 파일 상단 주석 참조.

### 크론 시스템

> 시각 source of truth = 봇 서버 `notification_settings` DB. 아래는 2026-07-03 실측 기준.

| 시간 | 슬롯 | 내용 |
|------|------|------|
| 05:30 | diaryMetaExtract | 일기 메타 enum 추출 — 어제 일기 대상(자정 넘긴 일기 커버, Phase 3) |
| 07:00 | dailySajuMatching | 사주 일일 매칭 — 오늘 발현 시드 → `seed_daily_activations` 기록 (08:00 종합 인사이트 핸드오프, 발송 없음. 검증은 월요일 주간 엔진) |
| 07:30 | discoveryRecommend | 발굴 후보 데일리 재추천 — 주간 묶음 전부 패스 시 다음 best 후보 1건 승인 카드 (`#insight`, #504 Phase 3) |
| 08:00 | (routine) | 일일 종합 인사이트 — 오늘 사주 일운 + 검증/현황 개인 패턴 종합 (`#insight`, routine·Opus, #475) |
| 08:20 | periodFortune | 주기 운세 리포트 — 절기 전환·입춘·대운 전환 시 월운/세운/대운 해석 카드. wolun/seun은 예측 장부 채점(직전 기간)+사전등록(이번 기간) 동봉 (전환 없으면 no-op, `#insight`, #529·#531) |
| 09:01 | morning | 오늘 일정 + 어제 리뷰 + morning 인사이트. 월요일엔 목표 기간 만료 임박 안내 병행(주 1회, `#life`, #554) |
| 23:00 | insightNight | 밤 인사이트 — night 슬롯 프로액티브 패턴(수면·루틴 등) |
| 23:55 | night | 하루 종합 리뷰 + 마무리 잔소리 |
| 월요일 06:00 | weeklyVerification | 주간 패턴 검증 엔진 — off-day 통계·교란·포화 양방향 가드 DB 갱신 + 발굴 후보 카드 발송. 검증 현황 카드는 은퇴(통합 카드로 이관, #542) (`#insight`, #477·#508·#542) |
| 월요일 08:04 | (routine) | 주간 인사이트 통합 카드 — 회고 + 라이프 메트릭 + 패턴 학습(검증중/검증됨/기각) + 지난주 일운 콜 판정(#582) 한 장 (routine·Opus, `#insight`, #542) |
| 월요일 09:00 | weeklyReport | 주간 인사이트 리포트 (Block Kit) |
| 월요일 10:00 | weeklyReviewFallback | 주간 인사이트 미발송 시 수동 실행 알림(fallback, routine 실패 주만) (`#insight`, #542) |
| 매월 1일 09:30 | (신호 제안) | LLM 신호 제안 — 새 측정 신호 자율 제안 승인 카드 (`#insight`, #477 P5b) |
| 매월 2일 11:00 | signalSuggestFallback | 신호 제안 routine 미실행 월 수동 실행 알림(fallback, 그 달 미실행만 감지) (`#insight`, #466) |

타임존: `Asia/Seoul` 고정. `pillar-level-distribution-review` 슬롯은 은퇴(마이그레이션 097 비활성).

### 웹 대시보드 (Vercel)

- Next.js 16
- 일정/루틴/예산/사주 시각화
- 수면 시각화 — 4축(시간·규칙성·연속성·타이밍)+종합 점수, 세그먼트 타임라인 ([ADR-0059](./adr/0059-sleep-score-architecture.md))
- 분할 수면(같은 날 밤잠 기록 여러 건) 세그먼트 합성 집계 — 수면 효율·WASO(수면 중 각성) 파생
- 수면 기록 직접 입력 — 밤잠 세그먼트·낮잠·중간기상·특이사항 태그·메모 (슬랙과 동등, 대시보드 폼)
- 생활 탭(`/life`) 첫 진입은 루틴, 하위 탭 순서 루틴 → 수면
- 봇 서버 DB Proxy API 경유 (Vercel은 DB 직결 X)

### DB Proxy API

- 봇 서버(Oracle VM)에서 `/api/db/proxy` 엔드포인트로 SQL 실행 대행
- `DB_PROXY_URL` + `DB_PROXY_API_KEY` 인증
- 동적 user_id 보안 검증 적용

## 인프라

| 항목 | 위치 / 방식 |
|------|-----------|
| Slack 봇 | Oracle VM (Docker, Socket Mode) |
| PostgreSQL | Oracle VM (Docker 컨테이너) |
| 웹 | Vercel 자동 배포 (GitHub push → 빌드) |
| 봇 배포 | GitHub Actions `Deploy` 워크플로우 (main push 자동 + 수동 트리거) |
| 모니터링 | 봇 heartbeat + healthchecks.io dead-man's-switch(1차) + GitHub Actions 폴링(2차) ([docs/ops/health-monitoring.md](./ops/health-monitoring.md)) |
| DB 백업 | 매일 04:00 KST → Cloudflare R2 ([docs/ops/db-backup.md](./ops/db-backup.md)) |

## 마스터 히스토리 (최근)

> **현재 별도 진행 중인 마스터 없음.** 아래는 최근 종료된 마스터. 후속(#408 월/세/대운 매칭 등)은 운영 데이터 누적 후 별도 진입.

- **프로액티브 인사이트 v2** ([#393](https://github.com/hyewon3938/slack-ai-agents/issues/393), **close 2026-05-27**) — Phase 1\~4 머지 (Phase 4 = 가설-검증 정량 파이프라인, PR [#415](https://github.com/hyewon3938/slack-ai-agents/pull/415)). v2 헌장 4개는 #434·#477로 계승. Phase 5([#408](https://github.com/hyewon3938/slack-ai-agents/issues/408)) 월운·세운·대운 확장은 별도 트랙. 흐름: [design-notebook](./design-notebook/insight-engine-v2.md)
- **매트릭 중심 패턴 검증** ([#477](https://github.com/hyewon3938/slack-ai-agents/issues/477), **close 2026-06-06**) — off-day 2×2 + e-value 확정 게이트 + 사주 feature substrate + 발굴 + LLM 신호 제안 + 교란 MH 조정 (P1\~P7, ADR-0032\~0042). 흐름: [design-notebook](./design-notebook/metric-first-verification.md)
- **발굴 엔진 측정 타당성 + 카드 UX** ([#504](https://github.com/hyewon3938/slack-ai-agents/issues/504), **close 2026-06-08**) — 데이터-존재 윈도우 + 효과크기 랭킹 + 라벨 레이어 + 후보 재추천 (ADR-0044\~0047). 흐름: [design-notebook](./design-notebook/discovery-refinement.md)
- **세운·대운 확장 + 검증 교정** ([#523](https://github.com/hyewon3938/slack-ai-agents/issues/523), **close 2026-06-13**) — 기간 해석 엔진 + 주기 리포트 + 예측 장부(`period_forecasts`, 사전등록→사후채점) (ADR-0049·0050). 흐름: [design-notebook](./design-notebook/period-extension.md)
- **주간 인사이트 단일 카드 통합** ([#542](https://github.com/hyewon3938/slack-ai-agents/issues/542), **close 2026-06-16**) — 봇 검증 카드 은퇴 + routine 통합 카드 단독 (ADR-0052)
- **본인 1명 패턴 발견 시스템** ([#434](https://github.com/hyewon3938/slack-ai-agents/issues/434), **close 2026-05-29**) — Phase 1(스키마 rename, ADR-0022\~0026) / Phase 2(사주 시드 풀셋 161개 + evidence-only) / Phase 2.5(운 레벨 차원 + 풀셋 임계치 + 분포 분석 cron, ADR-0028) / Phase 3(life_signal 시드 풀 셋 + 매칭 cron 일반화) / Phase 4(매칭 cron 카운터 source 전환 + pattern-match rename) / Phase 5(가설 발견·검증 파이프라인 target-type 확장) / Phase 6(LLM 자율 매트릭 + 승인 게이트, ADR-0030) / Phase 7(가설 단위 Beta-Binomial posterior + 카드 한 줄 병기 + 시드 영향력 top 5 섹션, ADR-0024 실행) / Phase 8a(catalog 카운터 DROP + per-seed try/catch 격리 + `verify_status='error'` enum, [#462](https://github.com/hyewon3938/slack-ai-agents/issues/462)) / Phase 8b(마스터 close docs + follow-up 일괄 등록, [#464](https://github.com/hyewon3938/slack-ai-agents/issues/464)) 머지 완료. 운영 1\~3개월 후 도입 검토는 [design-notebook 부록 E](./design-notebook/personal-pattern-discovery.md). 흐름: [design-notebook](./design-notebook/personal-pattern-discovery.md)

## 문서 지도

| 문서 | 역할 |
|------|------|
| [README.md](../README.md) | 프로젝트 소개 + 핵심 흐름 다이어그램 |
| [CLAUDE.md](../CLAUDE.md) | Claude 작업 컨텍스트 |
| **이 문서 (features.md)** | **현재 어떤 기능이 있는지 한눈에** |
| `docs/domains/*.md` | 도메인별 스키마·API·로직 상세 |
| `docs/design-notebook/*.md` | 마스터 단위 설계 흐름 (분기점·포기·회고) |
| `docs/adr/*.md` | 되돌리기 어려운 결정 (Michael Nygard 포맷) |
| `docs/conventions.md` | 코드 컨벤션 + 보안 체크리스트 |
| `docs/project-history.md` | 마일스톤 timeline |
