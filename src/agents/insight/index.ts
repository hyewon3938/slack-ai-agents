import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import { runAgentLoop } from '../../shared/agent-loop.js';
import { sendMessage } from '../../shared/slack.js';
import { SQL_TOOLS, executeSQLTool } from '../../shared/sql-tools.js';
import { ChatHistory } from '../../shared/chat-history.js';
import { buildInsightSystemPrompt } from './prompt.js';
import { queryOne } from '../../shared/db.js';
import { getTodayISO } from '../../shared/kst.js';

// ─── fast path 패턴 ──────────────────────────────────

/** 일운 조회: "일운", "오늘 일운", "일운 보여줘" 등 */
const DAILY_FORTUNE_RE = /^(오늘\s*)?일운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/;
/** 월운 조회 */
const MONTHLY_FORTUNE_RE = /^(이번\s*달?\s*)?월운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/;
/** 세운 조회 */
const YEARLY_FORTUNE_RE = /^(올해\s*)?세운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/;
/** 대운 조회 */
const MAJOR_FORTUNE_RE = /^(내\s*)?대운(\s*(보여줘|보여|알려줘|뭐야))?[.?!]?$/;

interface FortuneRow {
  date: string;
  period: string;
  day_pillar: string | null;
  analysis: string;
  summary: string;
  warnings: unknown;
  recommendations: unknown;
  advice: string | null;
}

/** fortune_analyses 조회 → Slack mrkdwn 포맷 */
const formatFortune = (row: FortuneRow): string => {
  const parts: string[] = [];
  if (row.analysis) parts.push(row.analysis);
  return parts.join('\n\n');
};

/** fast path 운세 조회 시도. 매칭되면 응답 전송 후 true 반환. */
const tryFortuneFastPath = async (
  trimmed: string,
  say: Parameters<AgentHandler>[1],
): Promise<boolean> => {
  let sql: string;
  let params: unknown[];
  let label: string;

  if (DAILY_FORTUNE_RE.test(trimmed)) {
    const today = getTodayISO();
    sql = `SELECT date, period, day_pillar, analysis, summary, warnings, recommendations, advice
           FROM fortune_analyses WHERE user_id = 1 AND period = 'daily' AND date = $1`;
    params = [today];
    label = '오늘 일운';
  } else if (MONTHLY_FORTUNE_RE.test(trimmed)) {
    const today = getTodayISO();
    const monthFirst = today.slice(0, 7) + '-01';
    sql = `SELECT date, period, day_pillar, analysis, summary, warnings, recommendations, advice
           FROM fortune_analyses WHERE user_id = 1 AND period = 'monthly' AND date = $1`;
    params = [monthFirst];
    label = '이번 달 월운';
  } else if (YEARLY_FORTUNE_RE.test(trimmed)) {
    const today = getTodayISO();
    const yearFirst = today.slice(0, 4) + '-01-01';
    sql = `SELECT date, period, day_pillar, analysis, summary, warnings, recommendations, advice
           FROM fortune_analyses WHERE user_id = 1 AND period = 'yearly' AND date = $1`;
    params = [yearFirst];
    label = '올해 세운';
  } else if (MAJOR_FORTUNE_RE.test(trimmed)) {
    sql = `SELECT date, period, day_pillar, analysis, summary, warnings, recommendations, advice
           FROM fortune_analyses WHERE user_id = 1 AND period = 'major'
           ORDER BY date DESC LIMIT 1`;
    params = [];
    label = '대운';
  } else {
    return false;
  }

  try {
    const row = await queryOne<FortuneRow>(sql, params);
    if (!row) {
      await sendMessage(say, `아직 ${label} 분석이 준비되지 않았어.`);
    } else {
      await sendMessage(say, formatFortune(row));
    }
  } catch (error: unknown) {
    console.error(`[Insight Agent] ${label} fast path 오류:`, error);
    await sendMessage(say, `${label} 조회 중 오류가 발생했어.`);
  }
  return true;
};

// ─── 에이전트 ─────────────────────────────────────────

/**
 * Insight 에이전트 생성.
 * 명리학 일운 분석 조회 + 일기/고민 자동 기록 + 삶의 테마 관리.
 * 운세 조회(일운/월운/세운/대운)는 fast path로 즉시 응답.
 */
export const createInsightAgent = (llmClient: LLMClient): AgentHandler => {
  const history = new ChatHistory();

  return async (message, say) => {
    const text = 'text' in message ? (message.text ?? '') : '';
    if (!text.trim()) return;

    const channelId = message.channel;
    const trimmed = text.trim();

    // ── fast path: 운세 조회 ──
    if (await tryFortuneFastPath(trimmed, say)) return;

    // ── LLM 에이전트 루프 ──
    try {
      const result = await runAgentLoop(
        llmClient,
        text,
        {
          label: 'Insight Agent',
          buildSystemPrompt: () => buildInsightSystemPrompt(),
          getTools: async () => SQL_TOOLS,
          executeToolCall: executeSQLTool,
          historyMessages: history.toMessages(channelId),
        },
      );

      await sendMessage(say, result.text);
      history.add(channelId, text, result.text);
    } catch (error: unknown) {
      console.error('[Insight Agent] 오류:', error);
      await sendMessage(say, '오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
