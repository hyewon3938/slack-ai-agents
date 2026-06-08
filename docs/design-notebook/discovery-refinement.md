# 발굴 엔진 측정 타당성 + 카드 UX (마스터 #504)

> [#477](https://github.com/hyewon3938/slack-ai-agents/issues/477)(매트릭 중심 패턴 검증) 후속 교정 마스터. 첫 주간 발굴 운영에서 드러난 측정 아티팩트·카드 가독성·후보 재추천 UX를 3 Phase로.

## 핵심 원칙

이 마스터는 **#477 헌장 4개 + [ADR-0032](../adr/0032-metric-first-verification-statistics.md) 통계 스택 위에서** 진행한다(헌장 본문은 복제하지 않음 — `project_477_metric_first_verification` / `project_insight_v2_core_principles` 메모리 + [metric-first-verification.md](metric-first-verification.md) 참조). 본 마스터가 추가로 박는 원칙:

1. **측정 타당성은 통계 신뢰성의 선행조건 (GIGO)** — 안전장치(Fisher·e-value·BH-FDR)는 "우연이냐"만 검정한다. 측정이 현실을 정직하게 담지 못하면(빈 과거를 0으로 채우는 등) 체계적 아티팩트가 모든 검정을 *통과*한다. 측정 교정이 카피·UX보다 우선.
2. **카드 가독성 = 휴먼 큐레이션 게이트** (ADR-0039 §3 강화) — 사람이 노출·큐레이션을 게이트하려면 후보가 무슨 뜻인지 읽혀야 한다. 내부 식별자 노출은 게이트를 무력화. 명료한 라벨이 "말 안 되는 후보를 거부로 거르는" 메커니즘.
3. **발굴은 자유 전조합 유지** — 도메인 게이팅으로 좁히지 않는다. 측정을 고치면 허수가 자연 탈락하므로, 발견력을 죽이는 사전 필터보다 정직한 통계를 우선(헌장 ②). 측정 교정 후 재평가.

## Phase 흐름

### Phase 1 — 측정 타당성 (측정 PR) · [ADR-0044](../adr/0044-discovery-measurement-validity.md)

진단 서사: 발굴 윈도우 365 고정 vs 운영 초기 데이터 구간 → 연속신호 `COALESCE(SUM,0)`이 빈 과거를 "0분 수면"으로 채움 → 비발현일 pass율(rateOff)→0 → `effect=rateActive/rateOff` 폭증(\~184배) → top-N effect 정렬이 그 허수를 독식, 사주 후보 밀어냄. 통계 안전장치는 "우연이냐"만 보므로 체계적 아티팩트를 GIGO로 통과시킴.

결정(상세 ADR-0044):
- 윈도우 = 데이터-존재 구간(per-pair overlap). 빈 과거 제외 · 활성 구간 내 유효 0 보존.
- 발굴 연속신호 랭킹 = 효과크기(Hodges-Lehmann/MW), §4 정렬. e-value 확정 트랙 불변.
- 중복 `signal_defs` 정규화 + 링크 repoint.

### Phase 2 — 카드 가독성 (카피 PR) · [ADR-0045](../adr/0045-card-label-layer.md)

진단: 모든 프로액티브 인사이트 카드가 내부 식별자를 날것으로 노출한다. 시드·신호명은 변수명(`S1_갑목_편재_천간`·`sleep_night_minutes`)이고, 신호 description은 **잘못된 provenance**("N8_… 시드의 X 평가" — 신호는 P1에서 전역화됐는데 옛 시드 종속 시절 문구가 잔존). 사람이 [추적 시작]/[패스]로 노출을 게이트하려면(원칙 #2) 후보가 무슨 뜻인지 읽혀야 하는데, 식별자 노출이 게이트를 무력화한다.

결정(상세 ADR-0045):
- **런타임 코드 번역(A안), DB 미변경.** 라벨 모듈(`insight-labels.ts`)이 카드 조립 지점에서 `seedLabel`/`signalLabel` 문자열을 생성. label 컬럼(B안)은 기각 — 보여주기용 라벨에 라이브 개인 DB 마이그레이션은 위험 대비 실익이 작다.
- **라벨 비대칭** — 시드는 description 접두가 곧 활성조건이라 `→`/`—`/`(` tail-strip + override. 신호는 description이 깨진 provenance라 못 쓰고 name+domain+direction 룰 + override + 태그맵으로 생성.
- **4개 표면**: 주간 검증(verified/emerging/reject) · 발굴 후보 · 시드 영향력 top = 코드 룰(hard). 아침 일운 카드(외부 SKILL, SQL view 소비 → TS 룰 도달 불가)는 프롬프트 손질로 식별자 출력 금지 + description 자연어화(soft).
- 통계·verdict·tier·임계치 일절 불변 — 표현 문자열만(#502 카피 PR 연장).

#### 의사결정 분기점

- **저장 위치 (A 코드 / B DB 컬럼)**: A 채택. 룰 로직은 양쪽 동일하게 필요하고, 차이는 저장 위치와 도달 범위뿐. 게이트가 실제로 걸리는 건 코드가 만드는 주간 카드라 A가 진짜 문제를 정확히 해결. B는 single-source(아침 카드 view까지 공유)·LLM 신호 라벨 자기작성 이점이 있으나 마이그레이션·백필·view·외부 SKILL·LLM 프롬프트까지 범위가 커져 "측정 먼저, 카피는 가볍게" 흐름과 어긋남.
- **시드 라벨 생성 (구조 필드 파싱 / description strip)**: strip 채택. 시드 description은 hand-authored라 접두("일운 천간 갑목(편재)")가 이미 깔끔한 활성조건. 6종 trigger 구조(stem/branch/relation/element_density/sibiunsung/ganji)를 파싱하는 코드보다 tail-strip이 같은 결과를 훨씬 적은 코드로. 신호는 description이 깨져서 어쩔 수 없이 룰.
- **아침 카드 (코드 도달 / 프롬프트 / 보류)**: 프롬프트 손질 채택. SQL view라 TS 룰을 못 부르지만, "모든 인사이트 readable" 목표상 빼면 누락. LLM 자연어화라 누수가 경미해 hard rule(식별자 금지)로 충분.

#### 포기 / 미룬

- **DB label 컬럼(B안)** — 보류. 아침 카드까지 단일 소스로 묶거나 LLM 신호가 늘어 라벨 자기작성이 필요해지면 재검토.
- **신호명 구조 파싱(NLP)** — 영구 기각. n=1 고정 신호셋엔 SIGNAL_MEASURE 맵 + 토큰 fallback으로 충분. 미매핑(미래 LLM 신호)은 도메인 명사 fallback으로 raw 변수명 노출만 막으면 됨.

### Phase 3 — 후보 재추천 (재추천 PR)

- 한 묶음(주 N개, 월 06:00) 전부 거부 → 다음 best 묶음 surface. 여집합 자동제외 덕에 발굴 재실행만으로 "다음 5개"가 공짜.
- 정지 규칙: **후보 자연 소진이 1차**, 회차 cap(사용자 지정)은 보조 가드. 무응답 카드 = 보류(거부 아님). 일부 승인 시 재추천 없음.
- 트리거 = daily tick 권장(동기 클릭 X — 발굴 재실행이 무거움). 매주 리셋. 재추천 흐름 ADR은 Phase 3 진입 시 작성.

## 포기 / 보류

- **도메인 게이팅**(말 되는 조합만 시험) — 측정 교정 후에도 허수가 남으면 재검토(D, 보류). 지금은 자유 전조합 유지.
- **연속신호 확정 트랙 비이진화** — e-value 게이트를 연속용으로 재설계해야 해 과함. 발굴 랭킹 교정으로 충분(ADR-0044 Alternatives).

## 기술적 의의

n=1 자동 통계 시스템에서 "통계적 유의 ≠ 측정 타당성"을 운영 데이터로 마주치고, 안전장치가 못 잡는 체계적 아티팩트(GIGO)를 측정 층에서 교정. 헌장(ADR-0032 §4)과 구현의 드리프트를 cross-check로 포착해 "고치는 게 곧 헌장 정합"인 방향으로 수렴.
