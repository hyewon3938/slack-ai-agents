# API 비용 최적화 기록

> PR #262 (Issue #261) — 2026-04-13

## 배경

월 API 비용이 $30\~35 수준으로 증가. 주요 원인 분석:

- 프롬프트 캐싱 미적용 → 동일한 시스템 프롬프트(\~3,500 토큰)에 매 호출마다 풀 비용
- Insight 채널 일기 기록이 매번 LLM 에이전트 루프 (1\~3회 호출)
- Life 크론이 아침/저녁 각 1회 LLM 호출 + 불필요한 중간 알림 슬롯 다수

**목표**: 월 $20 이하

---

## 적용한 최적화 3가지

### 1. Anthropic 프롬프트 캐싱 활성화

**파일**: `src/shared/llm.ts`

```typescript
// Before: system을 문자열로 전달 → 매 호출 풀 비용
system: system ?? undefined,

// After: TextBlockParam 배열 + cache_control
const systemBlocks: TextBlockParam[] | undefined = system
  ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  : undefined;
```

도구 정의에도 동일하게 마지막 Tool에 `cache_control` 추가.

**효과**: 캐시 히트 시 토큰 비용 90% 절감. TTL 5분. 5분 이내 재호출(대화 연속, 툴 루프)에서 효과 극대화.

**주의**: SDK 0.78.x에서 `cache_control`은 `Tool` / `TextBlockParam` 타입에 이미 포함됨 (stable API). 별도 베타 헤더 불필요.

---

### 2. Insight 일기 fast path

**파일**: `src/agents/insight/diary-fast-path.ts`, `src/agents/insight/index.ts`

**변경 전**: 모든 Insight 메시지 → LLM 에이전트 루프 (내용 해석 + SQL INSERT, 1\~3회 호출)

**변경 후**:
```
메시지 수신
  → 운세 fast path 체크 (일운/월운/세운/대운)
  → 명령 패턴 체크 (INSIGHT_COMMAND_RE: 테마/프로필/패턴/분석 등)
  → 위 두 조건 모두 미해당 → 일기로 간주, LLM 없이 직접 DB 저장
```

확인 문구 20종 사전 정의, 최근 5개 중복 방지 랜덤 선택.

**밤 크론 변경**: `insightNightTask`
- 오늘 일기가 있으면 → LLM 1회로 하루 리뷰 코멘트
- 없으면 → 간단 리마인더 텍스트 (LLM 없음)

**효과**: 일기 1건당 1\~3 LLM 호출 → 0 LLM 호출. 하루 일기 3건 기준 3\~9회 → 1회.

---

### 3. Life 크론 슬롯 정리

**파일**: `src/cron/life-cron.ts`

| 슬롯 | 변경 전 | 변경 후 |
|------|--------|--------|
| sleepCheck | 수면 기록 알림 (LLM X) | **제거** |
| morningSchedule | 일정 텍스트 알림 (LLM X) | **morning으로 통합** |
| morning | LLM 인사 + 루틴 체크리스트 | **LLM 제거** → 일정 + 루틴 체크리스트만 |
| night | 루틴 요약 + LLM 마무리 | 일정 리뷰 통합, LLM 유지 |
| nightReview | 미완료 일정 + 수면 확인 (LLM X) | **night으로 통합** |
| insightMorning | 일운 알림 (LLM X) | 유지 |
| insightNight | 일기 리마인더 (LLM X) | LLM 추가 (일기 있을 때만) |

**효과**: 일별 크론 LLM 호출 2회 → 1\~2회 (밤 크론 1회 + 인사이트 밤 0\~1회)

---

## 비용 비교

| 항목 | 변경 전 | 변경 후 |
|------|--------|--------|
| 아침 크론 | Sonnet 1회/일 | 0회 |
| 밤 크론 | Sonnet 1회/일 | 1회 (캐싱 적용) |
| 인사이트 밤 | 0회 | 0\~1회 (일기 있을 때만) |
| 일기 저장 | Sonnet 1\~3회/건 | 0회 |
| 대화 (Life) | 프롬프트 풀 비용 | 캐시 히트 90% 절감 |
| **예상 일 비용** | **\~\$1.0\~1.1** | **\~\$0.5\~0.7** |
| **예상 월 비용** | **\~\$30\~35** | **\~\$15\~21** |

---

## DB 조치 (배포 후)

제거된 슬롯을 비활성화:

```sql
UPDATE notification_settings SET active = false
WHERE slot_name IN ('sleepCheck', 'morningSchedule', 'nightReview');
```

> 행 삭제 대신 `active = false` 처리 — 크론 스케줄러는 active=true인 슬롯만 등록하므로 안전.

---

## 추가 절감 여지 (미적용)

| 방법 | 예상 절감 | 이유 미적용 |
|------|---------|-----------|
| Life fast path 확장 (루틴/수면 조회 정규식 추가) | 10\~15% | 수면 기록/리마인더 대화는 복잡도 높아 LLM 필요 |
| 시스템 프롬프트 동적 스키마 주입 | 10% | 리팩토링 범위 큼 |
