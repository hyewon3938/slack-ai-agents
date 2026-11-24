/**
 * Insight 에이전트 — 운세 조회 fast path.
 * 월/세/대운은 저장된 기간 해석을, 일운은 fortune_analyses를 LLM 없이 바로 보여준다.
 */

import type { AgentHandler } from '../../router.js';
import { sendMessage, sendBlockMessage } from '../../shared/slack.js';
import { queryOne } from '../../shared/db.js';
import { getTodayISO, addDays } from '../../shared/kst.js';
import { formatFortuneText } from '../../shared/fortune-format.js';
import { loadLatestInterpretation } from '../../shared/period/interpretation-store.js';
import { renderInterpretationBlocks } from '../../shared/period/interpretation-render.js';
import { PERIOD_LABEL } from '../../shared/period/interpretation-labels.js';
import { type PeriodType } from '../../shared/period/types.js';
import { loadLedger } from '../../shared/period/forecast-ledger.js';

/** 일운 조회: "일운", "오늘 일운", "일운 보여줘" 등 */
const DAILY_FORTUNE_RE = /^(오늘\s*)?일운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/;
/** 월운 조회 */
const MONTHLY_FORTUNE_RE = /^(이번\s*달?\s*)?월운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/;
/** 세운 조회 */
const YEARLY_FORTUNE_RE = /^(올해\s*)?세운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/;
/** 내일 일운 조회: "내일 일운", "내일 일운 보여줘" 등 */
const TOMORROW_FORTUNE_RE = /^내일\s*일운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/;
/** 대운 조회 */
const MAJOR_FORTUNE_RE = /^(내\s*)?대운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/;

interface FortuneRow {
  date: string;
  period: string;
  day_pillar: string | null;
  analysis: string;
  summary: string | null;
  warnings: unknown;
  recommendations: unknown;
  advice: string | null;
}

/**
 * 기간 해석 fast path (#529 Phase 2 / #533 단일화) — 저장된 해석을 LLM 없이 즉시 렌더.
 * 월/세/대운의 정확일치·접미·접두형을 전부 이 경로(period_interpretations + 장부)로 단일화.
 * ⚠️ 순서 의존: tryFortuneFastPath(일운 전용)보다 먼저 평가해야 월/세/대운이 신 경로로 간다.
 * 매칭되면 응답 전송 후 true. 행 없으면 안내(다음 전환 때 생성됨) 후 true.
 */
export const tryPeriodInterpretationFastPath = async (
  trimmed: string,
  say: Parameters<AgentHandler>[1],
  userId: number,
): Promise<boolean> => {
  let periodType: PeriodType;
  if (MONTHLY_FORTUNE_RE.test(trimmed)) periodType = 'wolun';
  else if (YEARLY_FORTUNE_RE.test(trimmed)) periodType = 'seun';
  else if (MAJOR_FORTUNE_RE.test(trimmed)) periodType = 'daeun';
  else return false;

  const label = PERIOD_LABEL[periodType];
  try {
    const record = await loadLatestInterpretation(userId, periodType);
    if (!record) {
      const when =
        periodType === 'wolun'
          ? '다음 절기 전환'
          : periodType === 'seun'
            ? '다음 입춘'
            : '다음 대운 전환';
      await sendMessage(say, `아직 ${label} 해석이 없어. ${when} 때 만들어서 보내줄게.`);
      return true;
    }
    // 장부 동봉(Phase 3) — wolun/seun만. daeun은 비편입(ledger undefined → 기존 동작).
    const ledger =
      periodType === 'wolun' || periodType === 'seun'
        ? await loadLedger(userId, periodType)
        : undefined;
    await sendBlockMessage(
      say,
      `${label} (${record.pillar})`,
      renderInterpretationBlocks(record, ledger),
    );
  } catch (error: unknown) {
    console.error(`[Insight Agent] ${label} 해석 fast path 오류:`, error);
    await sendMessage(say, `${label} 조회 중 오류가 발생했어.`);
  }
  return true;
};

/** fast path 일운 조회 시도 (#533: 월/세/대운은 신 경로로 이관 — 여기는 일운만). 매칭되면 응답 전송 후 true. */
export const tryFortuneFastPath = async (
  trimmed: string,
  say: Parameters<AgentHandler>[1],
  userId: number,
): Promise<boolean> => {
  let sql: string;
  let params: unknown[];
  let label: string;

  if (DAILY_FORTUNE_RE.test(trimmed)) {
    const today = getTodayISO();
    sql = `SELECT date, period, day_pillar, analysis, summary, warnings, recommendations, advice
           FROM fortune_analyses WHERE user_id = $1 AND period = 'daily' AND date = $2`;
    params = [userId, today];
    label = '오늘 일운';
  } else if (TOMORROW_FORTUNE_RE.test(trimmed)) {
    const tomorrow = addDays(getTodayISO(), 1);
    sql = `SELECT date, period, day_pillar, analysis, summary, warnings, recommendations, advice
           FROM fortune_analyses WHERE user_id = $1 AND period = 'daily' AND date = $2`;
    params = [userId, tomorrow];
    label = '내일 일운';
  } else {
    return false;
  }

  try {
    const row = await queryOne<FortuneRow>(sql, params);
    if (!row) {
      await sendMessage(say, `아직 ${label} 분석이 준비되지 않았어.`);
    } else {
      await sendMessage(say, formatFortuneText(row));
    }
  } catch (error: unknown) {
    console.error(`[Insight Agent] ${label} fast path 오류:`, error);
    await sendMessage(say, `${label} 조회 중 오류가 발생했어.`);
  }
  return true;
};
