/** 기간 해석 — 측정 셀·교과서 셀·기술통계를 묶는 payload 빌드. */

import type { Cheongan, Sipsung, Relations } from '../saju-calendar.js';
import type { AxisLevel, ResponseCell } from '../response-profile/axis.js';
import { resolveHierarchyCell, resolveElementBandCell } from '../response-profile/resolve.js';
import type {
  ResponseProfileIndex,
  PeriodContext,
  MeasuredCell,
  TextbookCell,
  InterpretationPayload,
} from './types.js';
import { buildDescriptiveStats } from './interpretation-stats.js';

// ─── B. buildInterpretationPayload ───────────────────────

/** 신호 도메인(셀 분할 축) — measuredCells resolve 대상. */
const SIGNAL_DOMAINS = ['schedule', 'routine', 'sleep', 'expense', 'diary_meta'] as const;

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
