/**
 * 트리거 평가용 조회 헬퍼와 지지 관계 캐시 (pattern-match에서 분리).
 * 캐시 변수·로더·테스트용 리셋을 이 파일 하나에 둔다.
 */

import { query } from '../db.js';
import type { Cheongan, Jiji, Pillar, PillarSet } from '../saju/types.js';
import type { DailyContext, PillarLevel } from './match-types.js';

// ─── 트리거 평가 ─────────────────────────────────────────

export const ELEMENT_BY_STEM: Record<Cheongan, string> = {
  갑: '목',
  을: '목',
  병: '화',
  정: '화',
  무: '토',
  기: '토',
  경: '금',
  신: '금',
  임: '수',
  계: '수',
};
export const ELEMENT_BY_BRANCH: Record<Jiji, string> = {
  자: '수',
  축: '토',
  인: '목',
  묘: '목',
  진: '토',
  사: '화',
  오: '화',
  미: '토',
  신: '금',
  유: '금',
  술: '토',
  해: '수',
};

interface BranchRelationRow {
  relation_type: string;
  branch_a_name: string;
  branch_b_name: string;
}

let branchRelationCache: BranchRelationRow[] | null = null;

export const loadBranchRelations = async (): Promise<BranchRelationRow[]> => {
  if (branchRelationCache) return branchRelationCache;
  const result = await query<BranchRelationRow>(
    `SELECT br.relation_type, ba.name AS branch_a_name, bb.name AS branch_b_name
       FROM branch_relations br
       JOIN branches_master ba ON ba.id = br.branch_a_id
       JOIN branches_master bb ON bb.id = br.branch_b_id`,
  );
  branchRelationCache = result.rows;
  return branchRelationCache;
};

interface SibiunsungRow {
  state: string;
}

export const lookupSibiunsung = async (
  dayMaster: Cheongan,
  branch: Jiji,
): Promise<string | null> => {
  const result = await query<SibiunsungRow>(
    `SELECT state
       FROM sibiunsung_lookup sl
       JOIN stems_master dm ON dm.id = sl.day_master_stem_id
       JOIN branches_master b ON b.id = sl.branch_id
      WHERE dm.name = $1 AND b.name = $2
      LIMIT 1`,
    [dayMaster, branch],
  );
  return result.rows[0]?.state ?? null;
};

export const isStringArray = (val: unknown): val is string[] =>
  Array.isArray(val) && val.every((x) => typeof x === 'string');

export const getNumberField = (obj: Record<string, unknown>, key: string): number | null => {
  const v = obj[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * pillar_level에 따라 평가 대상 pillar 선택 (Phase 2.5).
 * - null / 'ilun' → 일운 (= ctx.ilun, 기존 dayStem/dayBranch 동등)
 * - 'wolun' / 'seun' / 'daeun' → 해당 운 pillar
 * - 'wonguk' → null (직접 매칭 불가 — Phase 2.5 1차에서 wonguk 시드 없음)
 * - 'daeun'이 미적용 구간이면 null (대운 미시작 사용자 / 데이터 누락)
 */
export const pickPillarByLevel = (level: PillarLevel | null, ctx: DailyContext): Pillar | null => {
  switch (level) {
    case null:
    case 'ilun':
      return ctx.ilun;
    case 'wolun':
      return ctx.wolun;
    case 'seun':
      return ctx.seun;
    case 'daeun':
      return ctx.daeun;
    case 'wonguk':
      return null;
  }
};

/** DailyContext → 운 풀셋 PillarSet (strength_band·hwa 공용) */
export const pillarSetOf = (ctx: DailyContext): PillarSet => ({
  wonguk: ctx.natal.pillars,
  daeun: ctx.daeun,
  seun: ctx.seun,
  wolun: ctx.wolun,
  ilun: ctx.ilun,
});

// ─── 캐시 reset (테스트용) ───────────────────────────────

export const __resetCacheForTest = (): void => {
  branchRelationCache = null;
};
