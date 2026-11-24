# 봇 코드

<!-- 자동 생성 파일. 직접 고치지 않는다. 코드를 바꾼 뒤 `yarn code-map`으로 다시 만든다. -->

> 자동 생성 파일이다. 직접 고치지 말고 `yarn code-map`으로 다시 만든다.

`src/` 아래 소스 파일 75개, 19155줄이고 테스트 파일은 58개다. 줄 수는 테스트를 뺀 값이다.
역할 칸에는 파일 맨 위 주석의 첫 문장을 옮겼고, 주석이 없는 파일은 비워 뒀다. export 칸의 function에는 화살표 함수로 선언한 const도 들어간다.

## `src`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `app.ts` | 105 |  |  |
| `db-proxy.ts` | 251 |  | function: `handleRequest`, `startDBProxy` |
| `router.ts` | 56 |  | function: `registerAgent`, `registerMessageHandler`<br>type: `AgentHandler` |

테스트 파일 2개

## `src/agents/insight`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `actions.ts` | 303 | Insight 에이전트 Slack 액션 핸들러. | function: `extractMessageBlocks`, `approveDiscoveryLink`, `dismissDiscoveryLink`, `approveLlmSignal`, `rejectLlmSignal`, `registerInsightActions` |
| `diary-edit-actions.ts` | 202 | Insight 에이전트 — Slack 일기 조회·수정 핸들러 (#639). | function: `showDiary`, `validateDiaryEditDate`, `formatDiaryEditConfirmation`, `registerDiaryEditActions` |
| `diary-edit-store.ts` | 159 | Insight 에이전트 — Slack 일기 수정 저장 (#639). | function: `findDiaryEntryByDate`, `findDiaryEntryById`, `applyDiaryEdit`<br>type: `DiaryEntryRow`, `DiaryEditInput`, `DiaryEditAction`, `DiaryEditResult` |
| `diary-edit.ts` | 292 | Insight 에이전트 — Slack 일기 수정 (#639). | function: `parseDiaryLookup`, `splitDiaryContent`, `joinDiaryParts`, `hashDiaryContent`, `encodeDiaryEditMeta`, `decodeDiaryEditMeta`, `buildDiaryLookupBlocks`, `buildDiaryEditModal`, `buildDiaryNotFoundModal`, `readDiaryEditSubmission`<br>const: `DIARY_EDIT_ACTION_ID`, `DIARY_EDIT_VIEW_ID`, `DIARY_DATE_BLOCK_ID`, `DIARY_PART_BLOCK_PREFIX`, `SLACK_TEXT_MAX`<br>type: `DiaryLookupParse`, `PartJoin`, `DiaryParts`, `DiaryEditMeta`, `DiaryEditSubmission` |
| `diary-fast-path.ts` | 161 | Insight 에이전트 — 일기 fast path. | function: `naturalDelay`, `pickDiaryConfirmation`, `resolveDiaryDate`, `parseDatedDiary`, `formatDiaryDateLabel`, `formatDatedConfirmation`, `backfillDiaryMetaTags`, `saveDiaryEntry`<br>type: `DatedDiaryParse` |
| `hypothesis-cards.ts` | 150 | 인사이트 Block Kit 카드 빌더 — P5a 발굴 승인 카드(ADR-0039) + 재기준선 공지(#523 P0, ADR-0048). | function: `encodeDiscoveryPayload`, `decodeDiscoveryPayload`, `buildDiscoveryCandidateCard`, `buildRebaselineNotice`<br>const: `DISCOVERY_APPROVE_ACTION_ID`, `DISCOVERY_DISMISS_ACTION_ID`<br>type: `DiscoveryCardPayload`, `DiscoveryCardInput`, `RebaselineSummary` |
| `hypothesis-discovery.ts` | 427 | 패턴 발굴 엔진 — 링크 없는 (시드 × 신호) 여집합을 off-day 대조로 스캔 (#477 P5a, ADR-0039). | function: `discoverCandidates`, `insertPendingDiscoveryLink`<br>type: `DiscoveryCandidate` |
| `index.ts` | 268 |  | function: `createInsightAgent` |
| `llm-signal-cards.ts` | 97 | LLM 자율 신호 제안 승인 카드 — #477 P5b (ADR-0040, P5a 승인 게이트 재사용). | function: `encodeLlmSignalPayload`, `decodeLlmSignalPayload`, `buildLlmSignalCard`, `buildNoSignalSuggestionMessage`<br>const: `LLM_SIGNAL_APPROVE_ACTION_ID`, `LLM_SIGNAL_REJECT_ACTION_ID`<br>type: `LlmSignalPayload`, `LlmSignalCardInput` |
| `pattern-seed-fast-path.ts` | 108 | 사주 시드 토글 fast path. | function: `tryPatternSeedFastPath`<br>const: `SAJU_SEED_LIST_RE`, `SAJU_SEED_LIST_ALL_RE`, `SAJU_SEED_OFF_RE`, `SAJU_SEED_ON_RE` |
| `prompt.ts` | 185 |  | function: `buildInsightSystemPrompt` |

테스트 파일 9개

## `src/agents/life`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `actions.ts` | 254 | v2 Life Agent 인터랙티브 버튼 핸들러. | function: `registerLifeActions` |
| `blocks.ts` | 724 | v2 Life Agent Block Kit 빌더. | function: `parseButtonValue`, `buildRoutineBlocks`, `buildFilteredRoutineBlocks`, `buildMorningGreetingBlocks`, `buildConfirmModifyCard`, `buildNudgeBlock`, `buildSleepReminderText`, `buildSleepRecordedText`, `encodeOverflowValue`, `parseOverflowValue`, `formatSchedulesAsText`, `buildScheduleBlocks`, `buildScheduleText`, `buildNightScheduleText`, `buildYesterdayIncompleteText`, `buildSleepBlocks`<br>const: `ROUTINE_ACTION_ID`, `SCHEDULE_ACTION_ID`, `POSTPONE_ACTION`, `DELETE_ACTION`, `TOGGLE_IMPORTANT_ACTION`, `MOVE_TO_TODAY_ACTION`, `CONFIRM_MODIFY_EXECUTE_ACTION_ID`, `CONFIRM_MODIFY_CANCEL_ACTION_ID`<br>type: `SlotFilter` |
| `home.ts` | 123 | Slack App Home 탭 — 오늘의 일정, 루틴, 수면 대시보드. | function: `publishHomeView`, `registerHomeTab` |
| `index.ts` | 134 |  | function: `createLifeAgent` |
| `prompt.ts` | 290 |  | function: `buildLifeSystemPrompt` |

테스트 파일 3개

## `src/cron`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `daily-pattern-matching.ts` | 52 | 매일 07시 패턴 일일 매칭 cron (08:03 일일 종합 인사이트 선행, #475 ADR-0031). | function: `dailyPatternMatchingTask` |
| `diary-meta-extract.ts` | 207 | 일기 → 메타 태그 LLM 추출 cron. | function: `parseTagResponse`, `extractDiaryTags`, `extractAndPersistForUser`, `diaryMetaExtractTask`<br>const: `DIARY_META_TAGS`<br>type: `DiaryMetaTag`, `DiaryMetaExtractResult` |
| `discovery-recommend.ts` | 111 | 발굴 후보 재추천 — 묶음 전부 패스 시 다음 best 묶음을 데일리 틱으로 surface (#504 P3, ADR-0047). | function: `recommendDiscoveries`, `decideReRecommend`, `discoveryRecommendTask` |
| `life-cron.ts` | 946 | v4 크론 오케스트레이터. | function: `calcRoutineStats`, `createTodayRecords`, `calcYesterdayFlexSpent`, `getBillingMonthForDate`, `getTargetExpiryDate`, `buildTargetExpiryWarning`, `warnTargetExpiryIfNear`, `timeToCron`<br>const: `CYCLE_START_DAY`, `TARGET_EXPIRY_WARN_DAYS`, `RELOAD_DEBOUNCE_MS`<br>class: `CronScheduler`<br>type: `LifeCronConfig` |
| `period-fortune.ts` | 232 | 주기 운세 리포트 데일리 게이트 — periodFortune (#529 / #523 Phase 2, ADR-0050). | function: `decidePeriodTriggers`, `periodFortuneTask`<br>type: `PeriodTrigger` |
| `signal-suggest-fallback.ts` | 71 | 월간 신호 제안 누락 fallback 알림 cron — 매월 2일 11:00 KST (#466, ADR-0058) — 출력 연속성 보장. | function: `signalSuggestFallbackTask` |
| `weekly-report.ts` | 619 | 주간 리포트. | function: `aggregateWeeklySleep`, `aggregateWeeklyRoutine`, `aggregateWeeklySchedule`, `aggregateSleepRoutineCorrelation`, `aggregateSajuOutcome`, `aggregateWeeklyReport`, `weeklyReportTask`<br>type: `WeeklySleepData`, `WeeklyRoutineData`, `WeeklyScheduleData`, `SleepRoutineCorrelation`, `SajuSeedOutcome`, `SajuOutcomeData`, `WeeklyReportData` |
| `weekly-verification.ts` | 523 | 주간 off-day 검증 엔진 cron — 월요일 06:00 KST (#477 P2·P3). | function: `previousMondayISO`, `persistLinkVerification`, `weeklyVerificationTask`, `weeklyReviewFallbackTask` |

테스트 파일 7개

## `src/ops`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `heartbeat-degraded.ts` | 74 | heartbeat 저하 사이클 장부 (#621). | function: `recordDegradedCycle`, `buildDegradedReport`, `dropDegradedCycles`, `getDegradedHistory`<br>type: `DegradedCycle` |
| `rebaseline-pattern-links.ts` | 141 | 패턴 검증 1회성 재기준선 — admin script (#523 Phase 0, ADR-0048). |  |
| `uptime-heartbeat.ts` | 186 | 업타임 dead-man's-switch heartbeat (인프라 레벨). | function: `loadHeartbeatConfig`, `checkBotHealth`, `checkWebHealth`, `sendPing`, `runHeartbeatOnce`, `startUptimeHeartbeat`<br>type: `HeartbeatConfig` |

테스트 파일 1개

## `src/shared`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `agent-loop.ts` | 338 |  | function: `withTimeout`, `parseRetryDelay`, `getAckMessage`, `runAgentLoopWithAck`, `executeToolCalls`, `runAgentLoop`<br>const: `MAX_TOOL_ROUNDS`, `MAX_RETRIES`, `MAX_RATE_LIMIT_RETRIES`, `LLM_TIMEOUT_MS`, `TOOL_TIMEOUT_MS`, `ACK_DELAY_MS`<br>type: `AgentLoopResult`, `ToolExecutor`, `AgentLoopConfig` |
| `bayesian-posterior.ts` | 92 | Beta-Binomial Bayesian posterior 헬퍼 — ADR-0024 실행 (마스터 #434 Phase 7). | function: `updatePosterior`, `posteriorMean`, `credibleInterval`, `cumulativePosteriorFromHitMiss`, `empiricalBetaPrior`<br>type: `BetaPosterior` |
| `chat-history.ts` | 72 | 채널별 대화 맥락 저장 (인메모리 슬라이딩 윈도우) | class: `ChatHistory` |
| `config.ts` | 48 |  | const: `CONFIG` |
| `confound.ts` | 469 | 교란 플래그 + 다변량 분리 엔진 — 공동발현 시드 (#477 P6 ADR-0041, P7 ADR-0042). | function: `computeOverlap`, `flagConfoundersForLink`, `buildStrata`, `classifyVerdict`, `adjustConfounders`, `flagConfounds`<br>type: `SuspectedConfounder`, `ConfoundVerdict`, `AdjustedConfounder`, `ConfoundData`, `ConfoundResult`, `ConfoundThresholds`, `ConfoundAdjustThresholds`, `ConfoundCandidate`, `AdjustInput` |
| `db.ts` | 230 |  | function: `connectDB`, `query`, `withTransaction`, `queryOne`, `queryWithClient`, `queryWithRowLimit`, `queryReadOnly`, `dryRunAffectedRows`, `ensureReturningClause`, `disconnectDB`<br>type: `DryRunResult` |
| `fortune-format.ts` | 18 | fortune_analyses 표시 포맷터. | function: `formatFortuneText`<br>type: `FortuneFormatInput` |
| `insight-labels.ts` | 266 | 카드 라벨 레이어 — 시드·신호 내부 식별자를 사용자가 읽을 수 있는 자연어로 (#504 Phase 2, ADR-0045). | function: `seedLabel`, `signalLabel`<br>const: `SEED_LABEL_OVERRIDES`<br>type: `SeedLabelInput`, `SignalLabelInput` |
| `insight-thresholds.ts` | 129 |  | const: `INSIGHT_THRESHOLDS` |
| `insights.ts` | 766 | 프로액티브 인사이트 감지 엔진. | function: `detectStreak`, `detectSleepTrend`, `detectSlotGap`, `detectWeekComparison`, `detectOverdue`, `detectCategorySkew`, `detectDrift`, `detectRecovery`, `detectLapseAlert`, `detectWeeklyRegression`, `detectSpottyPattern`, `pickMorningNudges`, `pickNightNudges`, `pickWeeklyInsights`<br>const: `BEHAVIOR_SIGNAL_DOMAIN`<br>type: `InsightType`, `InsightTiming`, `InsightDomain`, `Insight` |
| `kst.ts` | 156 | KST (UTC+9) 날짜/시간 유틸리티. | function: `getTodayISO`, `getYesterdayISO`, `getTodayString`, `getKSTTimeString`, `getKSTDayOfWeek`, `getKSTDayOfMonth`, `getEffectiveTodayISO`, `formatDateShort`, `getWeekReference`, `addDays`, `thisWeekMondayISO`<br>const: `DAY_BOUNDARY_HOUR` |
| `life-context.ts` | 429 | 생활 맥락 빌더. | function: `buildLifeContext`<br>type: `ContextTiming` |
| `life-queries.ts` | 471 | v2 Life Agent SQL 쿼리 레이어. | function: `shouldCreateToday`, `frequencyBadge`, `queryActiveTemplates`, `queryTodayRecords`, `queryExistingTemplateIds`, `queryLastRecordDate`, `createRecord`, `completeRecord`, `queryTodaySchedules`, `queryBacklogSchedules`, `countOverdueTasks`, `moveScheduleToDate`, `updateScheduleStatus`, `deleteSchedule`, `toggleScheduleImportant`, `postponeSchedule`, `queryNightSleepExists`, `queryNotificationSettings`, `queryDueReminders`, `queryActiveReminderTimes`, `deactivateReminder`, `decrementReminderCount`, `querySleepForHome`, `querySleepEventsForHome`<br>type: `RoutineTrackingMode`, `RoutineTemplateRow`, `RoutineRecordRow`, `ScheduleRow`, `SleepRecordRow`, `NotificationSettingRow`, `ReminderRow`, `SleepEventRow` |
| `llm.ts` | 264 |  | function: `createLLMClient`, `createCronLLMClient`, `createDiaryMetaLLMClient`, `createPeriodLLMClient`, `toClaudeMessages`, `toClaudeTools`, `fromClaudeResponse`<br>class: `ClaudeLLMClient`<br>type: `LLMMessage`, `LLMToolDefinition`, `LLMToolCall`, `LLMResponse`, `LLMClient` |
| `migrate.ts` | 49 |  | function: `runMigrations` |
| `pattern-match.ts` | 950 | 사주 시드 카탈로그 기반 일일 매칭 엔진. | function: `isLifeSignalAux`, `loadNatalContext`, `getDailyContext`, `loadActiveSeeds`, `evaluateTrigger`, `runMetricSql`, `runLlmSignalSql`, `runnerForSource`, `evaluateMetric`, `buildNameIdMap`, `loadStrengthCutpoints`, `matchAllSeedsForDay`, `recordDailyMatches`, `__resetCacheForTest`<br>type: `PillarLevel`, `SajuSeed`, `SajuMetric`, `SajuSeedWithMetrics`, `NatalContext`, `DailyContext`, `LifeSignalKind`, `WeekdayDow`, `WeekdayAux`, `WeekdayGroupAux`, `MonthPositionAux`, `SeasonAux`, `CalendarEventAux`, `ThresholdAux`, `BehaviorSignalName`, `BehaviorBaselineAux`, `LifeSignalAux`, `MetricEvaluation`, `SeedMatchResult`, `MetricRunner` |
| `pattern-verification.ts` | 1139 | off-day 대조 검증 엔진 코어 — #477 P2 (ADR-0032 통계 스택 + ADR-0033 매트릭=가설). | function: `computeUserDataStarts`, `signalDataStart`, `seedDataStart`, `maxDate`, `enrollmentStart`, `buildWindowDates`, `binarizeSqlSeries`, `buildContingency`, `buildDaySequence`, `splitHalvesConsistent`, `verifyContingency`, `classifyVerdict`, `statusForVerdict`, `ensureMirrorSignalDef`, `familyOf`, `bhFdrByFamily`, `computeSignalSeries`, `splitRawByActivation`, `computeTargetStrengthSeries`, `computeSeedActivationSeries`, `loadSignalDefsByIds`, `verifyUserLinks`, `computeStrengthCutpoints`<br>type: `SignalDirection`, `LinkLifecycleStatus`, `Verdict`, `DaySeries`, `SignalDef`, `Contingency`, `ContingencyVerification`, `LinkVerification`, `UserDataStarts`, `MirrorSignalOutcome`, `MirrorSignalResult`, `FdrFamily`, `SignalSeriesResult`, `StrengthCutpoint` |
| `pending-display.ts` | 337 | modify_db 확인 플로우에서 테이블별로 표시를 담당한다. | function: `formatAffectedRows`, `loadCurrentStateBlocks`, `extractTargetTable`, `extractAffectedDates`<br>type: `AffectedRow`, `DisplayGroup`, `CurrentStateContext` |
| `pending-modify.ts` | 75 |  | function: `createPendingModify`, `findActivePending`, `markExecuted`, `markCanceled`<br>type: `PendingModifyRow` |
| `period-forecast.ts` | 453 | 예측 장부 — 생성·채점·로드 (#531 / #523 Phase 3, ADR-0050). | function: `generateForecasts`, `scoreForecasts`, `loadLedger`<br>type: `LedgerPeriodType`, `ForecastSourceCell`, `NoCallReason`, `ForecastEntry`, `ScoredEntry`, `LedgerCardData`, `ForecastRange` |
| `period-interpretation.ts` | 788 | 기간 해석 엔진 — 월운/세운/대운 (#529 / #523 Phase 2, ADR-0050). | function: `derivePeriodContext`, `buildInterpretationPayload`, `composeNarrative`, `renderInterpretationBlocks`, `loadResponseProfileIndex`, `upsertInterpretation`, `loadLatestInterpretation`<br>const: `PERIOD_LABEL`<br>type: `PeriodType`, `ResponseProfileIndex`, `PeriodContext`, `MeasuredCell`, `TextbookCell`, `DescriptiveStats`, `InterpretationPayload`, `PeriodInterpretationRecord` |
| `personality.ts` | 17 | 통합 캐릭터 정의 — "잔소리꾼". | const: `CHARACTER_PROMPT` |
| `quantile.ts` | 69 | 분위수 컷 + 밴드 분류 순수 함수 — #477 P4a (ADR-0036). | function: `isBand`, `quantileSorted`, `tertileCuts`, `classifyBand`<br>type: `BandCuts`, `Band` |
| `rate-limiter.ts` | 64 | 인메모리 슬라이딩 윈도우 Rate Limiter | class: `RateLimiter`<br>type: `RateLimiterConfig` |
| `response-profile.ts` | 400 | 개인화 가중치 집계 레이어: saju_response_profile (#523 Phase 1, #408 5-B 구체화, ADR-0049). | function: `groupElement`, `mapSeedToCell`, `cellKey`, `buildResponseProfile`, `indexCells`, `resolveHierarchyCell`, `resolveElementBandCell`<br>type: `AxisLevel`, `CellTier`, `SeedForCell`, `PrimaryCell`, `ProfileLink`, `ResponseCell`, `ResolvedCell` |
| `saju-calendar.ts` | 1210 | 만세력 계산 유틸리티. | function: `getDayPillar`, `getYearPillar`, `getIpchunDate`, `getMonthPillar`, `getJeolgiMonthRange`, `isJeolgiTransitionDay`, `getSipsung`, `getJijiSipsung`, `getSipsungResult`, `getSibiunsung`, `getJijanggan`, `getRelations`, `calculateDailyFortune`, `calculateFortuneRange`, `getElementByCheongan`, `getElementByJiji`, `makePillar`, `parsePillarString`, `getDaeunPillar`<br>const: `CHEONGAN_HAP_RULES`, `JIJI_YUKHAP_RULES`, `JIJI_SAMHAP_RULES`, `JIJI_CHUNG_PAIRS`<br>type: `Cheongan`, `Jiji`, `Sipsung`, `Sibiunsung`, `Pillar`, `SipsungResult`, `JijangganEntry`, `Relations`, `DailyFortuneData`, `Element`, `PillarSet`, `StemHapRule`, `BranchHapRule` |
| `saju-hwa.ts` | 190 | 결정론 합화(合化) 변환 탐지 — #477 P4b (ADR-0038). | function: `isSipsinGroup`, `elementToSipsinGroup`, `detectHwaTransforms`<br>type: `SipsinGroup`, `HwaTransform`, `HwaResult` |
| `saju-mappings.ts` | 150 | 사주 십성 매핑 유틸리티 | function: `getSipsung`, `buildSipsungPrompt` |
| `saju-strength-params.ts` | 82 | 결정론 사주 실효강도 모델의 명리학 파라미터 — #477 P4a (ADR-0036). | const: `SAJU_STRENGTH_PARAMS`, `SAJU_HWA_PARAMS`<br>type: `SajuStrengthParams`, `HwaParams` |
| `saju-strength.ts` | 226 | 결정론 사주 실효강도 엔진 — #477 P4a (ADR-0036). | function: `isStrengthTarget`, `computeElementStrengths`, `computeStrengthForTarget`, `computeAbsoluteStrengthState`, `computeElementRatios`<br>type: `StrengthTarget`, `AbsoluteStrengthState`, `ElementStrengths` |
| `seed-saturation.ts` | 214 | 포화 시드 양방향 가드 (#508 P③, ADR-0046). | function: `isSaturated`, `isDesaturated`, `runSaturationSweep`<br>const: `SATURATION_REASON`<br>type: `SweepSeed`, `SaturationSweepResult` |
| `signal-defs.ts` | 106 | signal_defs 재생성 가드 — #557 (2026-07 감사 S7). | function: `findEquivalentSignal`<br>type: `SignalIdentity`, `EquivalentDecision` |
| `signal-sql-guard.ts` | 187 | LLM 신호 SQL 게이트 #1 — 정적 검증 (#477 P5b, ADR-0040). | function: `validateSignalSql`<br>const: `SIGNAL_ROW_CAP`, `SIGNAL_TABLE_WHITELIST` |
| `slack.ts` | 69 |  | function: `postToChannel`, `postBlockMessage`, `updateMessage`, `resolveActionCard`, `sendMessage`, `sendBlockMessage`, `sendThreadReply` |
| `sql-tools.ts` | 445 |  | function: `extractFirstKeyword`, `hasMultipleStatements`, `validateSelectQuery`, `hasWhereClause`, `validateModifyQuery`, `clearSchemaCache`, `validateUserIdFilter`, `validateCustomInstruction`, `setPostModifyHook`, `setConfirmCardSender`, `clearConfirmCardSender`, `executeSQLTool`<br>const: `SQL_TOOLS`<br>type: `PostModifyHook`, `SQLToolContext`, `ConfirmCardSender` |
| `stats.ts` | 353 | 순수 통계 알고리즘 (의존 없음) — #477 P2·P3 (ADR-0032 통계 스택). | function: `fisherExact`, `bhFdr`, `evalueTestMartingale`, `mannWhitneyU`, `hodgesLehmann`, `blockPermutationP`, `mantelHaenszelRR`<br>const: `DEFAULT_EVALUE_OPTIONS`<br>type: `DayObservation`, `EvalueOptions`, `MannWhitneyResult`, `Stratum2x2` |
| `user-resolver.ts` | 55 |  | function: `resolveUserId`, `queryAllUserMappings`<br>const: `DEFAULT_USER_ID`<br>type: `UserMapping` |

테스트 파일 30개

## `src/shared/life-signal-evaluators`

| 파일 | 줄 수 | 역할 | export |
| --- | ---: | --- | --- |
| `behavior-baseline.ts` | 53 | behavior_baseline evaluator — 11종 결정론 패턴 (insights.ts detect 함수 위임). | function: `evaluateBehaviorBaseline` |
| `calendar-event.ts` | 37 | calendar_event evaluator — 한국 공휴일 / 공휴일 다음날 / 자동이체일. | function: `evaluateCalendarEvent` |
| `index.ts` | 39 | life_signal trigger_aux.kind dispatcher (마스터 #434 Phase 3, ADR-0029). | function: `dispatchLifeSignal` |
| `korean-holidays.ts` | 29 | 한국 공휴일 정적 상수 (1차). | function: `isKoreanHoliday`<br>const: `KOREAN_HOLIDAYS` |
| `month-position.ts` | 31 | month_position evaluator — 월초 / 월말 / 월중 (KST 기준). | function: `evaluateMonthPosition` |
| `season.ts` | 25 | season evaluator — 양력 월 기반 4계절 (KST 기준). | function: `evaluateSeason` |
| `threshold.ts` | 89 | threshold evaluator — 임계치 풀셋 (수면 / 루틴 streak). | function: `evaluateThreshold` |
| `weekday.ts` | 25 | weekday / weekday_group evaluator. | function: `evaluateWeekday`, `evaluateWeekdayGroup` |

테스트 파일 6개
