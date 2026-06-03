# 사주 풀이 시스템 책임 분리 + 주간 분석 재설계

> 마스터 이슈: [#421](https://github.com/hyewon3938/slack-ai-agents/issues/421)
> 시작: 2026-05-26
> 상태: Phase A1·A2 완료 (2026-05-26 머지), Phase A3 일운 종합 인사이트 (2026-06-03, #475)
> 출처: [insight-engine-v2.md](./insight-engine-v2.md) Phase 5 진입 시도 중 분리됨

## 개요

사주 풀이 시스템을 단일 책임화하고, 주간 분석 메시지 형태를 재설계하면서, 마스터 #393 v2 데이터(매칭·outcome·hypothesis)를 풀이 입력에 주입할 수 있는 경로를 확립.

핵심 철학:
- **풀이는 자율(LLM) 영역, 매칭은 결정론(SQL) 영역** — 두 영역의 신뢰 비용 분리는 v2 헌장 4번에서 옴
- **풀이가 v2 데이터를 소비** — view 인터페이스(`saju_influence_summary`)를 통해 신뢰도 라벨링된 데이터 공급
- **풀이 LLM 입력에 사용자 텍스트 원문 노출 금지** — v2 헌장 1번 일관 적용

## 전체 Phase 흐름

- [x] **Phase A1**: 책임 분리 + 형태 재설계 + Opus 이관 + 중복 발송 fix (PR #423 머지)
- [x] **Phase A2**: v2 데이터 expose 경로 — `saju_influence_summary` view + idempotency 테이블 (PR #422 머지)
- [x] **Phase A3**: 일운 발송 재설계 — 일일 종합 인사이트 routine (개인화 주입 지점 생성→발송 이동, #475). 월/세/대운 종합 확장은 후속 ([#408](https://github.com/hyewon3938/slack-ai-agents/issues/408) 이후)

---

## Phase A1 + A2: 설계 단계 (2026-05-26)

- 이슈: [#421](https://github.com/hyewon3938/slack-ai-agents/issues/421)
- 관련 plan: `.claude/plans/421-fortune-rework-A1-A2.md` (gitignored, 휘발)
- ADR 후보: ADR-0020 — 사주 풀이 시스템과 v2 매칭 시스템 책임 분리 + view 인터페이스
- 상태: design 완료, /build 대기

### 결정 요약

기존 풀이가 분산된 상태(봇 cron 일운 발송 + weekly-fortune routine DB 저장 + weekly-saju-review routine Slack 발송)를 정리. weekly-saju-review를 폐기하고 새 routine `weekly-saju-review-v2` 신설. Block Kit 카드 구조(회고 prose + 학습 3섹션) + 신뢰도 라벨링(verified / accumulating / recent) + idempotency 발송 기록 테이블. v2 데이터는 `saju_influence_summary` view 한 곳으로 통합 노출. LLM은 Sonnet → Opus 이관. 발송 시점 일요일 21시 → 월요일 08:00 KST.

### 의사결정 분기점

> 사용자 인터뷰 5턴 + 헌장 cross-check 결과.

- **weekly-saju-review의 어느 측면을 재설계할지 (복수 선택)**: 가독성 / 구조 / 내용 분량 / 표현. → **가독성**만 선택. 이유: 구조(5섹션)·분량(1000\~1500자)·표현(명리학자 톤)은 OK, prose 단일 메시지가 가독성을 죽인 주범. 한 축에만 집중하면 재설계 scope가 명확해짐
- **주간 리뷰의 핵심 가치 (단일 선택)**: (1) 이번주 사주 회고 / (2) 다음주 액션 가이드 / (3) 큰 흐름 메타 / **(1)+(4) 둘 다 (선택)** (4) 본인 영향력 큰 요소 누적 학습. 이유: 사용자 진짜 목표가 "특정 글자·십성·합충 본인 영향력 누적 확인" + "이번주 사주 관점 회고"라 두 가치가 한 메시지에 같이 있어야 함. 회고와 학습은 독립 카드보다 결합 카드가 정합
- **가독성 풀이 형식**: **Block Kit 카드 (선택)** / 마크다운 헤더 + 글머리표 / 짧은 텍스트 + 카드 하이브리드. 이유: 헤더·divider·필드 구조가 명확해서 모바일에서도 한눈에 스캔 가능. 인라인 라벨이나 이모지 압축 대비 첫 진입 장벽 가장 낮음
- **1회 읽는 시간 목표**: 30초 / 1\~2분 / **3\~5분 (선택)**. → 3\~5분. 이유: 구조만 잡아도 OK, 분량 자체는 크게 안 줄여도 됨. 가독성이 분량보다 핵심
- **회고 + 학습 카드 구조**: **두 섹션 한 메시지 분리 (선택)** / 회고에 학습 인라인 / 메시지+스레드 분리. 이유: 위→아래 읽는 흐름이 가장 단순. 스레드 분리는 사용자가 스레드를 안 열 가능성 + 인라인 결합은 LLM 작성 복잡도 증가
- **학습 데이터 소스 (복수 선택)**: Phase 4 가설 / Phase 3 시드 누적 / Phase 3 최근 매칭. → **3개 다 + 신뢰도 라벨링 필수**. 이유: 가설만으로는 BH-FDR 보수성으로 너무 적게 잡힘. 3개 다 가져오되 신뢰도가 시각적으로 구분돼야 헌장 ④ 신뢰 비용 분리와 일관
- **신뢰도 노출 방식**: **섹션 구분 (헤더 + divider) (선택)** / 인라인 라벨 [검증][누적][최근] / 이모지 압축. 이유: "구조만 잡아도 OK" 가치와 정합 + Block Kit Header + Divider 모바일 가독성 best
- **분량 통제 룰**: 검증 3개 / 누적 5개 / 최근 카운트만. + 중복 처리 룰: 같은 글자/십성이 여러 tier 동시 등장 시 최상위 tier에만 한 번
- **A2 인터페이스 형태**: **DB view + DB Proxy API SELECT (선택)** / 봇 endpoint / MCP 도구. 이유: weekly-fortune routine이 이미 DB Proxy API 사용 중 → 일관성. view 단일 SELECT로 완결. 봇 코드·MCP 인프라 추가 없이 인터페이스 완성
- **A1·A2 작업 순서**: A2 먼저 → A1 / **A1·A2 병행, PR 분리 (선택)** / A1 mvp → A2 → A1 v2. 이유: 직렬화 시 새 리뷰 공백 발생, mvp→v2는 학습 섹션 빠진 mvp 가치 절반 인상. 병행이 출시 속도 + 위험 균형. view 스키마 초안을 plan에 명시 → 컬럼 mismatch 방지
- **발송 주기**: 주 1회 유지
- **발송 시점**: 일요일 22시 / **월요일 08:00 (선택)** / 자유 입력. 이유: 한 주 시작하는 월요일 아침에 지난주 회고 + 이번주 액션 에너지로 연결. 일요일 밤은 안 읽고 넘어가기 쉬움
- **일운 매일 발송 (insightMorningTask 09:05)**: **유지 (선택)** / 폐기 / weekly에 흡수. 이유: 아침 일운(짧은 단위)과 주간 리뷰(회고+학습)는 역할이 다름. 통합 시 주간 메시지가 더 길어짐. 책임 분리 측면에서도 두 역할은 분리가 자연스러움
- **LLM**: Sonnet → **Opus (선택)**. 이유: 사용자 명시 선호. 풀이 영역은 자율 LLM이라 신뢰 비용을 모델 품질로 보완
- **중복 발송 fix 방안**: SKILL.md prompt에 "1회만" 명시 / **idempotency 테이블 (선택)** / Routine retry 정책 조정. 이유: prompt 의존은 retry/parsing 변수에 약함. 테이블 UNIQUE 제약이 가장 견고. `saju_weekly_reviews (user_id, week_start UNIQUE)` ON CONFLICT DO NOTHING로 RETURNING 비어있으면 routine 즉시 종료

### 포기한 안 / 미룬 항목

- **weekly-saju-review가 갱신하던 `saju_patterns` 테이블 갱신**: 일단 보류. Phase A1 완료 후 사용 여부 재평가. 다른 곳에서 saju_patterns를 읽는 코드가 있으면 마이그레이션, 없으면 폐기
- **API endpoint / MCP 도구로 v2 데이터 노출**: 기각. DB view + DB Proxy API SELECT가 단순 + 일관 + 충분
- **mvp(회고만) 먼저 출시 후 학습 섹션 추가**: 기각. 학습이 가치 1+4의 절반이라 mvp 단계가 "그래도 아쉽네" 인상 누적
- **인라인 신뢰도 라벨 / 이모지 압축**: 기각. 모바일 가독성 + 첫 진입 장벽 측면에서 섹션 구분이 우월
- **자율 LLM이 새 가설 만들기**: 기각. 풀이 LLM은 view 결과 안에서 해석만 (헌장 ④). 새 가설은 #392 Phase 4 자동 발견 파이프라인 영역

### 미해결·가설

- **view 스키마 SELECT 성능**: 3개 소스 union + NOT EXISTS 서브쿼리 두 번 = 사용자 1명 기준은 무난할 것으로 추정. 데이터 누적 6개월 후 EXPLAIN ANALYZE 점검 필요
- **accumulating tier 임계값 (hit/total > 0.55, n≥5)**: 1차안. 운영 후 카드에 너무 많이 / 너무 적게 잡히면 조정
- **Opus 이관 후 회고 prose 품질**: 1주 spot check 필수. Sonnet 대비 톤 어색하면 prompt 미세 조정
- **Block Kit 50 blocks 한계**: 검증 3 + 누적 5 + 최근 1 + 헤더 5 + divider 4 + 회고 1 = \~19 blocks. 여유 충분
- **사용자가 회고 prose보다 학습 섹션을 더 봐서 회고가 죽을 가능성**: 운영 후 사용자 피드백으로 비중 조정. 회고가 안 읽히면 분량 더 줄이거나 카드 순서 학습→회고 reverse 검토
- **week_start 정의 (월요일? 일요일?)**: 1차안은 발송 시점 기준 직전 월요일. 한국 관습 + 발송 요일과 일관

### 회고 (인터뷰 단계)

- **사용자 진짜 의도 발견 패턴**: insight-engine-v2 Phase 5 진입 인터뷰에서 5턴 후 "주간 사주 리뷰 데이터 기반화"가 진짜 동기였음이 드러나면서 마스터 A 자체가 spawn됨. 액면 키워드(Phase 5)와 진짜 동기(주간 리뷰 개편)가 어긋나는 패턴은 첫 진입 인터뷰의 단골 패턴이라 기록
- **사용자가 "추천 방향 있어?"를 두 번 묻고 둘 다 즉시 답이 가능했던 사례**: 신뢰도 노출 방식 + A1·A2 작업 순서 두 결정에서 사용자가 추천을 요청. 두 결정 모두 직전 사용자 선택들(가독성·구조 위→아래·3개 데이터 소스 다 등)과 일관성 점검만으로 추천 가능 → 인터뷰 흐름이 누적되면 후속 결정 추천 신속도 ↑. 다음 인터뷰부터 누적 답변을 추천 근거로 명시적 인용하는 패턴 정착
- **헌장이 본 마스터 안에서도 결정 도구로 작동한 사례**: 풀이 LLM이 새 가설 만들기 옵션을 헌장 ④(신뢰 비용 분리)로 자동 기각. 헌장은 모마스터 외부 폐기 도구만 아니라 내부 안 선별 도구로도 작동
- **분리된 마스터 사이 의존 관계가 plan과 design-notebook 양쪽에서 추적되는 구조**: 마스터 A는 #408 Phase 5 머지에 A3가 의존. 이 관계가 plan 문서 + design-notebook 양쪽에 cross-link로 기록 → 두 마스터를 별개 epic으로 가져가면서도 만나는 지점 명확

### 기술적 의의

- **신뢰도 라벨링 view 패턴**: 한 view 안에서 verified/accumulating/recent 3 tier를 union하고 confidence_tier 컬럼으로 메타 분리. 자율 LLM 입력에 신뢰도 정보가 같이 들어가 LLM이 신뢰도에 따른 해석 강도 조절 가능. 데이터 측에서 신뢰 비용 분리를 강제하는 패턴
- **idempotency 테이블이 LLM 측 retry 노이즈 흡수**: SKILL.md prompt에 "1회만" 명시하지 않고 DB 제약으로 강제. LLM·Routine 측 retry 정책에 무관하게 발송 1회 보장. 프롬프트 의존을 DB 제약으로 변환한 패턴
- **마스터 분리 후 view를 매개로 통합**: 두 마스터(매칭 / 풀이)가 같은 view를 진화시키며 책임은 분리, 데이터 흐름은 단일. 마스터 분리가 통합을 방해하지 않는 구조

---

## Phase A1 + A2: 결과/회고 (2026-05-26 머지)

- PR #422 (Phase A2): `saju_influence_summary` view + `saju_weekly_reviews` 테이블 + ADR-0020 + design-notebook 갱신
- PR #423 (Phase A1): `weekly-saju-review-v2` Routine 등록 + 도메인 문서 Phase A1 본문 + 카탈로그 잔존 흔적 정리
- 두 PR이 같은 날 머지되어 다음 월요일 첫 발송 준비 완료

### 구현 단계에서 발견된 것

- **plan SQL 버그 사전 캐치**: `.claude/plans/421-fortune-rework-A1-A2.md`의 view DDL 초안에서 `accumulating` dedup이 `WHERE a.id = r.signal_id` (실제 alias는 `signal_id`). 마이그레이션 작성 단계에서 CTE 컬럼 alias 일관성 점검 중 발견 → `a.signal_id = r.signal_id`로 수정. plan은 휘발 메모이므로 실제 마이그레이션 단계에서 한 번 더 검증해야 한다는 5문서 아키텍처의 owner 분리 가치를 재확인
- **view 운영 환경 첫 SELECT 결과**: verified 0 / accumulating 0 / recent 14. 데이터 상태(Phase 4 fdr_q 통과 시드 아직 없음, accumulating 임계 hit rate > 55%·n≥5 미달) 자연 반영 — 쿼리 버그가 아님을 raw count 점검으로 확인. 첫 주 routine 발송 시 verified·accumulating 0건 메시지 표시 (`_아직 통계 검증 통과한 시드 없음_` / `_아직 누적 패턴 없음_`) 검증 대상
- **SKILL.md 위치 혼동**: routine SKILL.md는 repo 내가 아니라 사용자 HOME `~/.claude/scheduled-tasks/<id>/SKILL.md`에 배치. 도메인 문서에 위치 명시 + 향후 routine 변경 시 SKILL.md 경로 추적 가능하도록 기록
- **Opus 모델 지정 메커니즘**: `mcp__scheduled-tasks__create_scheduled_task` schema에 model 파라미터 없음. Claude 앱 model selector에서 사용자가 직접 지정 필요. SKILL.md 주의사항에 명시 + 도메인 문서 발송 메타에도 명시

### 폐기 처리 결정

- 구 `weekly-saju-review` routine: 비활성화 유지, archive는 v2 안정성 1\~2주 검증 후 별도 작업으로. 폐기 전에 v2 실패 시 fallback 가능성 확보
- `saju_patterns` 테이블: 누적 row는 시스템 프롬프트 조회용으로 계속 사용, 갱신 routine만 정지. 신 routine은 새 데이터 모델(`saju_influence_summary` view)을 사용하므로 saju_patterns와 독립

### 다음 액션

- 다음 월요일(2026-06-01) 08:00 KST 첫 발송 — Block Kit 카드 가독성·idempotency 동작·Opus prose 톤 운영 검증
- Phase A3 (4층 레이어 expose) — #408 Phase 5-B 머지 후 view에 월운 layer 추가 (컬럼 contract 유지)
- A1 첫 주 운영 후 임계치 조정 여부 판단: accumulating tier hit rate > 55% / 5건 임계가 카드에 너무 많이/적게 잡으면 외부화 검토 (ADR-0020 후속 작업 항목)

---

## Phase A3: 일운 종합 인사이트 (2026-06-03, #475)

- 이슈: [#475](https://github.com/hyewon3938/slack-ai-agents/issues/475)
- 관련 plan: `.claude/plans/475-daily-insight-synthesis.md` (gitignored, 휘발)
- ADR: [ADR-0031](../adr/0031-daily-insight-synthesis.md) — 개인화 주입 지점을 생성에서 발송으로 이동
- 상태: design + build 완료

### 개요

원래 A3는 "weekly-fortune이 생성 시점에 view를 주입(4층 레이어, #408 월운 의존)"이었으나, 인터뷰 중 두 구조적 제약이 드러나며 **"일운 발송 재설계"로 확장**됐다. A2에서 view(`saju_influence_summary`)를 깔고 weekly-saju-review-v2가 첫 소비자가 됐지만, **매일 발송되는 일운에는 학습이 전혀 주입되지 않는** 공백이 남아 있었다. 이 공백을 메우는 게 A3.

매일 08:00 KST 일일 종합 인사이트 routine(`daily-insight`, Opus)을 신설 — 오늘 사주 일운(베이스) + 오늘 발현 시드를 신뢰도 tier별로 종합. 개인화 지점을 "주1회 생성(weekly-fortune)"에서 "매일 발송"으로 이동.

### 의사결정 분기점

> 사용자 인터뷰 다수 턴 + 헌장 cross-check.

- **접근 방향 (단일 선택)**: (1) 연결 인프라 먼저 / (2) 검증 재료부터 / (3) 구패턴 이관. → **(1) 연결 먼저**. 이유: 작은 작업 + 후퇴 없음 + 미래 데이터 성장을 전제로 깔면 검증 누적이 자동으로 품질을 올림
- **개인화 주입 지점 (핵심 전환)**: weekly-fortune 생성 시점 주입 → **매일 발송 시점 종합으로 전환**. 이유: ① 생성은 주1회라 7일 스냅샷 지연 ② life_signal은 "오늘 기준" 누적이라 미래 7일치를 미리 생성 불가. 발송 시점 종합이 두 제약을 동시 해소 + weekly-fortune은 미래 예보로 불변 유지
- **일운을 "오늘의 총 종합"으로 격상 (단일 선택)**: 일운 따로 + 종합 따로 / **일운 자체를 종합 인사이트로**. 이유: 인사이트 채널에서 사주+라이프 패턴을 한 메시지로 커버. 라이프 채널 잔소리(매칭 한 줄)는 별도 유지 — 채널 역할 분리
- **미래 종합 여부 (단일 선택)**: 미래 7일 종합 / **오늘만**. 이유: life_signal의 시간성상 미래 미리 생성 불가 + 사용자도 "미래는 사주 예보(weekly-fortune)로 충분, 종합 미래는 불필요"
- **recent 처리 (핵심)**: 검증된 것만 / **현황 포함(인과는 검증분만)**. 이유: 현재 verified∩발현 = 0이라 검증만으로는 메시지가 빈손. recent를 "오늘 이런 기운·신호가 활성"이라는 **현황 맥락**으로 포함하되 인과 주장은 금지. 검증 누적되면 시드가 recent→accumulating→verified로 자동 격상되며 인과 레이어가 성장
- **매칭 순서 (단일 선택)**: **A. 매칭 07:00로 당기기** / B. 종합을 매칭 후로 미루기. 이유: 08:00 종합이 그날 발현 시드를 읽으려면 매칭이 선행해야 함. 09:00→07:00이 가장 단순. + 갭 자동 백필로 누락 재발 방지

### 포기한 안 / 미룬 항목

- **weekly-fortune view 주입 (원래 1단계)**: 7일 지연 + 사주 시드만 가능 → 매일 발송 종합으로 흡수
- **구 `saju_patterns` 26개 신 시스템 이관**: 큰 작업 + 통계 검증 약함 → A3 후속(별도 트랙). weekly-fortune 관점 5 정리와 묶어서
- **recent 검증된 것만**: verified∩발현 0 → 빈손 → 현황 포함으로
- **종합 미래 확장**: life_signal 시간성 → 오늘만. 월·세·대운 종합은 #408 이후 (일운 종합을 템플릿으로)

### 미해결·가설

- **현황 데이터(2026-06-02 확인)**: 주 928건 매칭, 활성 시드 229개. view tier verified **0** / accumulating **1** / recent 65. 하루 발현 사주 16 + 라이프 14 (풍부)지만 verified/accumulating과 교집합 0 → 당분간 현황 레이어 + 사주 베이스가 주력. 인과 레이어는 매트릭 승인 누적되며 성장 (운영 1\~3개월 후 품질 점검)
- **6/1 매칭 누락 의심 → 실제 정상**: 진단 결과 5/26\~6/3 매일 데이터 존재(누락 0). 6/1도 229건. 단 cron이 "오늘만" 매칭이라 봇 다운 시 구조적 누락 가능 → 갭 백필 추가 (현재 백필 불필요, 재발 방지)
- **prose vs Block Kit**: 1차안 prose (기존 일운 톤 연속성). 검증/현황 섹션 구분 가독성은 운영 후 판단
- **매일 Opus 비용 vs 가치**: 운영하며 체감 점검

### 회고 (인터뷰 + 구현)

- **액면 요청 → 진짜 가치 분기 (누적 패턴)**: "일운에 사주 데이터 주입" 요청이 인터뷰 중 기술 제약(7일 스냅샷 지연 · life_signal 시간성) 제시로 "매일 종합 인사이트"로 진화. A1에서 "Phase 5 진입 → 주간 리뷰 개편" 분기에 이어 fortune-rework 마스터의 두 번째 동일 패턴. 첫 진입 인터뷰에서 액면 키워드와 진짜 동기가 어긋나는 건 단골
- **DB 사실 확인이 설계를 전환**: verified 0 / 검증∩발현 0을 raw count로 확인 → "검증된 것만" 안을 기각하고 "recent 현황 포함 + 미래 성장" 구조 채택. 설계 판단을 추측이 아니라 운영 데이터로 내린 사례
- **매칭 백필 부재 발견**: 6/1 누락 의심 조사 과정에서 cron이 `getEffectiveTodayISO()`로 "오늘만" 매칭함을 발견 → 실제 누락은 아니었으나 구조적 누락 가능성을 선제 차단(갭 백필). 사고 조사가 잠재 결함 발견으로 이어진 사례

### 기술적 의의

- **개인화 주입 지점 이동(생성→발송)**: 신선도(스냅샷 지연 제거)와 시간성(life_signal "오늘 기준")을 한 번에 해소. view tier 승급이 메시지 강도에 자동 반영돼 코드 변경 없이 품질이 성장하는 구조
- **신뢰도 tier 기반 표현 강도 차등 + 할루시네이션 차단**: verified=단언 / accumulating=경향 / recent=현황. view·매칭에 **있는 시드만** 사용하고 LLM이 새 패턴 생성 금지 (헌장 ④ + 기각안 일관). A2의 신뢰도 라벨링 view 패턴을 일일 발송에 적용
- **갭 자동 백필이 UPSERT 멱등성에 기댐**: `recordDailyMatches`의 ON CONFLICT DO UPDATE 덕분에 "마지막 매칭일+1~오늘" 재실행이 안전. 봇 다운 복귀 시 자동 복구. 14일 상한 + truncation 로그로 백필 폭주 방지

## Phase A3: 결과 (2026-06-03)

- PR #475 (예정): 마이그레이션 076 (`daily_insight_log` + 매칭 07:00 + insightMorning 비활성) + 매칭 갭 백필 + insightMorning cron 제거 + ADR-0031 + 도메인 §23
- routine SKILL.md (`~/.claude/scheduled-tasks/daily-insight/`)는 repo 외부 — 변경 이력은 ADR-0031 + 도메인 §23로 추적

### 구현 단계에서 확인된 것

- **CronScheduler가 미매핑/비활성 슬롯 안전 스킵**: `loadAndSchedule`이 `!setting.active` + `!SLOT_TASKS[slot_name]` 둘 다 `continue`. insightMorning을 코드(SLOT_TASKS)와 DB(active=false) 양쪽에서 제거 — belt-and-suspenders
- **formatFortuneText 이중 사용처**: life-cron(insightMorning, 제거)과 agents/insight(유저 트리거 /일운 조회, 유지). insightMorning 제거 후 life-cron import만 정리, fortune-format.ts·유저 트리거 경로는 불변
- **verifyDailyMatches는 이미 갭 안전**: `date <= CURRENT_DATE - 1` 전체 pending을 처리 → 백필분이 pending으로 기록되면 같은 cron 실행 내 verify가 자동으로 hit/miss 확정. 백필 설계가 기존 검증 사이클에 무손실로 얹힘
