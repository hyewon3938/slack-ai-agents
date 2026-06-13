# 패턴 검증 재기준선 (re-baseline) 가이드

## 개요

검증 엔진의 **측정 로직이 바뀌면** 한 번 실행하는 1회성 운영 절차다. 확정(`confirmed`) 링크는 sticky라 정기 주간 검증이 재검정하지 않으므로(ADR-0034·ADR-0048), 측정 기준이 바뀐 뒤에도 옛 기준의 등급이 동결된다. 재기준선은 confirmed를 강등한 뒤 **새 측정 로직으로 전체를 한 번 강제 재검증**한다.

- 스크립트: `src/ops/rebaseline-pattern-links.ts` → 빌드 시 `dist/ops/rebaseline-pattern-links.js` (멱등 — 반복 실행해도 같은 종착 상태)
- 결정 근거: [ADR-0048](../adr/0048-enrollment-clip-and-rebaseline.md)

---

## 1. 언제 실행하나 (트리거)

다음 변경이 **머지·배포된 직후** 1회:

- `verifyUserLinks`의 윈도우 계산(데이터-존재 윈도우, enrollment 클립 등) 변경
- off-day 2×2 집계·effect·e-value·verdict 게이트 등 **측정/판정 로직** 변경
- 시드 활성/신호 시리즈 계산 방식 변경

> 측정과 무관한 변경(카드 카피, 노출 정책, 도메인 문서)은 재기준선 불필요.
> 측정 로직을 바꾸는 PR을 올릴 때 이 체크리스트를 PR 본문에 넣어 누락을 막는다.

---

## 2. 실행

### 2.1 사전 조건

스크립트는 `src/ops/`에 있어 앱과 함께 `dist/ops/`로 컴파일돼 **프로덕션 이미지에 포함**된다. 따라서 앱 컨테이너(`slack-ai-agents`) 안에서 `node`로 바로 실행한다 — 컨테이너가 이미 가진 env(`DATABASE_URL`·`SLACK_BOT_TOKEN`)와 DB 네트워크를 그대로 쓴다. 별도 터널·로컬 secret 불필요.

- **선행**: 측정 로직을 바꾼 PR이 **머지·배포 완료**(GitHub Actions Deploy → `dist`에 새 코드 반영)된 상태여야 한다. 배포 전 실행은 옛 코드로 재검증하는 셈이라 무의미.
- `SLACK_BOT_TOKEN`이 없으면 공지 카드만 생략하고 재검증은 진행한다.

### 2.2 명령

```bash
# 기본: 매핑된 전체 유저 (없으면 기본 유저)
ssh oracle-prod "docker exec slack-ai-agents node dist/ops/rebaseline-pattern-links.js"

# 특정 유저만
ssh oracle-prod "docker exec slack-ai-agents node dist/ops/rebaseline-pattern-links.js --user 1"
```

콘솔 요약: `강등 N · 재검증 M (persist M) · 재확정 K · reject R`.

> 로컬 개발 중 검증만 할 땐 `yarn tsx src/ops/rebaseline-pattern-links.ts`(로컬 `.env`의 DB 기준).

### 2.3 스킵하는 것 (의도)

스냅샷(`link_weekly_stats`)·교란 플래그·발굴·강도 컷은 **건너뛴다**. 비월요일 실행 시 `week_start` 시맨틱이 오염되는 것을 막기 위함 — 다음 월요일 정기 run이 자연 충전한다. 이 스크립트는 `pattern_links` 본체(counters·status·`test_detail`)만 갱신한다.

---

## 3. 검증 (DoD)

DB 접속 후(예: `docker exec slack-ai-agents-db psql ...`) 아래를 확인한다.

```sql
-- (a) 측정 아티팩트 위 확정이 강등됐는지 — 재기준선 직후 0 기대(같은 기준 재통과분만 남음)
SELECT count(*) FROM pattern_links WHERE status = 'confirmed';

-- (b) 발굴·제안(discovery/llm) 링크의 검정 윈도우가 등록 익일 이상으로 클립됐는지
SELECT id, source,
       (created_at AT TIME ZONE 'Asia/Seoul')::date AS created_kst,
       test_detail->>'window_start'                AS window_start
  FROM pattern_links
 WHERE source IN ('discovery', 'llm') AND status = 'active'
 ORDER BY id;
-- 기대: window_start >= created_kst + 1

-- (c) 강등 후 같은 기준에서 재확정되지 못한 링크(측정 아티팩트로 떴던 확정)가
--     검증 중(insufficient/active)으로 내려갔는지 — nActive·verdict 확인
SELECT id, status,
       test_detail->>'verdict'  AS verdict,
       test_detail->>'n_active' AS n_active
  FROM pattern_links
 WHERE status = 'active'
 ORDER BY (test_detail->>'n_active')::int DESC NULLS LAST;
```

- [ ] (a) `confirmed` 수가 기대대로(재기준선 직후 0, 또는 같은 기준 재통과분만)
- [ ] (b) discovery/llm 링크 `window_start` ≥ 등록 익일
- [ ] (c) 이전 확정이 새 기준에서 검증 중으로 내려감(`n_active` < 확정 임계)
- [ ] `#insight` 정직 공지 카드 수신

---

## 4. 사후 — README·explainer 수치 갱신

재기준선으로 등급이 바뀌면 공개 수치가 어긋난다. 아래를 **실측값**으로 갱신한다(별도 docs 커밋).

### 4.1 실측 수치 뽑기

```sql
-- 풀 게이트(q+effect+nActive+e) 통과 = verified(confirmed) 수
SELECT count(*) FROM pattern_links WHERE status = 'confirmed';

-- e-value 임계(20) 이상 링크 수 (게이트 전부 통과와 구분해서 표기)
SELECT count(*) FROM pattern_links WHERE e_value >= 20;
```

### 4.2 갱신 대상

- [ ] `README.md` "검증 결과 — n=1 실증 현황" 섹션 — **풀 게이트 통과 수와 e≥20 수를 구분** 표기(둘을 합쳐 과대표현 금지)
- [ ] insight explainer(`insight-v2`, `insight-v2-saju`) 내 검증 현황 수치
- [ ] 갱신은 라벨 없이 **건수 수준**으로만(공개 텍스트 보안 — 특정 패턴 라벨·q/e 수치 금지)

---

## 5. 멱등성·안전

- 두 번째 실행은 강등 0(이미 active) → 같은 재검증 → 같은 종착 상태. 공지 카드는 매 실행 발송되므로 **운영자가 1회만 실행**한다.
- 강등은 비가역이 아니다 — 같은 게이트를 통과하는 링크는 재검증에서 자동으로 다시 `confirmed`가 된다.
- per-link UPDATE는 격리돼 한 링크 실패가 전체를 막지 않는다(콘솔 에러 로그 확인).
