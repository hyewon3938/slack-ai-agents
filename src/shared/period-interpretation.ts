/**
 * 기간 해석 엔진 — 월운/세운/대운 (#529 / #523 Phase 2, ADR-0050).
 *
 * 일운 집계 레이어(saju_response_profile)를 상위 주기 해석으로 잇는다:
 *   결정론 도출(기간 pillar → 십성·오행·합충)
 *     → 개인화 프로필 조인 payload { measuredCells, textbookCells, descriptiveStats }
 *     → LLM 서사(측정/교과서 분리 발화 + 전이 가설 hedge)
 *     → 결정론 렌더(cron·fast path 공용).
 *
 * 검증가능성 사다리(ADR-0050): 월운=축적-실증 / 세운=장부한정 약실증 / 대운=비실증 추론.
 *   단위가 커질수록 표본이 줄어 통계 확정 가능성이 떨어진다 → 각 층의 지위를 라벨로 동반한다.
 * 전이 가설(일 단위 십성·오행 반응이 상위 단위에 같은 방향으로 보존된다)은 미검증 가정 —
 *   모든 상위 단위 출력에 hedge로 따라다닌다(통계 주장 금지).
 * 결정론 얕게/해석 깊게(ADR-0038): 글자·십성·합충 도출은 코드가, 서사는 LLM이.
 *   LLM에는 구조화 payload만 주고 측정 셀과 교과서 셀을 분리 발화시킨다.
 * 출력 연속성(D8): measuredCells=0이어도 카드는 항상 발송 — 교과서 + 누적 기술통계로 채운다.
 *   침묵 금지, 단 무증거를 증거처럼 말하기도 금지.
 */

import type { KnownBlock } from '@slack/types';
import {
  getSipsung,
  getJijiSipsung,
  getElementByCheongan,
  getElementByJiji,
  getRelations,
  getJeolgiMonthRange,
  type Cheongan,
  type Jiji,
  type Element,
  type Sipsung,
  type Pillar,
  type Relations,
} from './saju-calendar.js';
import {
  resolveHierarchyCell,
  resolveElementBandCell,
  indexCells,
  type AxisLevel,
  type CellTier,
  type ResponseCell,
} from './response-profile.js';
import { query } from './db.js';
import { addDays } from './kst.js';
import type { LLMClient, LLMMessage } from './llm.js';
// type-only(런타임 순환 0) — 장부 데이터는 period-forecast.ts가 산출, 여기선 렌더만.
import type { LedgerCardData, ForecastSourceCell, NoCallReason } from './period-forecast.js';

export type PeriodType = 'wolun' | 'seun' | 'daeun';

/** resolveCell 인덱스 — saju_response_profile 행을 (레벨|키|도메인) 키로. (response-profile ResponseCell 재사용) */
export type ResponseProfileIndex = ReadonlyMap<string, ResponseCell>;

// ─── A. derivePeriodContext (결정론) ──────────────────────

export interface PeriodContext {
  periodType: PeriodType;
  pillar: Pillar;
  stem: Cheongan;
  branch: Jiji;
  stemElement: Element;
  branchElement: Element;
  stemSipsung: Sipsung;
  branchSipsung: Sipsung;
  relations: Relations;
}

/** 기간 pillar → 십성·오행·합충 결정론 도출. 합충은 해석 전용 텍스트(가중치 편입 금지 — D7). */
export const derivePeriodContext = (
  natal: { dayMaster: Cheongan; stems: readonly Cheongan[]; branches: readonly Jiji[] },
  pillar: Pillar,
  periodType: PeriodType,
): PeriodContext => {
  const stem = pillar.cheongan;
  const branch = pillar.jiji;
  return {
    periodType,
    pillar,
    stem,
    branch,
    stemElement: getElementByCheongan(stem),
    branchElement: getElementByJiji(branch),
    stemSipsung: getSipsung(natal.dayMaster, stem),
    branchSipsung: getJijiSipsung(natal.dayMaster, branch),
    relations: getRelations(natal.stems, natal.branches, stem, branch),
  };
};

// ─── B. buildInterpretationPayload ───────────────────────

/** 신호 도메인(셀 분할 축) — measuredCells resolve 대상. */
const SIGNAL_DOMAINS = ['schedule', 'routine', 'sleep', 'expense', 'diary_meta'] as const;

/** 측정 셀 — 전수가 profileIndex(saju_response_profile) 행 출신(불변식). */
export interface MeasuredCell {
  domain: string;
  via: 'stem' | 'branch' | 'stem-element' | 'branch-element';
  resolvedLevel: AxisLevel;
  axisKey: string;
  element: Element | null;
  tier: CellTier;
  shrunkEffect: number | null;
  nActiveDays: number;
  /** 셀 기여 링크 ids(ResponseCell 승계) — Phase 3 예측 장부가 대표 신호 해소에 사용(#531). */
  sourceLinkIds: number[];
}

/** 교과서 일반론 후보(라벨 = 미검증) — 측정 증거 없는 십성·관계에서 결정론 도출. */
export interface TextbookCell {
  axis: 'stem-sipsung' | 'branch-sipsung' | 'relation';
  label: string; // 십성명 또는 관계 문자열
  gloss: string; // 교과서 한 줄
}

/** 누적 기술통계 — wolun=과거 동일 월지 절기월들, seun/daeun=기간 시작~현재. */
export interface DescriptiveStats {
  scope: string; // 사람이 읽는 범위 설명
  rangeCount: number; // 집계한 구간 수
  sleep: { avgDuration: number; recordCount: number } | null;
  routine: { rate: number; total: number } | null;
  diary: { count: number } | null;
}

export interface InterpretationPayload {
  measuredCells: MeasuredCell[];
  textbookCells: TextbookCell[];
  descriptiveStats: DescriptiveStats;
}

/** 십성 교과서 일반론(미검증 라벨로 발화) — 결정론 룩업. */
const SIPSUNG_TEXTBOOK: Record<Sipsung, string> = {
  비견: '자립·주관이 서는 기운. 혼자 밀어붙이는 쪽',
  겁재: '추진력·승부욕이 도는 기운. 욕심도 같이 커짐',
  식신: '표현·여유가 살아나는 기운. 먹고 즐기는 쪽',
  상관: '재능을 드러내고 싶은 기운. 말·비판이 늘 수 있음',
  편재: '활동적으로 벌이고 굴리는 재물 기운. 유동적',
  정재: '성실하게 모으고 관리하는 안정 재물 기운',
  편관: '압박·도전이 들어오는 기운. 결단이 필요한 쪽',
  정관: '책임·규율·명예가 강조되는 기운',
  편인: '직관·궁리가 도는 기운. 변칙적 배움',
  정인: '안정·수용이 커지는 기운. 정통적 배움',
};

/** 합충 관계 → 교과서 한 줄(미검증). Relations 필드별. */
const RELATION_TEXTBOOK: Record<keyof Relations, string> = {
  cheonganHap: '천간합 — 끌어당겨 묶이는 일이 생기는 쪽',
  jijiChung: '지지충 — 부딪힘·변동·이동수',
  jijiHap: '지지합 — 결속·협력으로 묶이는 기운',
  jijiHyung: '형 — 갈등을 거쳐 다듬어지는 과정',
  jijipa: '파 — 깨지고 다시 짜는 흐름',
  jijiHae: '해 — 엇갈리고 방해받는 기운',
  amhap: '암합 — 드러나지 않게 연결되는 일',
};

/** 도메인 자연어 명사(카드 라벨용). */
const DOMAIN_LABEL: Record<string, string> = {
  schedule: '일정',
  routine: '루틴',
  sleep: '수면',
  expense: '지출',
  diary_meta: '일기',
};

const idxKey = (axisLevel: AxisLevel, axisKey: string, domain: string): string =>
  `${axisLevel}|${axisKey}|${domain}`;

/**
 * payload 빌드 — 측정 셀(불변식: profileIndex 출신) + 교과서(측정된 축 제외) + 누적 기술통계.
 * @param natal 일간/원국 (resolve 계층 fallback에 일간 필요)
 * @param range 기간 구간 (descriptiveStats 집계 범위 결정)
 * @param today 오늘(KST) — seun/daeun 누적 상한
 */
export const buildInterpretationPayload = async (
  ctx: PeriodContext,
  index: ResponseProfileIndex,
  natal: { dayMaster: Cheongan },
  range: { start: string; end: string | null },
  userId: number,
  today: string,
): Promise<InterpretationPayload> => {
  const measuredCells = resolveMeasuredCells(ctx, index, natal.dayMaster);
  const textbookCells = buildTextbookCells(ctx, measuredCells);
  const descriptiveStats = await buildDescriptiveStats(ctx, range, userId, today);
  return { measuredCells, textbookCells, descriptiveStats };
};

/** 측정 셀 resolution — stem/branch 계층 + 오행밴드, 중복 제거. resolve*는 인덱스 셀만 반환(불변식). */
const resolveMeasuredCells = (
  ctx: PeriodContext,
  index: ResponseProfileIndex,
  dayMaster: Cheongan,
): MeasuredCell[] => {
  const seen = new Set<string>();
  const out: MeasuredCell[] = [];
  const add = (
    via: MeasuredCell['via'],
    resolved: { cell: ResponseCell; resolvedLevel: AxisLevel } | null,
  ): void => {
    if (!resolved) return;
    const c = resolved.cell;
    const k = idxKey(c.axisLevel, c.axisKey, c.domain);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({
      domain: c.domain,
      via,
      resolvedLevel: resolved.resolvedLevel,
      axisKey: c.axisKey,
      element: c.element,
      tier: c.tier,
      shrunkEffect: c.shrunkEffect,
      nActiveDays: c.nActiveDays,
      sourceLinkIds: c.sourceLinkIds,
    });
  };

  for (const domain of SIGNAL_DOMAINS) {
    add('stem', resolveHierarchyCell(index, dayMaster, 'stem', ctx.stem, domain));
    add('branch', resolveHierarchyCell(index, dayMaster, 'branch', ctx.branch, domain));
    add('stem-element', resolveElementBandCell(index, ctx.stemElement, domain));
    add('branch-element', resolveElementBandCell(index, ctx.branchElement, domain));
  }
  return out;
};

/** 교과서 셀 — 측정된 축(stem/branch)은 제외. 합충은 항상 교과서(가중치 편입 금지 — D7). */
const buildTextbookCells = (ctx: PeriodContext, measured: MeasuredCell[]): TextbookCell[] => {
  const stemMeasured = measured.some((m) => m.via === 'stem' || m.via === 'stem-element');
  const branchMeasured = measured.some((m) => m.via === 'branch' || m.via === 'branch-element');
  const out: TextbookCell[] = [];
  if (!stemMeasured) {
    out.push({
      axis: 'stem-sipsung',
      label: ctx.stemSipsung,
      gloss: SIPSUNG_TEXTBOOK[ctx.stemSipsung],
    });
  }
  if (!branchMeasured) {
    out.push({
      axis: 'branch-sipsung',
      label: ctx.branchSipsung,
      gloss: SIPSUNG_TEXTBOOK[ctx.branchSipsung],
    });
  }
  for (const key of Object.keys(RELATION_TEXTBOOK) as (keyof Relations)[]) {
    for (const rel of ctx.relations[key]) {
      out.push({ axis: 'relation', label: rel, gloss: RELATION_TEXTBOOK[key] });
    }
  }
  return out;
};

// ─── 누적 기술통계 (inline SQL) ──────────────────────────

const JEOLGI_TABLE_MIN_YEAR = 2024; // 절기 테이블 하한 — 이전으로는 walk 중단
const MAX_SAME_JIJI_RANGES = 5; // wolun 과거 동일 월지 구간 상한(백스톱)

/** wolun: 과거 동일 월지 절기월 구간들(데이터 하한까지, 백스톱 cap). 결정론. */
const pastSameJijiRanges = (
  currentStart: string,
  jiji: Jiji,
): Array<{ start: string; end: string }> => {
  const ranges: Array<{ start: string; end: string }> = [];
  let cursor = addDays(currentStart, -1);
  while (ranges.length < MAX_SAME_JIJI_RANGES) {
    if (Number(cursor.slice(0, 4)) < JEOLGI_TABLE_MIN_YEAR) break;
    let r: { start: string; end: string; jiji: Jiji };
    try {
      r = getJeolgiMonthRange(cursor);
    } catch {
      break; // 테이블 범위 밖 → 중단
    }
    if (r.jiji === jiji) ranges.push({ start: r.start, end: r.end });
    cursor = addDays(r.start, -1);
  }
  return ranges;
};

interface RangeSql {
  clause: string;
  params: unknown[];
}

/** ranges → "(col BETWEEN $i AND $i+1 OR ...)" + 파라미터. startIdx = 다음 placeholder 번호. */
const buildRangeClause = (
  ranges: ReadonlyArray<{ start: string; end: string }>,
  col: string,
  startIdx: number,
): RangeSql => {
  const parts: string[] = [];
  const params: unknown[] = [];
  let i = startIdx;
  for (const r of ranges) {
    parts.push(`${col} BETWEEN $${i} AND $${i + 1}`);
    params.push(r.start, r.end);
    i += 2;
  }
  return { clause: `(${parts.join(' OR ')})`, params };
};

interface SleepStatRow {
  avg_duration: number | null;
  cnt: number;
}
interface RoutineStatRow {
  done: number;
  total: number;
}
interface DiaryStatRow {
  cnt: number;
}

/** 구간 목록에 대해 sleep/routine/diary 누적 집계. 구간 없으면 전부 null. */
const aggregateLifeStats = async (
  userId: number,
  ranges: ReadonlyArray<{ start: string; end: string }>,
): Promise<Pick<DescriptiveStats, 'sleep' | 'routine' | 'diary'>> => {
  if (ranges.length === 0) return { sleep: null, routine: null, diary: null };

  // 분할 수면 정합: 날짜별 합산을 1 레코드로 본 뒤 평균·건수 집계 (세그먼트 단위 평균 왜곡 방지)
  const sleepRange = buildRangeClause(ranges, 'date', 2);
  const sleepRes = await query<SleepStatRow>(
    `SELECT ROUND(AVG(day_minutes))::int AS avg_duration, COUNT(*)::int AS cnt
       FROM (
         SELECT date, SUM(duration_minutes) AS day_minutes
           FROM sleep_records
          WHERE sleep_type = 'night' AND duration_minutes IS NOT NULL
            AND user_id = $1 AND ${sleepRange.clause}
          GROUP BY date
       ) d`,
    [userId, ...sleepRange.params],
  );
  const routineRange = buildRangeClause(ranges, 'r.date', 2);
  const routineRes = await query<RoutineStatRow>(
    `SELECT COUNT(*) FILTER (WHERE r.completed)::int AS done, COUNT(*)::int AS total
       FROM routine_records r
       JOIN routine_templates t ON r.template_id = t.id
      WHERE r.user_id = $1 AND r.date >= t.created_at::date AND ${routineRange.clause}`,
    [userId, ...routineRange.params],
  );
  const diaryRange = buildRangeClause(ranges, 'date', 2);
  const diaryRes = await query<DiaryStatRow>(
    `SELECT COUNT(*)::int AS cnt FROM diary_entries
      WHERE user_id = $1 AND ${diaryRange.clause}`,
    [userId, ...diaryRange.params],
  );

  const sleepRow = sleepRes.rows[0];
  const routineRow = routineRes.rows[0];
  const diaryRow = diaryRes.rows[0];
  return {
    sleep:
      sleepRow && sleepRow.cnt > 0
        ? { avgDuration: sleepRow.avg_duration ?? 0, recordCount: sleepRow.cnt }
        : null,
    routine:
      routineRow && routineRow.total > 0
        ? { rate: Math.round((routineRow.done / routineRow.total) * 100), total: routineRow.total }
        : null,
    diary: diaryRow && diaryRow.cnt > 0 ? { count: diaryRow.cnt } : null,
  };
};

/** 기술통계 빌드 — wolun=과거 동일 월지 누적 / seun·daeun=기간 시작~현재. */
const buildDescriptiveStats = async (
  ctx: PeriodContext,
  range: { start: string; end: string | null },
  userId: number,
  today: string,
): Promise<DescriptiveStats> => {
  if (ctx.periodType === 'wolun') {
    const ranges = pastSameJijiRanges(range.start, ctx.branch);
    const stats = await aggregateLifeStats(userId, ranges);
    const scope =
      ranges.length === 0
        ? `과거 같은 ${ctx.branch}월(절기달) 기록이 아직 없어 — 이번이 처음 쌓는 구간이야`
        : `과거 같은 ${ctx.branch}월(절기달) ${ranges.length}개 누적`;
    return { scope, rangeCount: ranges.length, ...stats };
  }
  // seun/daeun: 기간 시작 ~ 오늘(현재까지)
  const end = range.end && range.end < today ? range.end : today;
  const ranges = range.start <= end ? [{ start: range.start, end }] : [];
  const stats = await aggregateLifeStats(userId, ranges);
  const label = ctx.periodType === 'seun' ? '올해(입춘 기준)' : '이번 대운';
  const scope = ranges.length === 0 ? `${label} 시작 전` : `${label} 시작 이후 ~ 오늘`;
  return { scope, rangeCount: ranges.length, ...stats };
};

// ─── C. composeNarrative (LLM) ───────────────────────────

const PERIOD_LABEL: Record<PeriodType, string> = {
  wolun: '이번 절기달 운세',
  seun: '올해 운세(입춘 기준)',
  daeun: '대운 흐름',
};

/** 검증가능성 사다리 — 각 층의 지위 라벨(출력에 항상 동반). */
const LADDER_STATUS: Record<PeriodType, string> = {
  wolun: '월운은 누적 관찰 단계 — 통계로 확정한 게 아니라 경향을 쌓아가는 중이야',
  seun: '세운은 평생 표본이 한두 번뿐 — 통계로 확정은 영구히 못 해, 경향 참고용',
  daeun: '대운은 검증이 안 되는 층 — 교과서 해석과 가중치 참고로만 보자',
};

const TRANSFER_HEDGE =
  '일운에서 측정된 반응이 더 큰 주기에도 같은 방향으로 이어진다는 건 아직 검증 안 된 가정이야. 운과 원국이 맞물리면 방향이 달라질 수도 있어';

const NARRATIVE_SYSTEM_PROMPT = `너는 사용자의 사주·생활 데이터를 같이 들여다보는 잔소리꾼 친구.
반말로 짧고 담백하게. 이모지·존댓말·제목(#) 금지. Slack mrkdwn — 굵게는 *별표1개*, **별표2개** 금지.

너에게 두 종류의 재료가 주어진다. 둘을 절대 섞지 말고 분리해서 말해:
1) 측정된 반응 — 이 사람 실제 데이터로 잡힌 것(tier·발현일수 동반). 있으면 "측정상 ~" 톤.
2) 교과서 일반론 — 명리 일반론일 뿐 이 사람 데이터엔 아직 증거 없음. 반드시 "교과서적으론 ~인데 네 데이터엔 아직 안 잡혀" 톤으로, 측정된 것처럼 단정 금지.

규칙:
- 측정 재료가 없으면 없다고 솔직히 말하고 교과서·누적기록으로 채워. 침묵 금지, 무증거를 증거처럼 말하기도 금지.
- 전이 가설(일 단위 반응이 더 큰 주기로 이어진다)은 미검증 가정 — 한 번은 짚어줘.
- 숫자 효과크기는 말하지 마(발현 일수 정도는 ok). 단정·예언 금지.
- 4~7문장. 끝에 잔소리 한 문장.`;

/** payload·ctx → LLM 입력 컨텍스트(자연어 직렬화). */
const buildNarrativeContext = (
  payload: InterpretationPayload,
  ctx: PeriodContext,
  periodType: PeriodType,
): string => {
  const lines: string[] = [];
  lines.push(`[기간] ${PERIOD_LABEL[periodType]} — 간지 ${ctx.pillar.hangul}`);
  lines.push(`[지위] ${LADDER_STATUS[periodType]}`);
  lines.push(
    `[기간 글자] 천간 ${ctx.stem}(${ctx.stemSipsung}, ${ctx.stemElement}) / 지지 ${ctx.branch}(${ctx.branchSipsung}, ${ctx.branchElement})`,
  );

  if (payload.measuredCells.length === 0) {
    lines.push('[측정된 반응] 없음 — 아직 이 기운에 대해 네 데이터로 잡힌 게 없어');
  } else {
    lines.push('[측정된 반응]');
    for (const m of payload.measuredCells) {
      const tierLabel = m.tier === 'verified' ? '검증됨' : '탐색적(검증중)';
      lines.push(
        `- ${DOMAIN_LABEL[m.domain] ?? m.domain}: ${m.axisKey} 반응 (${tierLabel}, ${m.nActiveDays}일 기준)`,
      );
    }
  }

  if (payload.textbookCells.length > 0) {
    lines.push('[교과서 일반론 — 미검증]');
    for (const t of payload.textbookCells) {
      lines.push(`- ${t.label}: ${t.gloss}`);
    }
  }

  const d = payload.descriptiveStats;
  lines.push(`[누적 기록] ${d.scope}`);
  if (d.sleep) lines.push(`- 평균 수면 ${d.sleep.avgDuration}분 (${d.sleep.recordCount}일)`);
  if (d.routine) lines.push(`- 루틴 완료율 ${d.routine.rate}% (${d.routine.total}건)`);
  if (d.diary) lines.push(`- 일기 ${d.diary.count}건`);
  if (!d.sleep && !d.routine && !d.diary) lines.push('- 비교할 기록이 거의 없어');

  lines.push(`[전이 가설] ${TRANSFER_HEDGE}`);
  return lines.join('\n');
};

/** 결정론 fallback 서사 — LLM 실패 시. */
const buildFallbackNarrative = (
  payload: InterpretationPayload,
  ctx: PeriodContext,
  periodType: PeriodType,
): string => {
  const parts: string[] = [];
  parts.push(`${PERIOD_LABEL[periodType]}는 ${ctx.pillar.hangul} 기운이야.`);
  if (payload.measuredCells.length > 0) {
    const names = [...new Set(payload.measuredCells.map((m) => m.axisKey))].join(', ');
    parts.push(`측정상 ${names} 쪽으로 반응이 잡혀 있어(검증 상태는 위 카드 참고).`);
  } else {
    parts.push('아직 이 기운에 대해 네 데이터로 잡힌 측정 반응은 없어.');
  }
  parts.push(`${LADDER_STATUS[periodType]}. ${TRANSFER_HEDGE}.`);
  return parts.join(' ');
};

/**
 * 서사 생성 — cron 생성 시점에만 호출(결과를 narrative로 영속, fast path는 LLM 미호출).
 * measured=0이어도 교과서+기술통계로 발화(D8). LLM 실패 시 결정론 fallback.
 */
export const composeNarrative = async (
  llmClient: LLMClient,
  payload: InterpretationPayload,
  ctx: PeriodContext,
  periodType: PeriodType,
): Promise<string> => {
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: NARRATIVE_SYSTEM_PROMPT },
      { role: 'user', content: buildNarrativeContext(payload, ctx, periodType) },
    ];
    const res = await llmClient.chat(messages);
    const text = res.text?.trim();
    return text && text.length > 0 ? text : buildFallbackNarrative(payload, ctx, periodType);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PeriodInterpretation] 서사 생성 실패:', msg);
    return buildFallbackNarrative(payload, ctx, periodType);
  }
};

// ─── D. renderInterpretationBlocks (결정론 렌더 — cron·fast path 공용) ──

/** 영속·렌더 공용 레코드 — period_interpretations 1행에 대응. */
export interface PeriodInterpretationRecord {
  periodType: PeriodType;
  pillar: string; // 한글 2자
  periodStart: string;
  periodEnd: string | null;
  payload: InterpretationPayload;
  narrative: string;
}

const rangeText = (start: string, end: string | null): string =>
  end ? `${start} ~ ${end}` : `${start} ~`;

const section = (text: string): KnownBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});

// ─── 장부 섹션(Phase 3) — ledger는 caller(cron/fast path)가 주입. 데이터는 period-forecast.ts. ──

const TIER_LABEL_SHORT: Record<string, string> = {
  verified: '검증됨',
  emerging: '탐색적·검증중',
};
const DIR_ARROW: Record<string, string> = { up: '↑', down: '↓' };

/** delta → 부호 강조 %p. 원 pass율(baseline/measured)은 비노출 — §9 보안(delta 부호·크기만). */
const fmtDelta = (delta: number | null): string => {
  if (delta === null) return '';
  const pp = Math.round(delta * 100);
  const sign = pp > 0 ? '+' : pp < 0 ? '-' : '±';
  return ` _(실측 *${sign}${Math.abs(pp)}%p*)_`;
};

const cellLabel = (cell: ForecastSourceCell): string =>
  `${DOMAIN_LABEL[cell.domain] ?? cell.domain} — *${cell.axisKey}*`;

/**
 * 예측 장부 섹션 — 지난 기간 채점 결과 + 이번 기간 예측. baseline 원수치 비노출(delta·tier만, §9).
 * no_call도 '예측 안 함' 명시(D8 — 침묵 금지). scored 비면(첫 기간) 생략, forecasts는 generate가 항상 ≥1 보장.
 */
const renderLedgerBlocks = (ledger: LedgerCardData): KnownBlock[] => {
  const blocks: KnownBlock[] = [];

  if (ledger.scored.length > 0) {
    const lines = ledger.scored.map((s) => {
      const dir = s.predictedDirection ? DIR_ARROW[s.predictedDirection] : '';
      if (s.status === 'unmeasurable') {
        return `• ${cellLabel(s.sourceCell)} 측정불가 _(예측 ${dir}, 데이터 부족)_`;
      }
      const hit = s.directionHit ? '적중' : '빗나감';
      return `• ${cellLabel(s.sourceCell)} *${hit}* _(예측 ${dir})_${fmtDelta(s.measuredDelta)}`;
    });
    blocks.push(section(`*지난 기간 장부 결과*\n${lines.join('\n')}`));
  }

  const openLines: string[] = [];
  const noCallLines: string[] = [];
  for (const f of ledger.forecasts) {
    if (f.status === 'no_call' || 'reason' in f.sourceCell) {
      noCallLines.push(`예측 안 함 — ${(f.sourceCell as NoCallReason).reason}`);
      continue;
    }
    const cell = f.sourceCell as ForecastSourceCell;
    const dir = f.predictedDirection ? DIR_ARROW[f.predictedDirection] : '';
    const tier = TIER_LABEL_SHORT[cell.tier] ?? cell.tier;
    openLines.push(`• ${cellLabel(cell)} ${dir} _(근거: ${tier})_`);
  }
  const body =
    openLines.length > 0 ? openLines.join('\n') : noCallLines.map((l) => `• ${l}`).join('\n');
  blocks.push(section(`*이번 기간 예측* _(다음 전환 때 채점)_\n${body}`));

  return blocks;
};

/**
 * 저장된 해석 → Block Kit 카드(결정론). cron·fast path 공용.
 * measuredCells=0 케이스도 일급 경로(D8) — 빈 카드 금지, 교과서+누적기록으로 채운다.
 * ledger(Phase 3): 있으면 사다리 footer 앞에 예측 장부 섹션 삽입(wolun/seun만 주입, daeun은 undefined).
 */
export const renderInterpretationBlocks = (
  record: PeriodInterpretationRecord,
  ledger?: LedgerCardData,
): KnownBlock[] => {
  const { payload, periodType } = record;
  const blocks: KnownBlock[] = [];

  blocks.push(
    section(
      `*${PERIOD_LABEL[periodType]}* — *${record.pillar}* _(${rangeText(record.periodStart, record.periodEnd)})_`,
    ),
  );

  // 측정된 반응 (D8: 0이어도 명시)
  if (payload.measuredCells.length > 0) {
    const lines = payload.measuredCells.map((m) => {
      const tierLabel = m.tier === 'verified' ? '검증됨' : '탐색적·검증중';
      return `• ${DOMAIN_LABEL[m.domain] ?? m.domain} — *${m.axisKey}* 반응 _(${tierLabel}, ${m.nActiveDays}일)_`;
    });
    blocks.push(section(`*측정된 너의 반응*\n${lines.join('\n')}`));
  } else {
    blocks.push(section('*측정된 너의 반응* — 아직 없어. 아래는 교과서 일반론과 누적 기록이야.'));
  }

  // 교과서 일반론 (미검증 라벨)
  if (payload.textbookCells.length > 0) {
    const lines = payload.textbookCells.map((t) => `• ${t.label}: ${t.gloss}`);
    blocks.push(section(`*교과서 일반론* _(아직 네 데이터로는 검증 안 됨)_\n${lines.join('\n')}`));
  }

  // 누적 기술통계
  const d = payload.descriptiveStats;
  const statLines: string[] = [];
  if (d.sleep) statLines.push(`• 평균 수면 ${d.sleep.avgDuration}분 (${d.sleep.recordCount}일)`);
  if (d.routine) statLines.push(`• 루틴 완료율 ${d.routine.rate}% (${d.routine.total}건)`);
  if (d.diary) statLines.push(`• 일기 ${d.diary.count}건`);
  const statBody = statLines.length > 0 ? statLines.join('\n') : '• 비교할 기록이 거의 없어';
  blocks.push(section(`*누적 기록* _(${d.scope})_\n${statBody}`));

  // 서사 (LLM 동결)
  if (record.narrative.trim().length > 0) blocks.push(section(record.narrative));

  // 예측 장부 섹션 (Phase 3) — wolun/seun에만 주입됨
  if (ledger) blocks.push(...renderLedgerBlocks(ledger));

  // 사다리 지위 + 전이 가설 (context)
  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `※ ${LADDER_STATUS[periodType]}.` },
      { type: 'mrkdwn', text: `※ ${TRANSFER_HEDGE}.` },
    ],
  });

  return blocks;
};

// ─── DB 헬퍼 (cron 영속 + fast path 조회 공용) ─────────────

interface ResponseProfileRow {
  axis_level: string;
  axis_key: string;
  element: string | null;
  domain: string;
  tier: string;
  alpha: string | null;
  beta: string | null;
  shrunk_effect: string | null;
  n_links: number;
  n_active_days: number;
  stability: boolean | null;
  source_link_ids: unknown;
}

const isAxisLevel = (s: string): s is AxisLevel =>
  s === 'char_stem' ||
  s === 'char_branch' ||
  s === 'sipsung' ||
  s === 'group' ||
  s === 'element_band';
const isElement = (s: string | null): s is Element =>
  s === '목' || s === '화' || s === '토' || s === '금' || s === '수';
const isTier = (s: string): s is CellTier => s === 'verified' || s === 'emerging';

/** saju_response_profile 행 → resolveCell 인덱스. cron 생성 시점 로드(ResponseCell 전 필드 복원). */
export const loadResponseProfileIndex = async (userId: number): Promise<ResponseProfileIndex> => {
  const res = await query<ResponseProfileRow>(
    `SELECT axis_level, axis_key, element, domain, tier, alpha, beta, shrunk_effect,
            n_links, n_active_days, stability, source_link_ids
       FROM saju_response_profile WHERE user_id = $1`,
    [userId],
  );
  const cells: ResponseCell[] = [];
  for (const r of res.rows) {
    if (!isAxisLevel(r.axis_level) || !isTier(r.tier)) continue;
    cells.push({
      axisLevel: r.axis_level,
      axisKey: r.axis_key,
      element: isElement(r.element) ? r.element : null,
      domain: r.domain,
      tier: r.tier,
      alpha: r.alpha !== null ? Number(r.alpha) : 0,
      beta: r.beta !== null ? Number(r.beta) : 0,
      shrunkEffect: r.shrunk_effect !== null ? Number(r.shrunk_effect) : null,
      nLinks: r.n_links,
      nActiveDays: r.n_active_days,
      stability: r.stability,
      sourceLinkIds: Array.isArray(r.source_link_ids)
        ? r.source_link_ids.filter((x): x is number => typeof x === 'number')
        : [],
    });
  }
  return indexCells(cells);
};

/** 해석 UPSERT — 같은 (user, type, start) 중복 시 재생성 갱신(cron 재실행 안전). */
export const upsertInterpretation = async (
  userId: number,
  record: PeriodInterpretationRecord,
): Promise<void> => {
  await query(
    `INSERT INTO period_interpretations
       (user_id, period_type, period_start, period_end, pillar, structured, narrative)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (user_id, period_type, period_start)
       DO UPDATE SET period_end = EXCLUDED.period_end, pillar = EXCLUDED.pillar,
         structured = EXCLUDED.structured, narrative = EXCLUDED.narrative, created_at = NOW()`,
    [
      userId,
      record.periodType,
      record.periodStart,
      record.periodEnd,
      record.pillar,
      JSON.stringify(record.payload),
      record.narrative,
    ],
  );
};

interface InterpretationRow {
  period_type: string;
  period_start: string;
  period_end: string | null;
  pillar: string;
  structured: unknown;
  narrative: string;
}

const isPeriodType = (s: string): s is PeriodType => s === 'wolun' || s === 'seun' || s === 'daeun';

/** JSONB structured → InterpretationPayload(방어적 파싱, 누락 필드는 빈 값). */
const parsePayload = (raw: unknown): InterpretationPayload => {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const measuredCells = Array.isArray(obj['measuredCells'])
    ? (obj['measuredCells'] as MeasuredCell[])
    : [];
  const textbookCells = Array.isArray(obj['textbookCells'])
    ? (obj['textbookCells'] as TextbookCell[])
    : [];
  const ds = (
    typeof obj['descriptiveStats'] === 'object' && obj['descriptiveStats'] !== null
      ? obj['descriptiveStats']
      : {}
  ) as Record<string, unknown>;
  const descriptiveStats: DescriptiveStats = {
    scope: typeof ds['scope'] === 'string' ? ds['scope'] : '',
    rangeCount: typeof ds['rangeCount'] === 'number' ? ds['rangeCount'] : 0,
    sleep: (ds['sleep'] as DescriptiveStats['sleep']) ?? null,
    routine: (ds['routine'] as DescriptiveStats['routine']) ?? null,
    diary: (ds['diary'] as DescriptiveStats['diary']) ?? null,
  };
  return { measuredCells, textbookCells, descriptiveStats };
};

/** period_type별 최신 해석 1행 로드 — fast path 조회용(LLM 미호출). */
export const loadLatestInterpretation = async (
  userId: number,
  periodType: PeriodType,
): Promise<PeriodInterpretationRecord | null> => {
  const res = await query<InterpretationRow>(
    `SELECT period_type, period_start::text, period_end::text, pillar, structured, narrative
       FROM period_interpretations
      WHERE user_id = $1 AND period_type = $2
      ORDER BY period_start DESC, created_at DESC
      LIMIT 1`,
    [userId, periodType],
  );
  const row = res.rows[0];
  if (!row || !isPeriodType(row.period_type)) return null;
  return {
    periodType: row.period_type,
    pillar: row.pillar,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    payload: parsePayload(row.structured),
    narrative: row.narrative,
  };
};

export { PERIOD_LABEL };
