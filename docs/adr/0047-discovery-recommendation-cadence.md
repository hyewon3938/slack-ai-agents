# 0047. 발굴 후보 재추천 — 데일리 반응형 cadence (전용 슬롯 + 파생 상태, 묶음 전부 패스 시 다음 best)

- Status: Accepted
- Date: 2026-06-08
- Related: [#512](https://github.com/hyewon3938/slack-ai-agents/issues/512), [#504](https://github.com/hyewon3938/slack-ai-agents/issues/504), [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md)(발굴 surface + 사람 게이트 — 본 ADR이 cadence를 연장), [ADR-0045](0045-card-label-layer.md)(런타임 코드 vs DB 컬럼 — 파생-무테이블 선례), [ADR-0032](0032-metric-first-verification-statistics.md) §2(발견 q 느슨/확정 q 엄격)
- Tags: insight, architecture, process

## Context

발굴 엔진([ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md))은 주간 검증 cron(월요일 06:00, `weekly-verification.ts` `surfaceDiscoveries`) 직후 **1회만** 링크 없는 (시드×신호) 여집합을 스캔해 발견 q·top-N(5)을 통과한 후보를 pending 링크로 surface한다. 사람이 [추적 시작]/[패스]로 노출을 게이트한다(노출·큐레이션 vs 믿음 분리).

문제: 사용자가 그 묶음을 **전부 [패스]**하면 — 여집합에 아직 검정할 만한 다음 best 쌍이 남아있어도 — **다음 주 월요일까지 새 후보가 안 뜬다**. evidence-only 결정론 시드(강도 밴드·관계·효과적 십성, P4a·P4b)가 검증 트랙에 닿는 속도가 주1회 묶음에 묶인다. ADR-0039 §2가 이미 "pending 누적은 **주당 surface 상한** + 발굴 노브로 관리"라고 적어둔 그 상한을 활용하면, 같은 주에 다음 묶음을 띄울 여지가 있다.

핵심 통찰: `discoverCandidates`의 여집합은 `pattern_links`에 (어떤 status로도) **없는** 쌍만 본다. 한 번 surface된 쌍은 pending(미응답)·archived(패스)·active(승인) 어느 쪽이든 여집합에서 빠진다. 따라서 **발굴을 재실행하기만 하면 자동으로 "다음 best"가 나온다** — 별도 커서·페이징·라운드 상태가 필요 없다.

남은 설계 질문은 셋이다: (1) 언제 재실행을 트리거하나, (2) "이번 묶음을 전부 패스했다"를 어떻게 판정하고 라운드/상한을 어디에 기록하나, (3) 어디까지 재추천하고 멈추나.

## Decision

발굴 재추천을 **데일리 반응형 백그라운드 cadence**로 추가한다. 통계·verdict·tier·승인 게이트·카드 빌더는 **일절 불변** — 발굴 *재실행 시점*만 늘린다.

### 1. 트리거 = 전용 데일리 슬롯 (동기 클릭 X, 매칭 cron 합류 X)

새 cron 슬롯 `discoveryRecommend`(`notification_settings`, 기본 07:30 KST)를 신설한다. 슬롯 태스크는 유저별로 **싼 예측(predicate) 쿼리 1방을 먼저** 돌리고, 통과할 때만 무거운 `discoverCandidates` 재실행으로 넘어간다.

- **동기 버튼 클릭이 아니다** — 마지막 카드 [패스] 시점에 재실행하면 풀 여집합 스캔(시드·신호 시리즈 전부 재계산)이 버튼 ack를 지연시킨다. 데일리 틱으로 비동기화.
- **07:00 매칭 cron(`dailyPatternMatchingTask`)에 합류하지 않는다** — 그 cron은 "오늘 발현 시드만 조용히 기록(Slack 발송 없음)"이라는 단일 책임이고, 재추천은 데이터 의존이 없다(`discoverCandidates`는 자체 데이터-존재 윈도우로 시드 활성 시리즈를 처음부터 재계산, 오늘의 `seed_daily_activations`를 안 읽음). 전용 슬롯이 발송 시각·on/off를 독립 튜닝하게 하고 매칭 cron의 단일 책임을 보존한다.
- 월요일 발굴(`surfaceDiscoveries`)과 데일리 재추천은 **공유 함수 `recommendDiscoveries(app, userId, channelId, today)`**(발굴 → pending 링크 INSERT → 카드 발송)를 같이 호출한다 — cron 레벨이 아니라 함수 레벨에서 DRY. 데일리 슬롯은 그 앞에 예측 게이트만 얹는다.

### 2. 상태 = `pattern_links`에서 파생 (새 테이블 없음)

라운드 카운터 테이블을 만들지 않는다. "이번 주 묶음"은 `pattern_links`에서 파생한다 — `source='discovery' AND created_at >= 이번주_월요일(KST 00:00)`. `created_at`(077, `DEFAULT NOW()`)·`status`로 충분하다([ADR-0045](0045-card-label-layer.md) A안 정신: 파생 가능하면 DB 구조를 안 늘린다).

예측 쿼리 1방:

```sql
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'archived') AS archived
  FROM pattern_links
 WHERE user_id = $1 AND source = 'discovery'
   AND created_at >= $2  -- 이번주 월요일 00:00 KST
```

- **라운드 cap을 "주당 카드수 cap"으로 표현** → 별도 카운터 불필요. `total`이 곧 이번 주 누적 surface 수.
- 매주 `created_at` 스코프가 바뀌어 **자동 리셋**(별도 리셋 job 없음). archived는 여집합 영구제외라 지난 패스 후보가 재부상하지 않는다([ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md) §1).

### 3. 발사 조건 + 정지 규칙

```
발사:  total > 0  AND  archived == total  AND  total < weeklyDiscoveryCap
       → recommendDiscoveries 재실행 (여집합이 archived 자동제외 → 다음 best)

안 쏨:
  total == 0            → 이번주 묶음 없음(월요일 소진/발굴0) = 자연 소진(1차 정지)
  pending 남음(archived<total, active 없음)  → 무응답 = 보류 (다 볼 때까지 대기)
  active(=승인) 존재     → 일부 승인 = 그 주 정지
  total >= weeklyDiscoveryCap            → 백스톱 가드(2차 정지)
```

- **`archived == total`** 단일 조건이 "무응답 보류"(pending 남으면 archived<total)와 "일부 승인 정지"(active 있으면 archived<total)를 동시에 표현한다. 이번 주 묶음이 *전부 패스됐을 때만* 발사.
- **자연 소진이 1차** — `discoverCandidates`가 빈 배열이면 surface 0, 다음 틱도 `total` 불변이라 조용히 멈춘다.
- **`weeklyDiscoveryCap = 20`**(월 5 + 재추천 3라운드 × 5)은 폭주 방지 백스톱이지 1차 메커니즘이 아니다. 느슨한 `discoverQ=0.15`에서 한계 후보가 매일 올라와 카드 피로를 유발하는 병적 케이스만 막는다. 헌장 ⑤ 튜닝 노브([insight-thresholds.ts](../../src/shared/insight-thresholds.ts) `patternVerification`).
- 데일리 틱(1일 1회) + "전부 패스해야 발사"라 **라운드 사이 최소 1일** — 추가 페이스 게이트 불필요.

## Alternatives considered

### A. 동기 버튼 클릭 트리거 (마지막 [패스]에서 재실행)

- 장점: 즉각적 — 다 보면 바로 다음 묶음.
- 단점: `discoverCandidates`가 전 시드·신호 시리즈를 재계산(검증보다 무거움, ADR-0039 단점)이라 버튼 ack 경로에 부적합. 동시 클릭/중복 발사 레이스.
- 기각: 데일리 틱으로 비동기화. "무거운 재실행"은 헌장에도 명시된 비용이라 백그라운드가 맞다.

### B. 라운드 카운터 테이블 (`discovery_rounds(user_id, week_start, round)`)

- 장점: 라운드 개념을 명시적으로 기록.
- 단점: surface가 이미 pending 링크를 만들고 `created_at`·`status`가 라운드/상한을 전부 파생 가능 → 테이블은 중복 상태. 마이그·백필·동기화 부담.
- 기각: [ADR-0045](0045-card-label-layer.md) A안 선례(파생 가능하면 DB 미변경). cap을 "주당 카드수"로 표현하면 COUNT 1방으로 충분.

### C. 07:00 매칭 cron(`dailyPatternMatchingTask`) 합류

- 장점: 새 슬롯 없음(Life Cron 7 유지), 기존 유저 루프 재사용.
- 단점: 그 cron은 "발송 없음(오늘 발현 시드만 기록)" 단일 책임 — 카드 발송 능력을 재배선하면 책임이 흐려진다. 재추천은 매칭과 **데이터 의존이 없어** 결합 근거도 없다.
- 기각: 전용 슬롯이 단일 책임 보존 + 시각·on/off 독립 튜닝. 슬롯 1개는 죽은 슬롯(#508이 정리한 분포 리뷰)이 아니라 실제 새 기능이라 7→8은 churn이 아니라 정직한 증가.

### D. 자동 활성 (게이트 없이 다음 묶음을 자동 추적)

- 장점: 마찰 0.
- 단점: 미검증 연관이 emerging tier로 조기 노출 — [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md) §3 노출·믿음 분리 위반.
- 기각. 재추천은 *노출 cadence*만 바꾸지 사람 게이트를 우회하지 않는다.

### E. 주당 cap 없이 소진까지 무제한

- 장점: 더 공격적인 발견.
- 단점: 느슨한 `discoverQ`에서 한계 후보가 매일 올라와 카드 피로 → 큐레이션 게이트(#504 원칙 #2) 신호 저하.
- 기각: cap 백스톱 유지(소진이 1차, cap은 2차). 값은 튜닝 노브.

### F. (선택) 전용 데일리 슬롯 + 파생-무테이블 + 예측 게이트 — Decision 참조

- 장점: 새 테이블·통계코어·카드 0. 여집합 자동제외로 재실행=공짜. 싼 예측이 풀스캔을 firing 시로 제한.
- 단점: firing 시 데일리에 발굴 풀스캔(주1→최대 주3 추가). n=1·예측 게이트라 수용.

## Consequences

### 장점

- evidence-only 시드가 검증 트랙에 닿는 속도 가속 — 한 주에 최대 4묶음(월 1 + 재추천 3)까지, 사용자가 적극 큐레이션하는 만큼만.
- 새 테이블·통계 코어·카드 빌더 0. 통계·verdict·tier·승인 게이트 전부 불변.
- 여집합 자동제외 덕에 "다음 best"가 재실행만으로 공짜(커서·페이징 없음).
- 싼 예측 쿼리(COUNT 1방)가 거의 매일 false → 무거운 `discoverCandidates`는 실제 발사 때만.
- 매주 `created_at` 스코프 자동 리셋, archived 영구제외로 지난 후보 재부상 없음.

### 단점 / 제약

- 발굴 풀스캔이 firing 시 데일리에 실행(주1→최대 주3 추가). n=1·주간·예측 게이트라 수용 — 배칭 최적화는 후속(ADR-0039 단점 승계).
- **일부 승인 시 그 주 정지**라, 한 묶음에서 1개 [추적 시작]+나머지 [패스]하면 남은 여집합은 다음 주 월요일까지 대기(의도된 보수성 — 추적할 게 생긴 주엔 카드 안 늘림).
- `weeklyDiscoveryCap`·슬롯 시각은 calibration 노브 — 첫 몇 주 튜닝(헌장 ⑤).

### 후속 작업

- [ ] 공유 `recommendDiscoveries` 추출(`weekly-verification.ts` `surfaceDiscoveries` → 공용) + 데일리 슬롯 태스크(예측 게이트 → 재실행) + `SLOT_TASKS` 등록 + 마이그(`discoveryRecommend` 슬롯 INSERT).
- [ ] `weeklyDiscoveryCap`(=20) 노브 추가 + 이번주 월요일(KST) 경계 헬퍼.
- [ ] cap·시각 calibration(운영 1\~2주). 필요 시 재추천 카드에 "지난 후보 다 봤으니 다음 후보야" 맥락 노트.

---

**참고 자료**

- [ADR-0039](0039-pattern-discovery-surface-and-approval-gate.md) §2(주당 surface 상한으로 pending 누적 관리), §3(노출·믿음 분리)
- [ADR-0045](0045-card-label-layer.md)(파생 가능하면 DB 구조 미변경 — A안)
