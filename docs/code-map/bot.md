# 봇 코드

<!-- 자동 생성 파일. 직접 고치지 않는다. 코드를 바꾼 뒤 `yarn code-map`으로 다시 만든다. -->

> 자동 생성 파일이다. 직접 고치지 말고 `yarn code-map`으로 다시 만든다.

`src/` 아래 소스 파일 191개, 21961줄이고 테스트 파일은 83개다. 줄 수는 테스트를 뺀 값이다.
역할 칸에는 파일 맨 위 주석의 첫 문장을 옮겼고, 주석이 없는 파일은 비워 뒀다. export 칸의 function에는 화살표 함수로 선언한 const도 들어간다.

## `src`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `app.ts` | 109 |  |  |
| `db-proxy.ts` | 235 |  | function: `handleRequest`, `startDBProxy` |
| `router.ts` | 56 |  | function: `registerAgent`, `registerMessageHandler`<br>type: `AgentHandler` |

테스트 파일 2개

## `src/agents/insight`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `action-transitions.ts` | 124 | Insight 액션의 status 전이 코어 — Slack 호출 없이 DB만 바꾼다 (테스트 가능 코어). | function: `approveDiscoveryLink`, `dismissDiscoveryLink`, `approveLlmSignal`, `rejectLlmSignal` |
| `actions.ts` | 203 | Insight 에이전트 Slack 액션 핸들러. | function: `extractMessageBlocks`, `registerInsightActions` |
| `diary-edit-actions.ts` | 202 | Insight 에이전트 — Slack 일기 조회·수정 핸들러 (#639). | function: `showDiary`, `validateDiaryEditDate`, `formatDiaryEditConfirmation`, `registerDiaryEditActions` |
| `diary-edit-meta.ts` | 49 | Insight 에이전트 — Slack 일기 수정 (#639). | function: `hashDiaryContent`, `encodeDiaryEditMeta`, `decodeDiaryEditMeta`<br>type: `DiaryEditMeta` |
| `diary-edit-parts.ts` | 85 | Insight 에이전트 — Slack 일기 수정 (#639). | function: `splitDiaryContent`, `joinDiaryParts`<br>const: `SLACK_TEXT_MAX`<br>type: `PartJoin`, `DiaryParts` |
| `diary-edit-store.ts` | 159 | Insight 에이전트 — Slack 일기 수정 저장 (#639). | function: `findDiaryEntryByDate`, `findDiaryEntryById`, `applyDiaryEdit`<br>type: `DiaryEntryRow`, `DiaryEditInput`, `DiaryEditAction`, `DiaryEditResult` |
| `diary-edit.ts` | 173 | Insight 에이전트 — Slack 일기 수정 (#639). | function: `parseDiaryLookup`, `buildDiaryLookupBlocks`, `buildDiaryEditModal`, `buildDiaryNotFoundModal`, `readDiaryEditSubmission`<br>const: `DIARY_EDIT_ACTION_ID`, `DIARY_EDIT_VIEW_ID`, `DIARY_DATE_BLOCK_ID`, `DIARY_PART_BLOCK_PREFIX`<br>type: `DiaryLookupParse`, `DiaryEditSubmission` |
| `diary-fast-path.ts` | 161 | Insight 에이전트 — 일기 fast path. | function: `naturalDelay`, `pickDiaryConfirmation`, `resolveDiaryDate`, `parseDatedDiary`, `formatDiaryDateLabel`, `formatDatedConfirmation`, `backfillDiaryMetaTags`, `saveDiaryEntry`<br>type: `DatedDiaryParse` |
| `fortune-fast-path.ts` | 124 | Insight 에이전트 — 운세 조회 fast path. | function: `tryPeriodInterpretationFastPath`, `tryFortuneFastPath` |
| `hypothesis-cards.ts` | 150 | 인사이트 Block Kit 카드 빌더 — P5a 발굴 승인 카드(ADR-0039) + 재기준선 공지(#523 P0, ADR-0048). | function: `encodeDiscoveryPayload`, `decodeDiscoveryPayload`, `buildDiscoveryCandidateCard`, `buildRebaselineNotice`<br>const: `DISCOVERY_APPROVE_ACTION_ID`, `DISCOVERY_DISMISS_ACTION_ID`<br>type: `DiscoveryCardPayload`, `DiscoveryCardInput`, `RebaselineSummary` |
| `hypothesis-discovery-load.ts` | 36 | 패턴 발굴 엔진의 입력 로딩 — active 신호 정의·이미 링크된 (시드, 신호) 쌍. | function: `loadActiveSignals`, `loadLinkedPairs`<br>type: `LoadedSignal` |
| `hypothesis-discovery-persist.ts` | 66 | 패턴 발굴 후보의 pending 링크 쓰기 (#477 P5a, ADR-0039 §3). | function: `insertPendingDiscoveryLink` |
| `hypothesis-discovery-rank.ts` | 65 | 패턴 발굴 엔진 후보 단계 — 생존 쌍을 카드·pending 링크용 후보로 바꾸고 top-N으로 자른다 (#477 P5a, ADR-0039). | function: `toDiscoveryCandidate`, `rankTopN` |
| `hypothesis-discovery-scan.ts` | 167 | 패턴 발굴 엔진 스캔 단계 — 여집합 (시드 × 신호) 쌍의 off-day 2×2 + 효과크기 사전선별 (#477 P5a, ADR-0039). | function: `scanSurvivors` |
| `hypothesis-discovery-types.ts` | 55 | 패턴 발굴 엔진 타입 — 발굴 후보(카드·pending 링크용)와 사전선별 생존 쌍 (#477 P5a, ADR-0039). | type: `DiscoveryCandidate`, `Survivor` |
| `hypothesis-discovery.ts` | 104 | 패턴 발굴 엔진 — 링크 없는 (시드 × 신호) 여집합을 off-day 대조로 스캔 (#477 P5a, ADR-0039). | function: `discoverCandidates` |
| `index.ts` | 169 |  | function: `createInsightAgent` |
| `llm-signal-cards.ts` | 97 | LLM 자율 신호 제안 승인 카드 — #477 P5b (ADR-0040, P5a 승인 게이트 재사용). | function: `encodeLlmSignalPayload`, `decodeLlmSignalPayload`, `buildLlmSignalCard`, `buildNoSignalSuggestionMessage`<br>const: `LLM_SIGNAL_APPROVE_ACTION_ID`, `LLM_SIGNAL_REJECT_ACTION_ID`<br>type: `LlmSignalPayload`, `LlmSignalCardInput` |
| `pattern-seed-fast-path.ts` | 108 | 사주 시드 토글 fast path. | function: `tryPatternSeedFastPath`<br>const: `SAJU_SEED_LIST_RE`, `SAJU_SEED_LIST_ALL_RE`, `SAJU_SEED_OFF_RE`, `SAJU_SEED_ON_RE` |

테스트 파일 10개

## `src/agents/life`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `action-shared.ts` | 18 | Life Agent 액션 핸들러 공용 — 핸들러 인자 타입, Slack body → userId 해석. | function: `resolveBodyUserId`<br>type: `ActionArgs` |
| `actions.ts` | 153 | v2 Life Agent 인터랙티브 버튼 핸들러. | function: `registerLifeActions` |
| `confirm-modify-actions.ts` | 157 | Life Agent modify_db 확인 플로우 버튼 핸들러 (실행·취소). | function: `handleConfirmModifyExecute`, `handleConfirmModifyCancel` |
| `home.ts` | 118 | Slack App Home 탭 — 오늘의 일정, 루틴, 수면 대시보드. | function: `publishHomeView`, `registerHomeTab` |
| `index.ts` | 135 |  | function: `createLifeAgent` |
| `prompt-sections.ts` | 248 |  | function: `buildIntroSection`, `buildUserIdFilterSection`, `buildScheduleQuerySection`, `buildScheduleInsertSection`, `buildScheduleRulesSection`, `buildSleepModifySection`, `buildDataRulesSection`, `buildAnalysisSection`<br>const: `NAG_GUIDE_SECTION`, `CONVERSATION_SECTION`, `DB_SCHEMA_SECTION`, `SCHEDULE_FORMAT_SECTION`, `SLEEP_RECORD_SECTION`, `REMINDER_SECTION`, `CUSTOM_INSTRUCTION_SECTION` |
| `prompt.ts` | 102 |  | function: `buildLifeSystemPrompt` |

테스트 파일 5개

## `src/agents/life/blocks`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `confirm-modify.ts` | 79 | 대량 변경 확인 카드 블록. | function: `buildConfirmModifyCard` |
| `constants.ts` | 18 | Life Agent Block Kit 공용 상수 (action id, 표시 한도, 시간대 순서). | const: `ROUTINE_ACTION_ID`, `SCHEDULE_ACTION_ID`, `POSTPONE_ACTION`, `DELETE_ACTION`, `TOGGLE_IMPORTANT_ACTION`, `MOVE_TO_TODAY_ACTION`, `CONFIRM_MODIFY_EXECUTE_ACTION_ID`, `CONFIRM_MODIFY_CANCEL_ACTION_ID`, `CONFIRM_ROW_LIMIT`, `TIME_SLOT_ORDER` |
| `greeting.ts` | 12 | 아침 인사 블록. | function: `buildMorningGreetingBlocks` |
| `routine.ts` | 139 | 루틴 체크리스트 블록과 버튼 value 인코딩/파싱. | function: `parseButtonValue`, `buildRoutineBlocks`, `buildFilteredRoutineBlocks`<br>type: `SlotFilter` |
| `schedule-format.ts` | 81 | 일정 표시 공용 헬퍼: 카테고리 그룹핑 · 제목 포맷. | function: `groupByCategory`, `isEventType`, `formatScheduleTitle` |
| `schedule-overflow.ts` | 94 | 일정 overflow 메뉴 value 인코딩/파싱과 옵션 조립. | function: `encodeOverflowValue`, `parseOverflowValue`, `buildOverflowOptions`, `buildEventOverflowOptions`, `buildBacklogOverflowOptions` |
| `schedule-text.ts` | 78 | 일정 텍스트 메시지 (크론 알림용). | function: `buildScheduleText`, `buildNightScheduleText`, `buildYesterdayIncompleteText` |
| `schedule.ts` | 157 | 일정 목록 블록과 텍스트 폴백. | function: `formatSchedulesAsText`, `buildScheduleBlocks` |
| `sleep.ts` | 65 | 수면 요약 블록. | function: `buildSleepBlocks` |

테스트 파일 1개

## `src/cron`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `daily-pattern-matching.ts` | 52 | 매일 07시 패턴 일일 매칭 cron (08:03 일일 종합 인사이트 선행, #475 ADR-0031). | function: `dailyPatternMatchingTask` |
| `diary-meta-extract.ts` | 207 | 일기 → 메타 태그 LLM 추출 cron. | function: `parseTagResponse`, `extractDiaryTags`, `extractAndPersistForUser`, `diaryMetaExtractTask`<br>const: `DIARY_META_TAGS`<br>type: `DiaryMetaTag`, `DiaryMetaExtractResult` |
| `discovery-recommend.ts` | 96 | 발굴 후보 재추천 — 묶음 전부 패스 시 다음 best 묶음을 데일리 틱으로 surface (#504 P3, ADR-0047). | function: `recommendDiscoveries`, `decideReRecommend`, `discoveryRecommendTask` |
| `insight-user-loop.ts` | 82 | #insight 채널 크론 공통 유저 루프. | function: `forEachInsightMapping`, `forEachInsightUser`<br>type: `InsightUserLoopOptions`, `InsightUserHandler` |
| `period-fortune.ts` | 219 | 주기 운세 리포트 데일리 게이트 — periodFortune (#529 / #523 Phase 2, ADR-0050). | function: `decidePeriodTriggers`, `periodFortuneTask`<br>type: `PeriodTrigger` |
| `signal-suggest-fallback.ts` | 53 | 월간 신호 제안 누락 fallback 알림 cron — 매월 2일 11:00 KST (#466, ADR-0058) — 출력 연속성 보장. | function: `signalSuggestFallbackTask` |

테스트 파일 9개

## `src/cron/life`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `budget-backfill.ts` | 177 |  | function: `calcYesterdayFlexSpent`, `getBillingMonthForDate`, `backfillYesterdayBudgetLogIfMissing`<br>const: `CYCLE_START_DAY`, `CYCLE_END_DAY` |
| `cron-message.ts` | 76 |  | function: `generateCronMessage`<br>const: `NIGHT_SYSTEM_PROMPT`, `INSIGHT_NIGHT_SYSTEM_PROMPT` |
| `insight-night-task.ts` | 60 |  | function: `insightNightTask` |
| `morning-night-tasks.ts` | 156 |  | function: `morningTask`, `nightTask` |
| `routine-records.ts` | 92 |  | function: `calcRoutineStats`, `createTodayRecords` |
| `scheduler.ts` | 205 |  | const: `RELOAD_DEBOUNCE_MS`<br>class: `CronScheduler` |
| `slot-tasks.ts` | 65 |  | function: `wrapTask`, `timeToCron`<br>const: `SLOT_TASKS` |
| `target-expiry.ts` | 72 |  | function: `getTargetExpiryDate`, `buildTargetExpiryWarning`, `warnTargetExpiryIfNear`<br>const: `TARGET_EXPIRY_WARN_DAYS` |
| `types.ts` | 6 |  | type: `LifeCronConfig` |
| `user-loop.ts` | 56 |  | function: `forEachUser` |

테스트 파일 1개

## `src/cron/weekly-report`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `aggregate-correlation.ts` | 56 |  | function: `aggregateSleepRoutineCorrelation` |
| `aggregate-routine.ts` | 117 |  | function: `aggregateWeeklyRoutine` |
| `aggregate-saju.ts` | 55 |  | function: `aggregateSajuOutcome` |
| `aggregate-schedule.ts` | 88 |  | function: `aggregateWeeklySchedule` |
| `aggregate-sleep.ts` | 58 |  | function: `aggregateWeeklySleep` |
| `aggregate.ts` | 25 |  | function: `aggregateWeeklyReport` |
| `blocks.ts` | 87 |  | function: `buildWeeklyReportBlocks` |
| `summary.ts` | 47 |  | function: `generateWeeklySummary` |
| `task.ts` | 44 |  | function: `weeklyReportTask` |
| `types.ts` | 56 | ─── 타입 ─────────────────────────────────────────────── | type: `WeeklySleepData`, `WeeklyRoutineData`, `WeeklyScheduleData`, `SleepRoutineCorrelation`, `SajuSeedOutcome`, `SajuOutcomeData`, `WeeklyReportData` |

## `src/cron/weekly-verification`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `persist-links.ts` | 142 |  | function: `persistLinkVerification`, `persistWeeklySnapshot`, `persistStrengthCutpoints`, `persistConfound` |
| `process-user.ts` | 131 |  | function: `processUser` |
| `response-profile.ts` | 143 |  | function: `persistResponseProfile` |
| `tasks.ts` | 59 |  | function: `weeklyVerificationTask`, `weeklyReviewFallbackTask` |
| `week-start.ts` | 9 |  | function: `previousMondayISO` |

테스트 파일 1개

## `src/ops`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `heartbeat-degraded.ts` | 74 | heartbeat 저하 사이클 장부 (#621). | function: `recordDegradedCycle`, `buildDegradedReport`, `dropDegradedCycles`, `getDegradedHistory`<br>type: `DegradedCycle` |
| `rebaseline-pattern-links.ts` | 149 | 패턴 검증 1회성 재기준선 — admin script (#523 Phase 0, ADR-0048). | function: `main` |
| `uptime-heartbeat.ts` | 186 | 업타임 dead-man's-switch heartbeat (인프라 레벨). | function: `loadHeartbeatConfig`, `checkBotHealth`, `checkWebHealth`, `sendPing`, `runHeartbeatOnce`, `startUptimeHeartbeat`<br>type: `HeartbeatConfig` |

테스트 파일 2개

## `src/shared`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `agent-loop.ts` | 90 |  | function: `runAgentLoop` |
| `chat-history.ts` | 72 | 채널별 대화 맥락 저장 (인메모리 슬라이딩 윈도우) | class: `ChatHistory` |
| `config.ts` | 55 |  | const: `CONFIG` |
| `db.ts` | 352 |  | function: `setSqlToolPoolRequired`, `isSqlToolPoolConnected`, `sqlToolFallbackNote`, `connectDB`, `connectSqlToolDB`, `query`, `withTransaction`, `queryOne`, `queryWithClient`, `queryReadOnlyWithTimeout`, `queryWithRowLimit`, `queryReadOnly`, `dryRunAffectedRows`, `ensureReturningClause`, `disconnectDB`<br>class: `SqlToolUnavailableError`<br>type: `DryRunResult` |
| `fortune-format.ts` | 18 | fortune_analyses 표시 포맷터. | function: `formatFortuneText`<br>type: `FortuneFormatInput` |
| `insight-labels.ts` | 266 | 카드 라벨 레이어 — 시드·신호 내부 식별자를 사용자가 읽을 수 있는 자연어로 (#504 Phase 2, ADR-0045). | function: `seedLabel`, `signalLabel`<br>const: `SEED_LABEL_OVERRIDES`<br>type: `SeedLabelInput`, `SignalLabelInput` |
| `insight-thresholds.ts` | 129 |  | const: `INSIGHT_THRESHOLDS` |
| `kst.ts` | 171 | KST (UTC+9) 날짜/시간 유틸리티. | function: `getTodayISO`, `getYesterdayISO`, `getTodayString`, `getKSTTimeString`, `getKSTDayOfWeek`, `getKSTDayOfMonth`, `getEffectiveTodayISO`, `formatDateShort`, `getWeekReference`, `diffDays`, `formatDuration`, `addDays`, `thisWeekMondayISO`<br>const: `DAY_BOUNDARY_HOUR` |
| `llm.ts` | 264 |  | function: `createLLMClient`, `createCronLLMClient`, `createDiaryMetaLLMClient`, `createPeriodLLMClient`, `toClaudeMessages`, `toClaudeTools`, `fromClaudeResponse`<br>class: `ClaudeLLMClient`<br>type: `LLMMessage`, `LLMToolDefinition`, `LLMToolCall`, `LLMResponse`, `LLMClient` |
| `migrate.ts` | 49 |  | function: `runMigrations` |
| `pending-current-state.ts` | 199 | modify_db 확인 플로우: 실행 완료 후 "현재 상태"를 테이블별 Block Kit으로 반환한다. | function: `loadCurrentStateBlocks`<br>type: `CurrentStateContext` |
| `pending-display.ts` | 152 | modify_db 확인 플로우에서 테이블별로 표시를 담당한다. | function: `formatAffectedRows`, `extractTargetTable`, `extractAffectedDates`, `hasUndatedRow`<br>type: `AffectedRow`, `DisplayGroup` |
| `pending-modify.ts` | 103 |  | function: `createPendingModify`, `findActivePending`, `claimPendingExecution`, `releasePendingExecution`, `markCanceled`<br>type: `PendingModifyRow` |
| `personality.ts` | 17 | 통합 캐릭터 정의 — "잔소리꾼". | const: `CHARACTER_PROMPT` |
| `rate-limiter.ts` | 64 | 인메모리 슬라이딩 윈도우 Rate Limiter | class: `RateLimiter`<br>type: `RateLimiterConfig` |
| `saju-calendar.ts` | 11 | 사주 달력 CLI 실행 경로. |  |
| `slack.ts` | 61 |  | function: `postToChannel`, `postBlockMessage`, `updateMessage`, `resolveActionCard`, `sendMessage`, `sendBlockMessage` |
| `user-resolver.ts` | 55 |  | function: `resolveUserId`, `queryAllUserMappings`<br>const: `DEFAULT_USER_ID`<br>type: `UserMapping` |

테스트 파일 38개

## `src/shared/agent-loop`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `llm-error.ts` | 71 |  | function: `handleLlmError` |
| `responses.ts` | 75 |  | function: `handleStopResponse`, `handleAbnormalFinish` |
| `timing.ts` | 25 |  | function: `withTimeout`, `parseRetryDelay`<br>class: `TimeoutError` |
| `tool-calls.ts` | 89 |  | function: `executeToolCalls`, `handleToolCallsResponse` |
| `types.ts` | 48 |  | const: `MAX_TOOL_ROUNDS`, `MAX_RETRIES`, `MAX_RATE_LIMIT_RETRIES`, `LLM_TIMEOUT_MS`, `TOOL_TIMEOUT_MS`<br>type: `AgentLoopResult`, `ToolExecutor`, `AgentLoopConfig`, `LoopState` |

테스트 파일 3개

## `src/shared/insights`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `pick.ts` | 78 | 통합 감지 실행과 타이밍별 넛지 선택 (크론 진입 함수). | function: `pickMorningNudges`, `pickNightNudges`, `pickWeeklyInsights` |
| `routine-comparison.ts` | 113 | 루틴 완료율 비교 감지: 시간대별 격차 · 주간 비교. | function: `detectSlotGap`, `detectWeekComparison` |
| `routine-decline.ts` | 128 | 루틴 하락 감지: 주간 회귀 · 산발성 누락. | function: `detectWeeklyRegression`, `detectSpottyPattern` |
| `routine-streak.ts` | 182 | 루틴 연속 달성 계열 감지: 연속 달성 · 회복 · 연속 달성 후 첫 누락. | function: `detectStreak`, `detectRecovery`, `detectLapseAlert` |
| `schedule.ts` | 82 | 일정 감지: 밀린 일정 · 카테고리 편향. | function: `detectOverdue`, `detectCategorySkew` |
| `sleep.ts` | 173 | 수면 감지: 수면 트렌드 · 수면 드리프트. | function: `detectSleepTrend`, `detectDrift` |
| `types.ts` | 51 | 인사이트 공용 타입과 행동 신호 → 도메인 매핑. | const: `BEHAVIOR_SIGNAL_DOMAIN`<br>type: `InsightType`, `InsightTiming`, `InsightDomain`, `Insight` |

## `src/shared/life`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `context-build.ts` | 50 | 생활 맥락 — 통합 빌더. | function: `buildLifeContext` |
| `context-sections.ts` | 203 | 생활 맥락 — 루틴·일정·일기·테마·운세 조회. | function: `queryRoutineContext`, `queryScheduleContext`, `queryDiaryContext`, `queryLifeThemesContext`, `queryFortuneContext` |
| `context-sleep.ts` | 173 | 생활 맥락 — 수면 조회. | function: `querySleepContext` |
| `context-types.ts` | 13 | 생활 맥락 — 공용 타입. | type: `ContextTiming`, `DateParams` |
| `queries-notification.ts` | 23 | 알림 설정 쿼리. | function: `queryNotificationSettings`<br>type: `NotificationSettingRow` |
| `queries-reminder.ts` | 86 | 리마인더 쿼리. | function: `queryDueReminders`, `queryActiveReminderTimes`, `deactivateReminder`, `decrementReminderCount`<br>type: `ReminderRow` |
| `queries-routine.ts` | 162 | 루틴 쿼리: 타입 · 빈도 헬퍼 · 템플릿/기록 조회와 변경. | function: `shouldCreateToday`, `frequencyBadge`, `queryActiveTemplates`, `queryTodayRecords`, `queryExistingTemplateIds`, `queryLastRecordDate`, `createRecord`, `completeRecord`<br>type: `RoutineTrackingMode`, `RoutineTemplateRow`, `RoutineRecordRow` |
| `queries-schedule.ts` | 141 | 일정 쿼리: 타입 · 조회 · 상태 변경. | function: `queryTodaySchedules`, `queryBacklogSchedules`, `countOverdueTasks`, `moveScheduleToDate`, `updateScheduleStatus`, `deleteSchedule`, `toggleScheduleImportant`, `postponeSchedule`<br>type: `ScheduleRow` |
| `queries-sleep.ts` | 61 | 수면 쿼리 (Home 탭): 타입 · 조회. | function: `querySleepForHome`, `querySleepEventsForHome`<br>type: `SleepRecordRow`, `SleepEventRow` |

## `src/shared/life-signal-evaluators`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `behavior-baseline.ts` | 46 | behavior_baseline evaluator — 11종 결정론 패턴 (insights/ detect 함수 위임). | function: `evaluateBehaviorBaseline` |
| `calendar-event.ts` | 38 | calendar_event evaluator — 한국 공휴일 / 공휴일 다음날 / 자동이체일. | function: `evaluateCalendarEvent` |
| `index.ts` | 40 | life_signal trigger_aux.kind dispatcher (마스터 #434 Phase 3, ADR-0029). | function: `dispatchLifeSignal` |
| `korean-holidays.ts` | 76 | 한국 공휴일 정적 상수 (매년 수동 갱신). | function: `isKoreanHoliday`<br>const: `KOREAN_HOLIDAYS`, `FIRST_HOLIDAY_DATA_YEAR`, `LAST_HOLIDAY_DATA_YEAR` |
| `month-position.ts` | 32 | month_position evaluator — 월초 / 월말 / 월중 (KST 기준). | function: `evaluateMonthPosition` |
| `season.ts` | 26 | season evaluator — 양력 월 기반 4계절 (KST 기준). | function: `evaluateSeason` |
| `threshold.ts` | 90 | threshold evaluator — 임계치 풀셋 (수면 / 루틴 streak). | function: `evaluateThreshold` |
| `weekday.ts` | 26 | weekday / weekday_group evaluator. | function: `evaluateWeekday`, `evaluateWeekdayGroup` |

테스트 파일 7개

## `src/shared/pattern`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `bayesian-posterior.ts` | 92 | Beta-Binomial Bayesian posterior 헬퍼 — ADR-0024 실행 (마스터 #434 Phase 7). | function: `updatePosterior`, `posteriorMean`, `credibleInterval`, `cumulativePosteriorFromHitMiss`, `empiricalBetaPrior`<br>type: `BetaPosterior` |
| `binarize.ts` | 83 | 윈도우 일자 배열 + sql 신호 시리즈 이진화 (pattern-verification에서 분리). | function: `buildWindowDates`, `binarizeSqlSeries` |
| `confound-calc.ts` | 228 | 교란 플래그·MH 층화 조정 순수 계산 (confound에서 분리). | function: `computeOverlap`, `flagConfoundersForLink`, `buildStrata`, `classifyVerdict`, `adjustConfounders`<br>type: `AdjustInput` |
| `confound-flag.ts` | 209 | 교란 플래그 로더 (confound에서 분리). | function: `flagConfounds` |
| `confound-types.ts` | 63 | 교란 플래그·조정 타입 (confound에서 분리). | type: `SuspectedConfounder`, `ConfoundVerdict`, `AdjustedConfounder`, `ConfoundData`, `ConfoundResult`, `ConfoundThresholds`, `ConfoundAdjustThresholds`, `ConfoundCandidate` |
| `contingency.ts` | 166 | 2×2 분할표·일자 시퀀스·판정 순수 계산 (pattern-verification에서 분리). | function: `buildContingency`, `buildDaySequence`, `splitHalvesConsistent`, `verifyContingency`, `classifyVerdict`, `statusForVerdict` |
| `data-window.ts` | 145 | 데이터-존재 윈도우 계산 (pattern-verification에서 분리). | function: `computeUserDataStarts`, `signalDataStart`, `seedDataStart`, `maxDate`, `enrollmentStart`<br>type: `UserDataStarts` |
| `fdr-family.ts` | 43 | FDR 가족 분리 (pattern-verification에서 분리). | function: `familyOf`, `bhFdrByFamily`<br>type: `FdrFamily` |
| `load-signal-defs.ts` | 57 | 신호 정의 로더 (pattern-verification에서 분리). | function: `toSignalDef`, `querySignalDefRows`, `loadSignalDefsByIds`<br>type: `SignalDefRow` |
| `match-aux-types.ts` | 126 | life_signal trigger_aux 타입과 type guard (pattern-match에서 분리). | function: `isLifeSignalAux`<br>type: `WeekdayDow`, `WeekdayAux`, `WeekdayGroupAux`, `MonthPositionAux`, `SeasonAux`, `CalendarEventAux`, `ThresholdAux`, `BehaviorSignalName`, `BehaviorBaselineAux`, `LifeSignalAux` |
| `match-context.ts` | 85 | 본명·일운 컨텍스트 로드 (pattern-match에서 분리). | function: `loadNatalContext`, `getDailyContext` |
| `match-day.ts` | 200 | 하루치 시드 매칭과 결과 기록 (pattern-match에서 분리). | function: `buildNameIdMap`, `loadStrengthCutpoints`, `matchAllSeedsForDay`, `recordDailyMatches` |
| `match-metric.ts` | 197 | 신호(메트릭) 평가 (pattern-match에서 분리). | function: `runMetricSql`, `runLlmSignalSql`, `runnerForSource`, `evaluateMetric`<br>type: `MetricRunner` |
| `match-seeds.ts` | 50 | 활성 시드 로드 (pattern-match에서 분리). | function: `loadActiveSeeds` |
| `match-trigger-lookups.ts` | 128 | 트리거 평가용 조회 헬퍼와 지지 관계 캐시 (pattern-match에서 분리). | function: `loadBranchRelations`, `lookupSibiunsung`, `isStringArray`, `getNumberField`, `pickPillarByLevel`, `pillarSetOf`, `__resetCacheForTest`<br>const: `ELEMENT_BY_STEM`, `ELEMENT_BY_BRANCH` |
| `match-trigger.ts` | 215 | 트리거 평가 (pattern-match에서 분리). | function: `evaluateTrigger` |
| `match-types.ts` | 114 | 일일 매칭 엔진의 공용 타입 (pattern-match에서 분리). | type: `PillarLevel`, `SajuSeed`, `SajuMetric`, `SajuSeedWithMetrics`, `NatalContext`, `DailyContext`, `MetricEvaluation`, `SeedMatchResult` |
| `mirror-signal.ts` | 112 | 거울 신호 정의 보장 (pattern-verification에서 분리). | function: `ensureMirrorSignalDef`<br>type: `MirrorSignalOutcome`, `MirrorSignalResult` |
| `quantile.ts` | 69 | 분위수 컷 + 밴드 분류 순수 함수 — #477 P4a (ADR-0036). | function: `isBand`, `quantileSorted`, `tertileCuts`, `classifyBand`<br>type: `BandCuts`, `Band` |
| `seed-saturation.ts` | 211 | 포화 시드 양방향 가드 (#508 P③, ADR-0046). | function: `isSaturated`, `isDesaturated`, `runSaturationSweep`<br>const: `SATURATION_REASON`<br>type: `SweepSeed`, `SaturationSweepResult` |
| `series-map.ts` | 82 | 신호·시드 시리즈 일괄 계산 — 검증·발굴·교란 진입점이 공유하는 헬퍼. | function: `computeSignalSeriesMap`, `computeSeedActivationMap` |
| `series.ts` | 216 | 신호·시드 활성 시리즈 계산 (pattern-verification에서 분리). | function: `computeSignalSeries`, `splitRawByActivation`, `computeTargetStrengthSeries`, `computeSeedActivationSeries`, `lastActivationDate`<br>type: `SignalSeriesResult` |
| `signal-defs.ts` | 106 | signal_defs 재생성 가드 — #557 (2026-07 감사 S7). | function: `findEquivalentSignal`<br>type: `SignalIdentity`, `EquivalentDecision` |
| `signal-sql-guard.ts` | 187 | LLM 신호 SQL 게이트 #1 — 정적 검증 (#477 P5b, ADR-0040). | function: `validateSignalSql`<br>const: `SIGNAL_ROW_CAP`, `SIGNAL_TABLE_WHITELIST` |
| `sql-tool-skip.ts` | 23 | SQL 도구 전용 연결이 없을 때의 LLM 신호 건너뛰기 (#665). | function: `isSqlToolUnavailable`, `logLlmSignalSkip` |
| `stats-evalue.ts` | 74 | e-value test martingale (stats에서 분리, 순수·의존 없음) — P3, ADR-0034. | function: `evalueTestMartingale`<br>const: `DEFAULT_EVALUE_OPTIONS`<br>type: `DayObservation`, `EvalueOptions` |
| `stats-table.ts` | 120 | 2×2 표 기반 검정과 다중 비교 보정 (stats에서 분리, 순수·의존 없음) — ADR-0032 통계 스택. | function: `fisherExact`, `bhFdr`, `mantelHaenszelRR`<br>type: `Stratum2x2` |
| `stats.ts` | 167 | 순수 통계 알고리즘 (의존 없음) — #477 P3 (ADR-0032 통계 스택). | function: `mannWhitneyU`, `hodgesLehmann`, `blockPermutationP`<br>type: `MannWhitneyResult` |
| `strength-cutpoints.ts` | 56 | 강도 분위수 컷 산출 (pattern-verification에서 분리). | function: `computeStrengthCutpoints`<br>type: `StrengthCutpoint` |
| `types.ts` | 107 | off-day 대조 검증 엔진의 공용 타입 (pattern-verification에서 분리). | type: `SignalDirection`, `LinkLifecycleStatus`, `Verdict`, `DaySeries`, `SignalDef`, `Contingency`, `ContingencyVerification`, `LinkVerification` |
| `verify-link-calc.ts` | 197 | 링크 1건 검증 계산과 일괄 보정 (verify-links에서 분리, DB 접근 없음). | function: `buildLinkInterim`, `finalizeVerifications`<br>type: `ActiveLinkRow`, `LinkInterimDeps` |
| `verify-links.ts` | 123 | 사용자 링크 주간 검증 (pattern-verification에서 분리). | function: `verifyUserLinks` |

테스트 파일 4개

## `src/shared/period`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `forecast-generate.ts` | 164 | 예측 장부 — 사전등록 예측 생성. | function: `generateForecasts` |
| `forecast-ledger.ts` | 47 | 예측 장부 — fast path 카드용 장부 로드. | function: `loadLedger` |
| `forecast-rows.ts` | 81 | 예측 장부 — DB 행과 엔트리 변환, 기간별 예측 행 로드. | function: `parseDirection`, `parseSourceCell`, `toForecastEntry`, `toScoredEntry`, `loadForecastsForPeriod`<br>const: `FORECAST_COLUMNS`<br>type: `ForecastDbRow` |
| `forecast-score.ts` | 158 | 예측 장부 — 기간 종료 뒤 사후 채점. | function: `scoreForecasts` |
| `interpretation-derive.ts` | 30 | 기간 해석 — 기간 pillar의 십성·오행·합충 결정론 도출. | function: `derivePeriodContext` |
| `interpretation-labels.ts` | 28 | 기간 해석 — 서사·렌더 공용 라벨과 고정 문구. | const: `DOMAIN_LABEL`, `PERIOD_LABEL`, `LADDER_STATUS`, `TRANSFER_HEDGE` |
| `interpretation-narrative.ts` | 111 | 기간 해석 — LLM 서사 생성과 결정론 fallback. | function: `composeNarrative` |
| `interpretation-payload.ts` | 132 | 기간 해석 — 측정 셀·교과서 셀·기술통계를 묶는 payload 빌드. | function: `buildInterpretationPayload` |
| `interpretation-render.ts` | 151 | 기간 해석 — Slack 블록 결정론 렌더(cron·fast path 공용). | function: `renderInterpretationBlocks` |
| `interpretation-stats.ts` | 144 | 기간 해석 — 누적 기술통계 집계(inline SQL). | function: `buildDescriptiveStats` |
| `interpretation-store.ts` | 157 | 기간 해석 — 응답 프로필 인덱스 로드와 해석 영속·조회. | function: `loadResponseProfileIndex`, `upsertInterpretation`, `loadLatestInterpretation` |
| `types.ts` | 111 | 기간 해석·예측 장부 공용 타입 — 해석 쪽과 예측 쪽이 서로의 타입을 여기서 가져온다. | type: `PeriodType`, `ResponseProfileIndex`, `PeriodContext`, `MeasuredCell`, `TextbookCell`, `DescriptiveStats`, `InterpretationPayload`, `PeriodInterpretationRecord`, `LedgerPeriodType`, `ForecastSourceCell`, `NoCallReason`, `ForecastEntry`, `ScoredEntry`, `LedgerCardData`, `ForecastRange` |

## `src/shared/response-profile`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `aggregate.ts` | 193 | 응답 프로필 — 링크 기여를 셀로 집계(롤업·tier·shrunk). | function: `buildResponseProfile`<br>type: `ProfileLink` |
| `axis.ts` | 130 | 응답 프로필 — 사주 축·셀 정의와 시드 → source 셀 매핑. | function: `groupElement`, `mapSeedToCell`, `cellKey`<br>const: `SIPSUNG_GROUP`<br>type: `AxisLevel`, `CellTier`, `SeedForCell`, `PrimaryCell`, `ResponseCell` |
| `resolve.ts` | 60 | 응답 프로필 — 셀 인덱스와 단일 레벨 resolution. | function: `indexCells`, `resolveHierarchyCell`, `resolveElementBandCell`<br>type: `ResolvedCell` |

## `src/shared/saju`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `cli.ts` | 139 | 만세력 CLI 실행부. | function: `runCLI` |
| `fortune.ts` | 56 | 일운 통합 계산 진입점. | function: `calculateDailyFortune`, `calculateFortuneRange` |
| `helpers.ts` | 32 | 날짜·간지 index 헬퍼. | function: `parseDate`, `daysDiff`, `indexToPillar`, `cheonganIndex`, `jijiIndex` |
| `hwa.ts` | 191 | 결정론 합화(合化) 변환 탐지 — #477 P4b (ADR-0038). | function: `isSipsinGroup`, `elementToSipsinGroup`, `detectHwaTransforms`<br>type: `SipsinGroup`, `HwaTransform`, `HwaResult` |
| `jeolgi-table.ts` | 177 | 절기 테이블. | const: `JEOLGI_TABLE`, `JEOLGI_JIJI`, `JEOLGI_MONTH_OFFSET` |
| `pillar-utils.ts` | 96 | 오행·Pillar 유틸과 대운 추출. | function: `getElementByCheongan`, `getElementByJiji`, `makePillar`, `parsePillarString`, `getDaeunPillar` |
| `pillars.ts` | 163 | 기둥(일주·월주·년주) 계산과 절기월 범위. | function: `getDayPillar`, `getYearPillar`, `getIpchunDate`, `getMonthPillar`, `getJeolgiMonthRange`, `isJeolgiTransitionDay` |
| `relations.ts` | 170 | 합충형파해 분석. | function: `getRelations` |
| `sipsung.ts` | 119 | 십성·십이운성·지장간 계산. | function: `getSipsung`, `getJijiSipsung`, `getSipsungResult`, `getSibiunsung`, `getJijanggan` |
| `strength-params.ts` | 82 | 결정론 사주 실효강도 모델의 명리학 파라미터 — #477 P4a (ADR-0036). | const: `SAJU_STRENGTH_PARAMS`, `SAJU_HWA_PARAMS`<br>type: `SajuStrengthParams`, `HwaParams` |
| `strength.ts` | 220 | 결정론 사주 실효강도 엔진 — #477 P4a (ADR-0036). | function: `isStrengthTarget`, `computeElementStrengths`, `computeStrengthForTarget`, `computeAbsoluteStrengthState`, `computeElementRatios`<br>type: `StrengthTarget`, `AbsoluteStrengthState`, `ElementStrengths` |
| `tables.ts` | 224 | 간지·오행·십이운성·합충 상수 테이블. | const: `CHEONGAN_LIST`, `JIJI_LIST`, `CHEONGAN_HANJA`, `JIJI_HANJA`, `CHEONGAN_ELEMENT`, `CHEONGAN_YINYANG`, `JIJI_BONGI`, `JIJANGGAN`, `SIBIUNSUNG_CYCLE`, `YANG_JANGSEONG_START`, `CHEONGAN_HAP`, `JIJI_CHUNG`, `JIJI_YUKHAP`, `JIJI_SAMHAP`, `JIJI_HYUNG`, `JIJI_PA`, `JIJI_HAE`, `CHEONGAN_HAP_RULES`, `JIJI_YUKHAP_RULES`, `JIJI_SAMHAP_RULES`, `JIJI_CHUNG_PAIRS`<br>type: `StemHapRule`, `BranchHapRule` |
| `types.ts` | 106 | 만세력 타입 정의. | type: `Cheongan`, `Jiji`, `Sipsung`, `Sibiunsung`, `Pillar`, `SipsungResult`, `JijangganEntry`, `Relations`, `DailyFortuneData`, `Element`, `PillarSet` |

## `src/shared/sql-tools`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `definitions.ts` | 57 | LLM에 노출하는 SQL 도구 정의. | const: `SQL_TOOLS` |
| `execute.ts` | 188 | SQL 도구 실행기: post-modify 훅 · 확인 카드 전송 · 감사 로그 · 실행. | function: `setPostModifyHook`, `setConfirmCardSender`, `clearConfirmCardSender`, `executeSQLTool`<br>type: `PostModifyHook`, `SQLToolContext`, `ConfirmCardSender` |
| `privilege-sync.ts` | 241 | SQL 도구 역할의 권한 동기화 (ADR-0067). | function: `quoteIdent`, `roleFromUrl`, `buildPrivilegeStatements`, `syncSqlToolPrivileges`, `startSqlToolPool`<br>type: `SequenceOwner`, `PrivilegePlanInput`, `SqlToolStartOptions` |
| `schema.ts` | 66 | DB 스키마 조회와 캐시. | function: `clearSchemaCache`, `getSchemaInfo` |
| `sql-blocks.ts` | 194 | 토큰 범위 유틸과 WHERE/ON 조건의 user_id 보장 분석. | function: `buildMatch`, `isWord`, `isPunct`, `identName`, `afterGroup`, `topLevel`, `splitTop`, `findTop`, `closeOver`, `conditionGuarantee`<br>const: `UNQUALIFIED`<br>type: `Ctx`, `Range`, `Guarantee` |
| `sql-guards.ts` | 125 | 토큰 단위 보안 검사: 시스템 함수·카탈로그 차단, 키워드 위치 제한, user_id 비교 값 제한. | function: `findDangerousIdentifier`, `findWriteKeyword`, `findExtraWriteKeyword`, `otherUserMessage`, `findOtherUserValue` |
| `sql-lexer-checks.ts` | 119 | 토큰화 뒤 검사: 이름 자리 표시, CASE 위치, 이어 쓴 문자열 리터럴. | function: `markNameWords`, `hasAdjacentStrings`, `hasClearCases` |
| `sql-lexer.ts` | 255 | SQL 토크나이저: PostgreSQL 어휘 규칙을 따라 문자열·주석·달러 인용을 구분한다. | function: `tokenize`, `hasStatementAfterSemicolon`, `withoutTrailingSemicolon`, `maskedText`<br>type: `TokenKind`, `Token`, `LexResult` |
| `table-permissions.ts` | 126 | SQL 도구 전용 DB 역할의 테이블 권한 목록 (ADR-0067). | function: `getTableAccess`, `isToolModifyAllowed`<br>const: `TABLE_PERMISSIONS`<br>type: `TableAccess`, `ModifyOp` |
| `user-scope-dml.ts` | 319 | 변경 쿼리(INSERT·UPDATE·DELETE)의 user_id 범위 분석. | function: `analyzeUpdate`, `analyzeDelete`, `analyzeInsert` |
| `user-scope.ts` | 504 | 조회 쿼리의 user_id 범위 분석. | function: `fail`, `startsQuery`, `scanGroups`, `splitClauses`, `parseSource`, `parseFromList`, `uncoveredSources`, `requireCoverage`, `analyzeQuery`, `hasUnhandledQuery`<br>const: `USER_ID_EXEMPT_TABLES`, `SHARED_READONLY_TABLES`, `BLOCKED_TABLES`, `MSG`, `SELECT_CLAUSES`<br>type: `ScopeCtx`, `Clauses`, `JoinKind`, `Source` |
| `validation.ts` | 164 | SQL 검증: 구문 검증과 보안 검증 (user_id 필터, custom_instructions). | function: `extractFirstKeyword`, `hasMultipleStatements`, `validateSelectQuery`, `hasWhereClause`, `validateModifyQuery`, `validateUserIdFilter`, `validateCustomInstruction` |
