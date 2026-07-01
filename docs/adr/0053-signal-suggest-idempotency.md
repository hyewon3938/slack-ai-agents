# 0053. 월간 신호 제안 루틴 idempotency — DB 클레임 테이블

- Status: Accepted
- Date: 2026-07-01
- Related: #546
- Tags: data, process, reliability

## Context

`monthly-signal-suggest`는 매월 1일 09:30 KST 실행되는 LLM 기반 Claude 앱 routine(repo 밖 SKILL)이다. 누적 라이프 데이터(카운트·태그·평균만)로 새 측정 신호(`signal_defs` source=llm status=pending)를 0\~5개 생성·INSERT하고 후보별 승인 카드를 #insight에 발송한다 (#477 P5b, ADR-0040).

발송 중복이 관측됐다: 카드가 발송·승인된 뒤 동일 내용이 재발송. `signal_defs`에는 중복 행이 없어(발송만 2회) 원인은 후보 생성이 아니라 **발송 계층**이다.

- 기존 idempotency는 SKILL 1단계의 **소프트 체크**(이번 달 `signal_defs` 카운트 조회 후 cnt>0이면 종료)로만 존재.
- LLM이 프롬프트 스텝을 100% 이행한다는 보장이 없고, 재실행·부분 재시도 시 이미 pending인 카드를 다시 발송할 수 있다. 발송 계층에 **원자적 하드 가드가 없다**.
- 동일 프로젝트의 `weekly-saju-review-v2`는 이미 `saju_weekly_reviews`(마이그 062) `UNIQUE` 제약 + `INSERT ON CONFLICT ... RETURNING` 패턴으로 중복 발송을 막고 있다 — 재사용 가능한 선례.

## Decision

DB 클레임 테이블로 원자적 월별 실행 클레임을 도입한다.

1. 신규 테이블 `signal_suggest_runs(user_id, month_start DATE, posted_at)` `UNIQUE(user_id, month_start)` — 062 패턴과 동일 결.
2. routine의 **최초 DB 액션**을 원자적 클레임으로 교체:

```sql
INSERT INTO signal_suggest_runs (user_id, month_start)
VALUES ($1, DATE_TRUNC('month', (NOW() AT TIME ZONE 'Asia/Seoul'))::date)
ON CONFLICT (user_id, month_start) DO NOTHING
RETURNING id
```

RETURNING이 비면 "이번 달 이미 실행됨" 출력 후 **즉시 종료**. 값이 있으면 진행.

3. 클레임을 **최초 액션**으로 두어, 두 번째 실행은 후보 생성(LLM 토큰)·INSERT·발송 이전에 종료 → 중복 발송·중복 행·중복 LLM 비용 모두 차단.
4. 보조 가드: SKILL 5단계에 "후보별 카드는 정확히 1회 발송, 실패해도 재시도 루프 금지" 명시 — 단일 실행 내 발송 tool 중복 호출 모드 보완.

## Alternatives considered

### A. 소프트 카운트 체크 유지·강화 (`signal_defs` 월별 조회)

- 장점: 스키마 변경 없음
- 단점: 원자성 없음(동시 두 실행이 둘 다 통과 가능), LLM 이행 의존 그대로
- 기각: 이번 사고의 원인 계층을 그대로 둠

### B. 카드 발송을 봇 코드로 이관 (결정론적 100% 차단)

- 장점: routine은 후보 생성·INSERT만, 발송은 봇이 UNIQUE·트랜잭션으로 완전 보장
- 단점: P5b 발송 아키텍처(ADR-0040) 변경 + #477 헌장(생성/판정/발송 역할 배치) 재검토 필요, 범위 과대
- 기각(보류): 월 1회 저빈도라 현 시점 과투자. 재발 지속 시 별도 마스터로 승격

### C. `signal_defs (user_id, name)` UNIQUE 제약

- 장점: 중복 후보 행 방지
- 단점: 이번 문제(중복 발송)는 못 막음(행은 이미 1개). rejected 재제안 노이즈와도 별개 축
- 기각: 문제 영역 불일치

### 클레임 시점: 최초 액션(선택) vs 발송 성공 후 기록

- 발송 성공 후 기록(ADR-0052 weekly-review가 택한 방식)은 미발송 주 수동 재실행을 보장하지만, 두 실행이 모두 성공하면 중복 발송을 못 막는다.
- signal-suggest는 **중복 방지가 최우선**이고 월간 신호 제안은 출력 연속성-critical이 아니므로(0건 발송도 정상 결과), 최초-클레임을 택해 중복을 확실히 막는다. 대가로 클레임 후 크래시 시 그 달은 건너뜀(burned month) — 저빈도·저손실이라 수용. (weekly-review와 반대 선택인 이유 = 카드 성격 차이: 회고 카드는 연속성 필수, 신호 제안은 선택적.)

## Consequences

### 장점

- 재실행·스케줄러 중복 fire·프롬프트 중복 호출 어떤 원인이든 원자적으로 하나만 승리 → 중복 발송·행·LLM 비용 차단.
- 기존 062 idempotency 패턴 재사용 → 일관성, 온보딩 비용 낮음.

### 단점 / 제약

- 여전히 routine이 클레임 스텝을 실행해야 효력. 이를 위해 클레임을 **최초·필수 액션**으로 배치(프롬프트 구조로 강제). 코드 레벨 100% 강제는 대안 B 필요.
- 클레임 후 조기 크래시 시 해당 월 스킵(burned month). 월간·저손실이라 수용, 다음 달 자동 복구.
- 단일 실행 내 LLM 발송 tool 중복 호출 모드는 클레임으로 못 막음 → SKILL 5단계 "1회 발송" 가드로 보완.

### 후속 작업

- [ ] 마이그 094 `signal_suggest_runs` + prod 적용
- [ ] SKILL 1단계 원자적 클레임으로 교체(최초 액션), 5단계 1회 발송 가드
- [ ] `docs/domains/insight.md` P5b 섹션에 idempotency 테이블 반영
- [ ] (별도) rejected 재제안 노이즈 억제는 분리 이슈

---

**참고 자료**

- ADR-0040 — `monthly-signal-suggest` (P5b LLM 신호 제안)
- [ADR-0052](0052-weekly-insight-single-card-merge.md) — weekly-review idempotency(발송 성공 기준) 대비
- 마이그 062 `saju_weekly_reviews` — 동일 idempotency 패턴 원형
