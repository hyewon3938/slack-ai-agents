# 0045. 카드 라벨 레이어 — 런타임 코드 번역 (DB 컬럼 아님)

- Status: Accepted
- Date: 2026-06-08
- Related: [#504](https://github.com/hyewon3938/slack-ai-agents/issues/504), [ADR-0044](0044-discovery-measurement-validity.md) (Phase 1 측정 교정), [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md) §3 (사람 승인 = 노출·큐레이션 게이트), [ADR-0032](0032-metric-first-verification-statistics.md) §7 (연관 not 인과)
- Tags: insight, architecture

## Context

#504 Phase 1이 발굴 측정을 교정한 뒤, 다음 병목은 카드 가독성이다. 프로액티브 인사이트 카드(발굴 후보 · 주간 검증 · 시드 영향력 · 아침 일운)가 전부 내부 식별자를 날것으로 노출한다:

- 시드·신호명이 변수명(`S1_갑목_편재_천간` · `sleep_night_minutes`)이다.
- 신호 description이 **잘못된 provenance**다("N8_… 시드의 schedule_tax_keyword 평가"). #477 P1에서 신호가 전역화(`signal_defs`, 시드와 무관하게 매일 측정)됐는데, 옛 시드 종속 시절의 자동생성 문구가 남아 특정 사주 시드 소속처럼 읽힌다.

ADR-0039 §3은 사람이 [추적 시작]/[패스]로 **노출·큐레이션을 게이트**하고 믿음(진짜냐)은 통계가 가린다고 정했다. 그 게이트가 작동하려면 후보가 무슨 뜻인지 읽혀야 하는데, 식별자 노출이 게이트를 무력화한다(마스터 원칙 #2: 가독성 = 큐레이션 게이트). 라벨을 **어디에 두느냐**가 결정 사항이다 — 런타임 코드에서 생성하느냐, DB에 저장하느냐.

## Decision

### 1. 런타임 코드 번역 (DB 미변경)

라벨 모듈 `insight-labels.ts`(순수 함수)가 카드 조립 지점에서 `seedLabel`/`signalLabel` 문자열을 생성한다. DB 스키마·통계·view는 건드리지 않는다 — #502에 이은 순수 "카피 PR". 통계·verdict·tier·임계치 일절 불변.

### 2. 라벨 비대칭 (시드 strip / 신호 룰)

- **시드 라벨 = description tail-strip + override.** 시드 description은 hand-authored라 접두가 곧 활성조건("일운 천간 갑목(편재) → …" → "일운 천간 갑목(편재)"). 첫 `→`/`—`/`(` 이전만 취한다. 6종 trigger 구조(stem/branch/relation/element_density/sibiunsung/ganji)를 파싱하는 코드 없이 같은 결과.
- **신호 라벨 = name+domain+direction 룰 + override + 태그맵.** 신호 description은 깨진 provenance라 못 쓴다 → metadata로 생성. 측정 명사는 `SIGNAL_MEASURE` 맵(한글접미는 그대로) + 미매핑 토큰 fallback, 방향은 룰(above_avg→"평소보다 많은" 등), 합성·모호는 override, tag 신호는 diary 태그 한글맵.

### 3. 4개 표면, hard / soft

- 코드가 만드는 3개(주간 검증 verified/emerging/reject · 발굴 후보 · 시드 영향력)는 라벨 모듈로 **확정적(hard)** 번역.
- 아침 일운 카드는 외부 SKILL(`daily-insight`)이 SQL view(`saju_influence_summary`)를 소비해 LLM으로 작문 → TS 룰 도달 불가. 프롬프트를 손질해 **식별자 출력 금지 + description 자연어화(soft)**. view·DB 불변.

### 4. 불변식 — raw 변수명 노출 0

미매핑 신호(미래 LLM 신호 등)도 도메인 명사 fallback으로 끝내 raw 변수명이 사용자에게 노출되지 않는다.

## Alternatives considered

- **DB `label` 컬럼 (B안)** — `signal_defs`·`pattern_catalog`에 컬럼 추가 + 룰로 백필. single source라 아침 카드 view까지 같은 라벨 공유 + LLM 신호가 라벨 자기작성 가능. **보류** — 마이그레이션·백필·view 수정·외부 SKILL·LLM 프롬프트까지 범위가 커지고, 공개 repo의 라이브 개인 데이터 DB 마이그레이션은 보여주기용 라벨 대비 리스크가 크다. 아침 카드까지 단일 소스로 묶을 필요가 생기거나 LLM 신호가 늘면 그때 승격.
- **신호명 구조 파싱(NLP/형태소)** — n=1 고정 신호셋엔 과함. 맵 + 토큰 fallback으로 충분. 영구 기각.
- **시드 구조 필드 파싱** — strip이 더 적은 코드로 동일 결과. 기각.
- **아침 카드 코드화(SKILL → TS cron 재플랫폼)** — 라벨 single source는 되나 daily-insight 아키텍처(weekly-fortune 핸드오프 + Claude 앱 스케줄) 전면 재작업. 범위 밖, 기각.

## Consequences

- 게이트가 실제로 걸리는 주간 카드가 확정적으로 readable → 큐레이션 게이트(ADR-0039 §3) 신호 회복.
- DB·통계·view 불변 → 리스크 낮음. 라벨이 틀리면 코드 한 줄 고쳐 배포(컬럼 값 수정보다 추적 쉬움).
- 단점: 아침 카드 라벨이 주간과 다른 경로(LLM 작문)라 같은 시드 문구가 표면별로 미세하게 다를 수 있음 — 수용(표면별 톤 차이, 둘 다 readable이면 충분). 완벽한 cross-surface 일관성은 B안의 몫.
- 신호 description의 깨진 provenance는 카드가 더는 읽지 않아 **dormant**가 됨(DB엔 잔존하나 미사용) — 별도 정리 불요.
- 라벨은 연관(not 인과) 중립 활성조건으로 표기 — ADR-0032 §7 / 헌장 ③ 유지.
