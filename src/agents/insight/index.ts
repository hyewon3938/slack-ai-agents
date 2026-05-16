import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import { sendMessage } from '../../shared/slack.js';
import { queryOne } from '../../shared/db.js';
import { getTodayISO, getEffectiveTodayISO, addDays } from '../../shared/kst.js';
import { resolveUserId, DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import { saveDiaryEntry, pickDiaryConfirmation, naturalDelay } from './diary-fast-path.js';
import { tryLlmInsightFastPath } from './llm-insight-fast-path.js';
import { formatFortuneText } from '../../shared/fortune-format.js';

// ─── fast path 패턴 ──────────────────────────────────

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
/** 오늘 일기 조회 */
const TODAY_DIARY_RE = /^오늘\s*일기/;

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

/** fast path 운세 조회 시도. 매칭되면 응답 전송 후 true 반환. */
const tryFortuneFastPath = async (
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
  } else if (MONTHLY_FORTUNE_RE.test(trimmed)) {
    const today = getTodayISO();
    const monthFirst = today.slice(0, 7) + '-01';
    sql = `SELECT date, period, day_pillar, analysis, summary, warnings, recommendations, advice
           FROM fortune_analyses WHERE user_id = $1 AND period = 'monthly' AND date = $2`;
    params = [userId, monthFirst];
    label = '이번 달 월운';
  } else if (YEARLY_FORTUNE_RE.test(trimmed)) {
    const today = getTodayISO();
    const yearFirst = today.slice(0, 4) + '-01-01';
    sql = `SELECT date, period, day_pillar, analysis, summary, warnings, recommendations, advice
           FROM fortune_analyses WHERE user_id = $1 AND period = 'yearly' AND date = $2`;
    params = [userId, yearFirst];
    label = '올해 세운';
  } else if (MAJOR_FORTUNE_RE.test(trimmed)) {
    sql = `SELECT date, period, day_pillar, analysis, summary, warnings, recommendations, advice
           FROM fortune_analyses WHERE user_id = $1 AND period = 'major'
           ORDER BY date DESC LIMIT 1`;
    params = [userId];
    label = '대운';
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

/** 오늘 일기 조회 fast path */
const showTodayDiary = async (say: Parameters<AgentHandler>[1], userId: number): Promise<void> => {
  const today = getEffectiveTodayISO();
  try {
    const row = await queryOne<{ content: string }>(
      `SELECT content FROM diary_entries WHERE user_id = $1 AND date = $2`,
      [userId, today],
    );
    if (!row) {
      await sendMessage(say, '아직 오늘 일기가 없어.');
    } else {
      await sendMessage(say, `*오늘의 일기 (${today})*\n${row.content}`);
    }
  } catch (error: unknown) {
    console.error('[Insight Agent] 일기 조회 오류:', error);
    await sendMessage(say, '일기 조회 중 오류가 발생했어.');
  }
};

// ─── 에이전트 ─────────────────────────────────────────

/**
 * Insight 에이전트 생성.
 * 일기 자동 저장 + 운세 조회 fast path + 오늘 일기 조회.
 * LLM 에이전트 루프 없음 — 모든 비명령 메시지는 일기로 저장.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createInsightAgent = (_llmClient: LLMClient): AgentHandler => {
  return async (message, say) => {
    const text = 'text' in message ? (message.text ?? '') : '';
    if (!text.trim()) return;

    const trimmed = text.trim();

    // Slack user → DB userId 해석
    const slackUserId = ('user' in message ? message.user : undefined) ?? '';
    const resolvedUserId = slackUserId ? await resolveUserId(slackUserId) : null;
    if (resolvedUserId === null && slackUserId) {
      console.warn(
        `[Insight Agent] slack_user_mappings 미등록: ${slackUserId} → DEFAULT_USER_ID 폴백`,
      );
    }
    const userId = resolvedUserId ?? DEFAULT_USER_ID;

    // ── fast path: 운세 조회 ──
    if (await tryFortuneFastPath(trimmed, say, userId)) return;

    // ── fast path: LLM 자율 발견 조회 ──
    if (await tryLlmInsightFastPath(trimmed, say, userId)) return;

    // ── fast path: 오늘 일기 조회 ──
    if (TODAY_DIARY_RE.test(trimmed)) {
      await showTodayDiary(say, userId);
      return;
    }

    // ── 기본: 일기 저장 (어떤 단어든 무조건 일기로 저장) ──
    try {
      await saveDiaryEntry(userId, text.trim());
      await naturalDelay();
      await sendMessage(say, pickDiaryConfirmation());
    } catch (error: unknown) {
      console.error('[Insight Agent] 일기 저장 실패:', error);
      await sendMessage(say, '일기 저장 중 오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
