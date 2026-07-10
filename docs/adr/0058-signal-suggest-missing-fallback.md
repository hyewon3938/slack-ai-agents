# 0058. 월간 신호 제안 누락 fallback 알림 — row-존재 감지

- Status: Accepted
- Date: 2026-07-08
- Related: #466 (마스터 #434 Phase 6 follow-up), [ADR-0052](0052-weekly-insight-single-card-merge.md), [ADR-0053](0053-signal-suggest-idempotency.md), [ADR-0040](0040-llm-signal-sql-validation-and-execution-isolation.md)
- Tags: reliability, process, insight

## Context

`monthly-signal-suggest`는 매월 1일 09:30 KST 실행되는 LLM 기반 Claude 앱 routine(repo 밖 SKILL)이다 (#477 P5b, ADR-0040). 그런데 이 routine이 실패하거나 앱이 그 시각에 안 켜져 **아예 안 돌면 그 달 신호 제안이 조용히 누락**된다 — 감지·알림 안전망이 전무하다. 실제로 봇 사이드에는 `signal_suggest_runs`를 읽는 코드가 하나도 없다.

이 안전망 부재는 #466 검토 항목 중 "routine 실패 fallback 경로"로, 회고 본체(승인률·거절률 분포)와 달리 **표본 축적과 무관하게 지금 해소 가능**하다.

선례가 있다: `weekly-saju-review-v2`도 repo 밖 routine이고, 봇 사이드 fallback 슬롯(`weeklyReviewFallback`, [ADR-0052](0052-weekly-insight-single-card-merge.md), 월 10:00)이 `saju_weekly_reviews` row 존재를 확인해 미발송 주에 "수동 실행해줘" 알림만 발송한다. 같은 패턴을 재사용할 수 있다.

**단, 의미론 차이가 핵심이다.**

| | `saju_weekly_reviews` (weekly) | `signal_suggest_runs` (monthly) |
|---|---|---|
| row 기록 시점 | 발송 성공 후 | **최초 액션 클레임** (발송 전, ADR-0053) |
| row 존재 의미 | "이번 주 카드 나감" | "이번 달 routine이 최소 1스텝 실행됨" |
| row 없음 의미 | 미발송 | **그 달 routine이 아예 안 돎** |

즉 `signal_suggest_runs`의 row는 발송 성공을 뜻하지 않는다. 클레임 직후 크래시하면 row는 있는데 발송 0건인 "burned month"가 되고(ADR-0053이 저빈도·저손실로 수용), 게다가 후보 0건 발송도 정상 결과다. 그래서 **row 있음만으로 "정상"이라 단정할 수 없고, row 없음만이 확실한 실패 신호**다.

## Decision

봇 사이드에 daily 등록 + 월 2일 내부 가드 슬롯 `signalSuggestFallback`을 추가하고, `signal_suggest_runs`의 **row-존재(`SELECT EXISTS`)로 "그 달 routine 미실행"을 감지**해 `#insight`에 수동 실행 알림만 발송한다. 봇이 제안을 대신 생성·발송하지 않는다.

1. **감지 대상 = "그 달 최초 클레임 스텝조차 실행 안 됨"** (= 스케줄러/앱 완전 실패). 가장 흔한 조용한 실패 모드.
2. **2일 가드** (`getKSTDayOfMonth() !== 2` early return): 1일 정상 실행이면 2일엔 이미 row → no-op. 1일에 앱이 꺼졌다 당일/익일 늦게 밀려 실행돼도 2일 체크 전 row가 생기면 no-op(헛알림 억제). 2일까지도 row 없으면 진짜 누락으로 판정.
3. **알림만 (대신 발송 안 함)**: ADR-0052 Alt B(봇이 반쪽 카드 생성) 기각을 계승. LLM 신호 생성은 봇 능력 밖이므로 봇이 할 수 있는 건 사용자에게 수동 재실행을 알리는 것뿐.

## Alternatives considered

### A. burned month까지 감지 (row 있는데 발송 0건 구분)

- `signal_suggest_runs`에 발송완료/후보수 컬럼을 추가하거나 SKILL(repo 밖) 계약을 바꿔 "발송 완료"를 별도 마킹해야 한다.
- ADR-0053이 burned month를 "월간·저손실이라 수용, 다음 달 자동 복구"로 **명시 결정**했다 → 지금 감지 대상에 넣으면 그 결정과 충돌.
- 기각(보류): 범위 초과. burned month가 실제로 발생하는지는 #466 회고 본체(8월 2회차 이후) 실측 후 판단. 재발 시 별도 이슈로 승격.

### B. 봇이 제안을 대신 생성·발송

- 장점: 완전 결정론적 출력 연속성.
- 단점: LLM 신호 생성 로직을 봇으로 이관 = P5b 발송 아키텍처(ADR-0040) 재설계, 범위 과대. ADR-0052 Alt B와 동일 이유.
- 기각.

### C. healthchecks.io dead-man 확장 (#577, ADR-0055)

- #577 heartbeat는 5분 주기 프로세스/DB liveness 감시(인프라 레이어). "월 1회 특정 비즈니스 routine이 그 달에 돌았나"와는 층위가 다르고, dead-man 주기(월 1회)로는 grace 설정이 부적합.
- 기각: 레이어 불일치. 직접 참조 모델은 `weeklyReviewFallback`(DB row 조회 + 알림)이 맞다. heartbeat는 보완 옵션일 뿐 drop-in 대상 아님.

### D. 감지 시각 — 1일 늦게 vs 2일

- 1일 늦은 시각(weekly 대칭, routine 09:30 + 몇 시간 뒤): routine 당일이라 앱 재시작 후 밀려 실행되는 케이스를 헛알림.
- **2일 채택**: 하루 유예로 밀림을 흡수. 이미 `#574` 게이트 task(매월 2일)와도 리듬이 맞음.

## Consequences

### 장점

- 그 달 routine이 아예 안 돈 경우(가장 흔한 조용한 실패)를 감지·알림 → 출력 연속성 확보(무증거 침묵 방지, 헌장 정합).
- `weeklyReviewFallback` 코드·마이그레이션(093) 패턴 그대로 재사용 → 온보딩 비용 낮음, 일관성.

### 단점 / 제약

- burned month(클레임 후 크래시)와 후보 0건 정상 종료는 감지하지 못함 — row 의미론상 테이블만으로 구분 불가. **명시적 스코프 한계**이며 ADR-0053의 수용 결정과 정합.
- 봇이 대신 발송하지 않으므로 누락 시 수동 재실행이 필요(연속성 보장은 "알림까지").
- 2일 11시 이후로 routine이 밀려 실행되는 극저확률 케이스는 헛알림 가능 — 사용자가 수동 실행해도 `signal_suggest_runs` UNIQUE로 중복 차단되어 무해.

### 후속 작업

- [ ] 마이그 104 `signalSuggestFallback` 슬롯 + prod 적용
- [ ] `src/cron/signal-suggest-fallback.ts` + `life-cron` SLOT_TASKS 등록
- [ ] 테스트 (2일 가드 / row 유무 분기)
- [ ] `docs/domains/insight.md` §45 본문
- [ ] (8월 회고 #466) burned month 실측 여부 확인 → 대안 A 재검토 트리거

---

**참고 자료**

- [ADR-0052](0052-weekly-insight-single-card-merge.md) — `weeklyReviewFallback`(발송 성공 기준, 알림만) 참조 모델
- [ADR-0053](0053-signal-suggest-idempotency.md) — `signal_suggest_runs` 최초-클레임 의미론 / burned month 수용
- [ADR-0040](0040-llm-signal-sql-validation-and-execution-isolation.md) — `monthly-signal-suggest` (P5b LLM 신호 제안)
