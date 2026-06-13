/**
 * 주기 운세 리포트 데일리 게이트 — periodFortune (#529 / #523 Phase 2, ADR-0050).
 *
 * 매일 08:20 KST, 절기 전환·입춘·대운 전환을 **독립적으로** 감지해(else-if 아님) 월운/세운/대운
 * 카드를 #insight로 발송한다. 입춘은 인월 전환(절기 전환)이자 새해 시작 → 월운+세운이 같은 날 동시 발생.
 * 전환 없는 평일은 no-op(일별 카드는 daily-insight SKILL 소관).
 *
 * 대운 전환: 만 나이는 단조 증가 → 전환은 항상 null→pillar 또는 pillar→pillar(전부 non-null 결과).
 *   "대운 정보 없어" 안내는 조회(fast path) 책임 — cron은 실제 전환에만 카드를 보낸다(평일 no-op 보존).
 *
 * 검증가능성 사다리·전이 가설 hedge·measured=0 일급 경로는 period-interpretation.ts(렌더/서사)가 담당.
 */

import type { App } from '@slack/bolt';
import {
  getMonthPillar,
  getYearPillar,
  getIpchunDate,
  getJeolgiMonthRange,
  isJeolgiTransitionDay,
  getDaeunPillar,
  type Pillar,
} from '../shared/saju-calendar.js';
import { getTodayISO, addDays } from '../shared/kst.js';
import { loadNatalContext, type NatalContext } from '../shared/pattern-match.js';
import {
  derivePeriodContext,
  buildInterpretationPayload,
  composeNarrative,
  renderInterpretationBlocks,
  loadResponseProfileIndex,
  upsertInterpretation,
  PERIOD_LABEL,
  type PeriodType,
  type ResponseProfileIndex,
  type PeriodInterpretationRecord,
} from '../shared/period-interpretation.js';
import {
  scoreForecasts,
  generateForecasts,
  type LedgerCardData,
} from '../shared/period-forecast.js';
import { postBlockMessage } from '../shared/slack.js';
import { createPeriodLLMClient, type LLMClient } from '../shared/llm.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import type { LifeCronConfig } from './life-cron.js';

/** 오늘 발사할 주기 트리거 1건 — 결정론(DB·LLM 무관). */
export interface PeriodTrigger {
  periodType: PeriodType;
  pillar: Pillar;
  periodStart: string;
  periodEnd: string | null;
}

/**
 * 오늘 발사할 주기 트리거 결정 — 절기/입춘/대운 **독립 3검사**. 순수 함수(테스트 용이).
 * 입춘날은 월운(절기 전환)+세운(새해)이 동시에 잡힌다. 전환 없으면 빈 배열(평일 no-op).
 * (절기 테이블 범위 밖 연도는 isJeolgiTransitionDay/getIpchunDate가 throw — 호출부에서 격리.)
 */
export const decidePeriodTriggers = (
  today: string,
  natal: Pick<NatalContext, 'birthDate' | 'daewunList'>,
): PeriodTrigger[] => {
  const triggers: PeriodTrigger[] = [];
  const year = Number(today.slice(0, 4));

  // 1. 절기 전환 → 월운 (입춘도 절기 전환이므로 여기 포함)
  if (isJeolgiTransitionDay(today)) {
    const range = getJeolgiMonthRange(today);
    triggers.push({
      periodType: 'wolun',
      pillar: getMonthPillar(today),
      periodStart: range.start,
      periodEnd: range.end,
    });
  }

  // 2. 입춘 → 세운 (월운과 독립 — 같은 날 동시 발생)
  if (today === getIpchunDate(year)) {
    // 다음 입춘 전날 = 세운 끝. 다음 해가 절기 테이블 범위 밖이면 끝 미정(null).
    const seunEnd = ((): string | null => {
      try {
        return addDays(getIpchunDate(year + 1), -1);
      } catch {
        return null;
      }
    })();
    triggers.push({
      periodType: 'seun',
      pillar: getYearPillar(today),
      periodStart: today,
      periodEnd: seunEnd,
    });
  }

  // 3. 대운 전환 (어제 대운 ≠ 오늘 대운). 만 나이 단조 → 전환 결과는 항상 non-null.
  if (natal.birthDate) {
    const dToday = getDaeunPillar(natal.birthDate, natal.daewunList, today);
    const dYest = getDaeunPillar(natal.birthDate, natal.daewunList, addDays(today, -1));
    if (dToday && (dYest?.hangul ?? '') !== dToday.hangul) {
      triggers.push({
        periodType: 'daeun',
        pillar: dToday,
        periodStart: today,
        periodEnd: null, // 대운 끝은 다음 전환 시점 — 동결 안 함
      });
    }
  }

  return triggers;
};

/** 트리거 1건 → 도출·payload·서사·영속·발송. */
const generateAndPost = async (
  app: App,
  channelId: string,
  userId: number,
  natal: NatalContext,
  index: ResponseProfileIndex,
  llmClient: LLMClient,
  trigger: PeriodTrigger,
  today: string,
): Promise<void> => {
  const ctx = derivePeriodContext(natal, trigger.pillar, trigger.periodType);
  const payload = await buildInterpretationPayload(
    ctx,
    index,
    natal,
    { start: trigger.periodStart, end: trigger.periodEnd },
    userId,
    today,
  );
  const narrative = await composeNarrative(llmClient, payload, ctx, trigger.periodType);
  const record: PeriodInterpretationRecord = {
    periodType: trigger.periodType,
    pillar: trigger.pillar.hangul,
    periodStart: trigger.periodStart,
    periodEnd: trigger.periodEnd,
    payload,
    narrative,
  };
  await upsertInterpretation(userId, record);

  // 예측 장부(Phase 3) — wolun/seun만. ①직전 open 채점 → ③이번 기간 사전등록 → ④카드 장부 섹션.
  // 장부 실패는 격리(해석 카드는 항상 발송 — 출력 연속성 D8). daeun·세운 끝미정(periodEnd null)은 비편입.
  let ledger: LedgerCardData | undefined;
  if (
    (trigger.periodType === 'wolun' || trigger.periodType === 'seun') &&
    trigger.periodEnd !== null
  ) {
    const ledgerType = trigger.periodType;
    const periodEnd = trigger.periodEnd;
    try {
      const scored = await scoreForecasts(userId, ledgerType, today);
      const forecasts = await generateForecasts(
        userId,
        ledgerType,
        { start: trigger.periodStart, end: periodEnd },
        payload.measuredCells,
      );
      ledger = { periodType: ledgerType, scored, forecasts };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Period Fortune] user=${userId} ${ledgerType} 장부 실패: ${msg}`);
    }
  }

  const blocks = renderInterpretationBlocks(record, ledger);
  await postBlockMessage(
    app.client,
    channelId,
    `${PERIOD_LABEL[trigger.periodType]} (${trigger.pillar.hangul})`,
    blocks,
  );
};

/** 한 유저의 오늘 주기 게이트 처리 (유저별 에러는 호출부에서 격리). */
const processUser = async (
  app: App,
  userId: number,
  channelId: string,
  today: string,
  llmClient: LLMClient,
): Promise<void> => {
  const natal = await loadNatalContext(userId);
  if (!natal) return; // 사주 프로필 미등록 → 해석 불가
  const triggers = decidePeriodTriggers(today, natal);
  if (triggers.length === 0) return; // 평일 no-op

  const index = await loadResponseProfileIndex(userId);
  for (const trigger of triggers) {
    await generateAndPost(app, channelId, userId, natal, index, llmClient, trigger, today);
    console.warn(
      `[Period Fortune] user=${userId} ${trigger.periodType} ${trigger.pillar.hangul} 발송`,
    );
  }
};

/**
 * 데일리 슬롯 본체 — SLOT_TASKS['periodFortune']. 매일 08:20 KST.
 * (insight 채널 해석은 discovery-recommend/weekly-verification 패턴 미러.)
 */
export const periodFortuneTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const mappings = await queryAllUserMappings();
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;
  // 기간 서사는 Opus(저빈도 — 절기 전환 시에만 호출, #533). 나머지 크론은 config.llmClient(Sonnet).
  const periodLlmClient = await createPeriodLLMClient();

  if (mappings.length === 0) {
    if (!insightFallback) return;
    try {
      await processUser(app, DEFAULT_USER_ID, insightFallback, today, periodLlmClient);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Period Fortune] 폴백 실행 실패: ${msg}`);
    }
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.insightChannelId ?? insightFallback;
    if (!channelId) continue;
    try {
      await processUser(app, mapping.userId, channelId, today, periodLlmClient);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Period Fortune] user=${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};
