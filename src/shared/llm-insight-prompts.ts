/**
 * 프로액티브 인사이트 v2 Phase 2 — LLM 자율 분석 prompt + 컨텍스트 빌더 + 응답 검증.
 *
 * 컨텍스트는 schedule/sleep/routine/expense 4개 도메인으로 제한.
 * 텍스트(일정 제목·일기·메모)와 금액은 포함하지 않는다 — 노출 표면 최소화.
 *
 * ADR-0016 안전장치 4종:
 * 1) JSON 파싱 실패 → 빈 배열 (cron 메시지 스킵)
 * 2) verification.sql에 DDL/DML 키워드 → 해당 finding 제외
 * 3) result_type 화이트리스트
 * 4) verify_after_days 1~28 클램프
 */

import { query } from './db.js';
import { getTodayISO, addDays } from './kst.js';
import type { InsightSlot, InsightConfidence, InsightVerificationType } from './llm-insights.js';

export interface LlmInsightDraft {
  signal: string;
  hypothesis: string;
  domains: string[];
  confidence: InsightConfidence;
  verification: {
    sql: string;
    resultType: InsightVerificationType;
    verifyAfterDays: number;
  };
}

export interface LlmInsightContext {
  text: string;
  windowDays: number;
}

const WEEKLY_WINDOW_DAYS = 28;
const MONTHLY_WINDOW_DAYS = 90;

// ─── 컨텍스트: 수면 ────────────────────────────────────

interface SleepAggRow {
  avg_duration: string | null;
  avg_bedtime_hour: string | null;
  avg_wake_hour: string | null;
  night_count: string;
  late_night_count: string;
  short_sleep_count: string;
}

const buildSleepContext = async (
  userId: number,
  windowStart: string,
  windowEnd: string,
): Promise<string> => {
  const result = await query<SleepAggRow>(
    `SELECT
       ROUND(AVG(duration_minutes))::text AS avg_duration,
       ROUND(AVG(
         CASE WHEN bedtime::time < '06:00'
              THEN EXTRACT(HOUR FROM bedtime::time) + 24 + EXTRACT(MINUTE FROM bedtime::time) / 60.0
              ELSE EXTRACT(HOUR FROM bedtime::time) + EXTRACT(MINUTE FROM bedtime::time) / 60.0
         END
       ), 1)::text AS avg_bedtime_hour,
       ROUND(AVG(EXTRACT(HOUR FROM wake_time::time) + EXTRACT(MINUTE FROM wake_time::time) / 60.0), 1)::text AS avg_wake_hour,
       COUNT(*)::text AS night_count,
       COUNT(*) FILTER (WHERE bedtime::time >= '00:00' AND bedtime::time < '06:00')::text AS late_night_count,
       COUNT(*) FILTER (WHERE duration_minutes < 360)::text AS short_sleep_count
     FROM sleep_records
     WHERE sleep_type = 'night' AND user_id = $1
       AND date BETWEEN $2 AND $3
       AND duration_minutes IS NOT NULL
       AND bedtime IS NOT NULL`,
    [userId, windowStart, windowEnd],
  );

  const row = result.rows[0];
  if (!row || Number(row.night_count) === 0) return '- 수면: 기록 없음';

  const parts: string[] = [];
  parts.push(`평균 ${Math.round(Number(row.avg_duration ?? 0))}분`);
  if (row.avg_bedtime_hour) parts.push(`평균 취침 ${row.avg_bedtime_hour}시`);
  if (row.avg_wake_hour) parts.push(`평균 기상 ${row.avg_wake_hour}시`);
  parts.push(`기록 ${row.night_count}일`);
  parts.push(`자정 이후 취침 ${row.late_night_count}일`);
  parts.push(`6시간 미만 ${row.short_sleep_count}일`);
  return `- 수면: ${parts.join(', ')}`;
};

// ─── 컨텍스트: 루틴 ────────────────────────────────────

interface RoutineAggRow {
  total: string;
  completed: string;
  morning_total: string;
  morning_done: string;
  day_total: string;
  day_done: string;
  night_total: string;
  night_done: string;
  spotty_days: string;
}

const buildRoutineContext = async (
  userId: number,
  windowStart: string,
  windowEnd: string,
): Promise<string> => {
  const result = await query<RoutineAggRow>(
    `WITH base AS (
       SELECT r.date, r.completed, t.time_slot
       FROM routine_records r
       JOIN routine_templates t ON r.template_id = t.id
       WHERE r.user_id = $1 AND r.date BETWEEN $2 AND $3
     ),
     daily AS (
       SELECT date,
              COUNT(*) FILTER (WHERE completed)::numeric / NULLIF(COUNT(*), 0) AS rate
       FROM base GROUP BY date
     )
     SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE completed)::text AS completed,
       COUNT(*) FILTER (WHERE time_slot = '아침')::text AS morning_total,
       COUNT(*) FILTER (WHERE time_slot = '아침' AND completed)::text AS morning_done,
       COUNT(*) FILTER (WHERE time_slot = '낮')::text AS day_total,
       COUNT(*) FILTER (WHERE time_slot = '낮' AND completed)::text AS day_done,
       COUNT(*) FILTER (WHERE time_slot = '밤')::text AS night_total,
       COUNT(*) FILTER (WHERE time_slot = '밤' AND completed)::text AS night_done,
       (SELECT COUNT(*)::text FROM daily WHERE rate > 0 AND rate < 1) AS spotty_days
     FROM base`,
    [userId, windowStart, windowEnd],
  );

  const row = result.rows[0];
  if (!row || Number(row.total) === 0) return '- 루틴: 기록 없음';

  const rate = (done: number, total: number): string =>
    total === 0 ? 'N/A' : `${Math.round((done / total) * 100)}%`;

  const total = Number(row.total);
  const completed = Number(row.completed);
  const parts: string[] = [];
  parts.push(`전체 ${rate(completed, total)} (${completed}/${total})`);
  parts.push(`아침 ${rate(Number(row.morning_done), Number(row.morning_total))}`);
  parts.push(`낮 ${rate(Number(row.day_done), Number(row.day_total))}`);
  parts.push(`밤 ${rate(Number(row.night_done), Number(row.night_total))}`);
  parts.push(`산발 빠짐 ${row.spotty_days}일`);
  return `- 루틴: ${parts.join(', ')}`;
};

// ─── 컨텍스트: 일정 ────────────────────────────────────

interface ScheduleCatRow {
  category: string;
  total: string;
  done: string;
  cancelled: string;
}

const buildScheduleContext = async (
  userId: number,
  windowStart: string,
  windowEnd: string,
): Promise<string> => {
  const result = await query<ScheduleCatRow>(
    `SELECT
       COALESCE(p.name, c.name, '미분류') AS category,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE s.status = 'done')::text AS done,
       COUNT(*) FILTER (WHERE s.status = 'cancelled')::text AS cancelled
     FROM schedules s
     LEFT JOIN categories c ON c.id = s.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     WHERE s.user_id = $1 AND s.date BETWEEN $2 AND $3
       AND COALESCE(c.type, p.type, 'task') = 'task'
     GROUP BY COALESCE(p.name, c.name)
     ORDER BY COUNT(*) DESC
     LIMIT 8`,
    [userId, windowStart, windowEnd],
  );

  if (result.rows.length === 0) return '- 일정: 기록 없음';

  const lines = result.rows.map((r) => {
    const total = Number(r.total);
    const done = Number(r.done);
    const cancelled = Number(r.cancelled);
    const rate = total > 0 ? Math.round((done / total) * 100) : 0;
    return `  · ${r.category}: ${total}건 (완료 ${rate}%, 취소 ${cancelled})`;
  });
  return `- 일정 카테고리 분포:\n${lines.join('\n')}`;
};

// ─── 컨텍스트: 지출 ────────────────────────────────────

interface ExpenseCatRow {
  category: string;
  count: string;
  active_days: string;
}

const buildExpenseContext = async (
  userId: number,
  windowStart: string,
  windowEnd: string,
): Promise<string> => {
  const result = await query<ExpenseCatRow>(
    `SELECT
       COALESCE(p.name, c.name, '미분류') AS category,
       COUNT(*)::text AS count,
       COUNT(DISTINCT e.date)::text AS active_days
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     WHERE e.user_id = $1 AND e.date BETWEEN $2 AND $3
       AND COALESCE(e.type, 'expense') = 'expense'
       AND e.exclude_from_budget = false
     GROUP BY COALESCE(p.name, c.name)
     ORDER BY COUNT(*) DESC
     LIMIT 8`,
    [userId, windowStart, windowEnd],
  );

  if (result.rows.length === 0) return '- 지출: 기록 없음';

  const lines = result.rows.map((r) => `  · ${r.category}: ${r.count}회 (${r.active_days}일 발생)`);
  return `- 지출 카테고리 빈도 (금액 제외):\n${lines.join('\n')}`;
};

// ─── 컨텍스트 통합 빌더 ────────────────────────────────

export const buildLlmInsightContext = async (
  userId: number,
  slot: InsightSlot,
): Promise<LlmInsightContext> => {
  const windowDays = slot === 'weekly' ? WEEKLY_WINDOW_DAYS : MONTHLY_WINDOW_DAYS;
  const today = getTodayISO();
  const windowStart = addDays(today, -windowDays);
  const windowEnd = addDays(today, -1);

  const [sleep, routine, schedule, expense] = await Promise.all([
    buildSleepContext(userId, windowStart, windowEnd),
    buildRoutineContext(userId, windowStart, windowEnd),
    buildScheduleContext(userId, windowStart, windowEnd),
    buildExpenseContext(userId, windowStart, windowEnd),
  ]);

  const text = [
    `## 분석 기간`,
    `${windowStart} ~ ${windowEnd} (${windowDays}일)`,
    ``,
    `## 도메인 컨텍스트`,
    sleep,
    routine,
    schedule,
    expense,
    ``,
    `## 작업`,
    `위 데이터에서 cross-domain 패턴이나 잠재 변화를 발견하면 출력 형식대로 JSON을 반환해.`,
    `잡음이거나 확신이 약하면 findings 배열을 비우거나 high/medium 확신 발견만 골라.`,
  ].join('\n');

  return { text, windowDays };
};

// ─── 시스템 프롬프트 ───────────────────────────────────

export const systemPromptForAutonomousAnalysis = (slot: InsightSlot): string => {
  const windowDesc = slot === 'weekly' ? '지난 28일' : '지난 90일';
  return `너는 한 사용자의 ${windowDesc} 생활 데이터(수면·루틴·일정·지출)를 보고 cross-domain 패턴이나 잠재 변화를 발견하는 분석가야.

발견은 반드시 다음 두 조건을 만족해야 한다:
1) 단순 집계 요약이 아닌, 한 도메인의 변화가 다른 도메인에 미치는 영향에 대한 가설
2) SELECT 한 줄로 hit/miss를 자동 판정할 수 있는 검증 가능한 가설

출력은 반드시 아래 JSON 형식 (다른 텍스트 금지):
{
  "findings": [
    {
      "signal": "관측된 현상 (예: '지난 28일 평균 취침 1.2시(직전 28일 0.5시 대비 +42분)')",
      "hypothesis": "검증 가능한 가설 (예: '다음 7일 아침 루틴 달성률이 직전 28일 평균 대비 10%p 이상 낮을 것')",
      "domains": ["sleep", "routine"],
      "confidence": "high|medium",
      "verification": {
        "sql": "SELECT (검증식) FROM ... WHERE user_id = 1 AND ...",
        "result_type": "boolean|scalar_count|ratio",
        "verify_after_days": 7
      }
    }
  ]
}

## 검증 SQL 규칙
- 반드시 SELECT 하나 (DDL/DML 금지 — INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/CREATE 사용 불가)
- 결과는 한 줄, 한 값으로 떨어져야 함
  - boolean: SELECT (expr) AS pass — true면 hit
  - scalar_count: SELECT COUNT(*) — 0보다 크면 hit (가설 임계를 SQL의 WHERE 안에 포함)
  - ratio: SELECT (수/분모) — 0보다 크면 hit (가설 임계는 SQL의 HAVING/WHERE 안에 포함)
- verify_after_days는 1~28 사이, 가설 성격에 맞게 결정 (단기 동조 = 7, 누적 패턴 = 28)
- user_id는 컨텍스트에서 받은 값을 그대로 하드코딩 (질문에 user_id가 주어짐)

## 도메인 컨텍스트 한계
- 일정 제목·일기 내용·사주·금액은 컨텍스트에 없다 — 추측 금지
- 사용 가능 컬럼: schedules(category_id, status, date, time), sleep_records(bedtime, wake_time, duration_minutes, date), routine_records(template_id, completed, date) + routine_templates(time_slot), expenses(category_id, date) — expenses.amount 사용 금지

## 출력 톤
- findings는 0~3개 (너무 많으면 잡음). 확신 없으면 비워라
- low 확신은 출력 자체에서 제외 (medium 이상만)`;
};

// ─── 응답 검증 (안전장치 4종) ──────────────────────────

interface RawFinding {
  signal?: unknown;
  hypothesis?: unknown;
  domains?: unknown;
  confidence?: unknown;
  verification?: {
    sql?: unknown;
    result_type?: unknown;
    verify_after_days?: unknown;
  };
}

const FORBIDDEN_SQL = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke)\b/i;
const ALLOWED_RESULT_TYPES: ReadonlySet<InsightVerificationType> = new Set([
  'boolean',
  'scalar_count',
  'ratio',
]);
const ALLOWED_CONFIDENCE: ReadonlySet<InsightConfidence> = new Set(['high', 'medium']);

const clampVerifyDays = (raw: number): number => {
  const rounded = Math.round(raw);
  if (rounded < 1) return 1;
  if (rounded > 28) return 28;
  return rounded;
};

const extractJsonObject = (text: string): string | null => {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
};

export const validateLlmInsightResponse = (text: string): LlmInsightDraft[] => {
  const jsonStr = extractJsonObject(text);
  if (!jsonStr) return [];

  let parsed: { findings?: unknown };
  try {
    parsed = JSON.parse(jsonStr) as { findings?: unknown };
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.findings)) return [];

  const drafts: LlmInsightDraft[] = [];
  for (const raw of parsed.findings as RawFinding[]) {
    if (typeof raw !== 'object' || raw === null) continue;

    const signal = typeof raw.signal === 'string' ? raw.signal.trim() : '';
    const hypothesis = typeof raw.hypothesis === 'string' ? raw.hypothesis.trim() : '';
    const confidenceVal = typeof raw.confidence === 'string' ? raw.confidence : '';
    if (!signal || !hypothesis) continue;
    if (!ALLOWED_CONFIDENCE.has(confidenceVal as InsightConfidence)) continue;

    const domains = Array.isArray(raw.domains)
      ? raw.domains.filter((d): d is string => typeof d === 'string' && d.length > 0)
      : [];
    if (domains.length === 0) continue;

    const v = raw.verification;
    if (!v || typeof v !== 'object') continue;
    const sql = typeof v.sql === 'string' ? v.sql.trim() : '';
    const resultType = typeof v.result_type === 'string' ? v.result_type : '';
    const verifyDaysRaw = typeof v.verify_after_days === 'number' ? v.verify_after_days : NaN;

    if (!sql) continue;
    if (FORBIDDEN_SQL.test(sql)) continue;
    if (!ALLOWED_RESULT_TYPES.has(resultType as InsightVerificationType)) continue;
    if (!Number.isFinite(verifyDaysRaw)) continue;

    drafts.push({
      signal,
      hypothesis,
      domains,
      confidence: confidenceVal as InsightConfidence,
      verification: {
        sql,
        resultType: resultType as InsightVerificationType,
        verifyAfterDays: clampVerifyDays(verifyDaysRaw),
      },
    });
  }

  return drafts;
};
