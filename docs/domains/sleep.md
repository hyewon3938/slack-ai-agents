# 수면 (Sleep)

> Slack 채널: #life (life 에이전트) · 웹: /life/sleep
> 마스터 #588에서 도메인 문서 신설. 이전에는 도메인 문서 없이 운영 (insight.md에 신호 소스로만 산발 언급).

## DB 스키마

```sql
-- 수면 기록 (밤잠·낮잠 공용, 분할 수면은 같은 date에 night 레코드 N개)
sleep_records:
  id SERIAL PK,
  user_id INTEGER REFERENCES users(id),
  date DATE NOT NULL,            -- 기록 기준일 (보통 일어난 날)
  bedtime TEXT,                  -- 'HH:MM', nullable (메모 전용 레코드 허용)
  wake_time TEXT,                -- 'HH:MM', nullable
  duration_minutes INTEGER,      -- nullable
  sleep_type TEXT NOT NULL DEFAULT 'night',  -- 'night' | 'nap'
  memo TEXT,                     -- 자유 메모 (통계 비노출, 사람용)
  tags TEXT[] NOT NULL DEFAULT '{}',  -- 특이사항 고정 어휘 (마이그 105) — 통계 연계용
  created_at TIMESTAMPTZ
  -- UNIQUE (user_id, date, sleep_type, bedtime) WHERE bedtime IS NOT NULL (마이그 040)

-- 중간기상 이벤트 (짧은 각성. 긴 각성은 sleep_records 세그먼트 분리로 기록)
sleep_events:
  id SERIAL PK,
  user_id INTEGER REFERENCES users(id),  -- 마이그 105 추가 (nullable, NOT NULL 승격은 Phase 2)
  date DATE NOT NULL,
  event_time TEXT NOT NULL,      -- 'HH:MM'
  memo TEXT,
  created_at TIMESTAMPTZ
```

### 데이터 의미론 (핵심)

- **밤잠 = 같은 date의 night 레코드 집합(세그먼트)**. 수면 중 10분 이상 깬 경우 기록을 끊어 두 세그먼트로 저장하는 관행. 시작 = 첫 세그먼트 취침, 종료 = 마지막 세그먼트 취침 + duration, 세그먼트 갭 = 수면 중 각성(WASO).
- **아침잠**(nap, bedtime < 12:00)은 밤잠 총량에 합산. **오후 낮잠**(nap, bedtime ≥ 12:00)은 별도 집계.
- 시각 정렬은 20:00 경계 래핑(20:00 이후 = 음수 분) — 자정 전후가 연속으로 이어지게.
- memo는 자유텍스트(사람용), tags는 고정 어휘(통계용) — 태그 어휘: 악몽·화장실·뒤척임·카페인·음주·야식·스트레스·소음·통증·온도 (확장은 마이그레이션).

## 수면 점수 (ADR-0059)

4축 + 종합, 0\~100, 결정론 파생 계산 (DB 저장 없음). 목표·가중치는 `web/src/features/sleep/lib/sleep-score-config.ts` 상수.

| 축 | 측정 | 기본 상수 |
|---|---|---|
| 시간 | 총 수면시간의 목표 구간 충족 | 목표 420\~540분, 이탈 180분 = 0점 |
| 규칙성 | 취침·기상 stddev (각각 점수 후 평균) | stddev 120분 = 0점 |
| 연속성 | 밤당 분절 수 (중간기상 + 세그먼트 갭) | 평균 3회 = 0점 |
| 타이밍 | 첫 취침의 목표 시각 대비 지각 | 목표 00:00, 지각 180분 = 0점 |

종합 = 가중 평균 (시간 0.35 / 규칙성 0.25 / 연속성 0.20 / 타이밍 0.20).

계산 모듈은 `web/src/features/sleep/lib/sleep-score-config.ts`(목표·경계·가중치 상수)와 `scores.ts`(`calculateSleepScores(dailies) => SleepScores | null`, 밤잠 데이터 0건이면 null)로 분리. 표본이 2일 미만이면 규칙성 축을 제외하고 나머지 축 가중치를 재정규화한다.

파생 지표(추가 기록 없이 세그먼트 합성에서 파생):

- **수면 효율**: Σ세그먼트 수면시간 ÷ 누운 시간(첫 취침\~마지막 기상)
- **WASO**: 세그먼트 사이 갭의 합 (수면 중 각성)
- **분절 수**: 중간기상 이벤트 수 + 세그먼트 갭 수

점수는 대시보드 API 응답에서 매 요청 파생 계산 — DB에 저장하지 않는다.

## 입력 경로

### Slack 자연어 (#life)

fast path 없음 — life 에이전트 LLM이 `modify_db`로 직접 INSERT/UPDATE. 규칙은 `src/agents/life/prompt.ts` "수면 기록" 섹션.

> TODO(`/build` Phase 2): 명시 날짜 소급 기록·낮잠/밤잠 판정(명시어 → 휴리스틱 → 확인 질문)·세그먼트 기록·태그 기록 규칙 확정 후 본문 기술

### 웹 대시보드

> TODO(`/build` Phase 3): CRUD 폼·API route 구현 후 기술 (현재 조회 전용)

## 웹 대시보드 구조

- `/life/sleep` — 기간(1w/2w/1m) 선택, 요약 카드(점수+통계), 타임라인(세그먼트 렌더), 추세 차트, 낮잠 타임라인, 요일 패턴
- 데이터 흐름: `use-sleep-dashboard` → `GET /api/sleep/dashboard` → `features/sleep/lib/queries.ts` → DB proxy
- 생활 탭 첫 진입은 루틴(`/life/routine`), 하위 탭 순서 루틴 → 수면 (Phase 1)
- 카드 구성: `SleepScoreCard`(종합점수 반원 게이지 + 4축 미니바, 신규) · `SleepSummaryCards`(규칙성 카드를 수면 효율·각성 카드로 교체, 나머지 통계 유지) · `SleepTimeline`(세그먼트별 분리 렌더). 미사용 `sleep-dashboard.tsx`(page.tsx와 중복)는 제거됨

## 통계 시스템 연계 (#477 패턴 검증)

- 신호(signal_defs, domain='sleep'): sleep_nap_count · sleep_total_minutes · sleep_night_minutes · sleep_wake_hour (기존)
- 트리거 시드: threshold(sleep_minutes ≤ 6/7/8h), behavior_baseline(sleepTrend·drift)
- 점수/신호는 전부 원본 재계산 — 일별 저장 없음 (마이그 078 철학)

> TODO(`/build` Phase 2): 신호 확장(중간기상 횟수·취침 시각 등) 등록 후 목록 갱신

## 크론 접점

- 아침(09:01)·밤(23:55) 잔소리: `detectSleepTrend`(3일 추세), 자정 취침 연속 일수
- 주간 리포트(월 09:00): 평균/최고/최저 수면, 루틴 완료율 상관
- Phase 4 검증 엔진·발굴 엔진: 수면 신호를 off-day 대조로 소비
