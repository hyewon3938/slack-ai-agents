import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import { sendMessage, sendBlockMessage } from '../../shared/slack.js';
import { query, queryOne } from '../../shared/db.js';
import { getTodayISO, getEffectiveTodayISO, addDays } from '../../shared/kst.js';
import { resolveUserId, DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import { saveDiaryEntry, pickDiaryConfirmation, naturalDelay } from './diary-fast-path.js';
import { tryPatternSeedFastPath } from './pattern-seed-fast-path.js';
import { formatFortuneText } from '../../shared/fortune-format.js';
import {
  loadLatestInterpretation,
  renderInterpretationBlocks,
  PERIOD_LABEL,
  type PeriodType,
} from '../../shared/period-interpretation.js';
import { loadLedger } from '../../shared/period-forecast.js';

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
/** LLM 매트릭 pending 목록 조회 (ADR-0030 디버깅·놓친 카드 재확인용) */
const METRIC_LIST_RE = /^\/?insight\s+metric-list[.?!]?$/;

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
const tryPeriodInterpretationFastPath = async (
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

/** pending 후보 목록 조회 fast path (ADR-0030 → #477 P1: pending pattern_links 기반) */
const showPendingMetrics = async (
  say: Parameters<AgentHandler>[1],
  userId: number,
): Promise<void> => {
  try {
    const res = await query<{
      id: number;
      description: string;
      proposed_at: string;
      seed_name: string | null;
    }>(
      `SELECT l.id,
              COALESCE(NULLIF(s.description, ''), s.name) AS description,
              l.created_at::text AS proposed_at,
              seed.name AS seed_name
         FROM pattern_links l
         JOIN signal_defs s ON s.id = l.signal_id
         JOIN pattern_catalog seed ON seed.id = l.seed_id
        WHERE l.user_id = $1 AND l.status = 'pending'
        ORDER BY l.created_at DESC
        LIMIT 20`,
      [userId],
    );
    if (res.rows.length === 0) {
      await sendMessage(say, '대기 중인 매트릭 후보가 없어.');
      return;
    }
    const lines = res.rows.map((r) => {
      const dateStr = r.proposed_at.slice(0, 10);
      const seedPart = r.seed_name ? ` · ${r.seed_name}` : '';
      return `#${r.id} ${r.description}${seedPart} (${dateStr})`;
    });
    await sendMessage(say, ['*pending 매트릭 후보*', ...lines].join('\n'));
  } catch (error: unknown) {
    console.error('[Insight Agent] metric-list 조회 오류:', error);
    await sendMessage(say, '매트릭 목록 조회 중 오류가 발생했어.');
  }
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

    // ── fast path: 기간 해석 정확일치 (월운/세운/대운) — 접미형보다 먼저 (#529) ──
    if (await tryPeriodInterpretationFastPath(trimmed, say, userId)) return;

    // ── fast path: 운세 조회 (접미·접두형 → fortune_analyses 하위 호환) ──
    if (await tryFortuneFastPath(trimmed, say, userId)) return;

    // ── fast path: 사주 시드 토글 ──
    if (await tryPatternSeedFastPath(trimmed, say, userId)) return;

    // ── fast path: 오늘 일기 조회 ──
    if (TODAY_DIARY_RE.test(trimmed)) {
      await showTodayDiary(say, userId);
      return;
    }

    // ── fast path: LLM 매트릭 pending 목록 (ADR-0030) ──
    if (METRIC_LIST_RE.test(trimmed)) {
      await showPendingMetrics(say, userId);
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
