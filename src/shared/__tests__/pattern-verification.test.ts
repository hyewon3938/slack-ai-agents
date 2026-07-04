import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── db mock — ensureMirrorSignalDef만 query를 사용(그 외 테스트는 순수 함수라 미접근) ──
interface FakeSignalRow {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  source: 'seed' | 'llm';
  sql_body: string | null;
  value_type: 'binary' | 'continuous' | null;
  direction: string | null;
  threshold: string | null;
  tag_name: string | null;
  window_days: number | null;
  domain: string | null;
  description: string | null;
}
let signalRow: FakeSignalRow | null; // id로 조회되는 대상 신호
let mirrorRows: Array<{ status: string }>; // 거울 존재 조회 결과
let inserts: Array<{ sql: string; params: readonly unknown[] }>;
let nextInsertId: number;
// computeUserDataStarts 픽스처 — 테이블별 MIN(date) + audit MIN(changed_at) 응답 제어.
let dataStartByTable: Map<string, string | null>;
let auditChangedStart: string | null;

const resetDb = (): void => {
  signalRow = null;
  mirrorRows = [];
  inserts = [];
  nextInsertId = 999;
  dataStartByTable = new Map();
  auditChangedStart = null;
};
resetDb();

vi.mock('../db.js', () => ({
  query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
    const s = sql.trim();
    if (/^INSERT INTO signal_defs/i.test(s)) {
      inserts.push({ sql: s, params: params ?? [] });
      return { rows: [{ id: nextInsertId }] };
    }
    if (/FROM signal_defs/i.test(s) && /WHERE id = \$1 AND user_id = \$2/i.test(s)) {
      return { rows: signalRow ? [signalRow] : [] }; // 대상 신호 로드
    }
    // findEquivalentSignal(#557) 거울 존재 조회 — id·status 컬럼, IS NOT DISTINCT FROM 매칭.
    if (/SELECT id, status FROM signal_defs/i.test(s) && /IS NOT DISTINCT FROM/i.test(s)) {
      return { rows: mirrorRows };
    }
    // computeUserDataStarts(#504): 라이프 데이터 테이블별 MIN(date). 테이블명으로 픽스처 응답 선택.
    const minDate = /MIN\(date\)::text AS d FROM (\w+)/i.exec(s);
    if (minDate) {
      return { rows: [{ d: dataStartByTable.get(minDate[1] ?? '') ?? null }] };
    }
    // audit 특례(#572): schedule_changes MIN(changed_at) — global floor와 분리 검증용.
    if (/MIN\(DATE\(changed_at/i.test(s)) {
      return { rows: [{ d: auditChangedStart }] };
    }
    throw new Error(`[fixture] unexpected SQL: ${s.slice(0, 60)}`);
  }),
}));

import {
  buildWindowDates,
  binarizeSqlSeries,
  buildContingency,
  buildDaySequence,
  splitRawByActivation,
  verifyContingency,
  classifyVerdict,
  statusForVerdict,
  ensureMirrorSignalDef,
  familyOf,
  bhFdrByFamily,
  signalDataStart,
  seedDataStart,
  computeUserDataStarts,
  maxDate,
  enrollmentStart,
  splitHalvesConsistent,
  type DaySeries,
  type UserDataStarts,
} from '../pattern-verification.js';

// ─── buildWindowDates ────────────────────────────────────

describe('buildWindowDates', () => {
  it('today 포함 [today-cap, today] 오름차순 cap+1개', () => {
    const dates = buildWindowDates('2026-06-05', 3);
    expect(dates).toEqual(['2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']);
  });
});

// ─── binarizeSqlSeries ───────────────────────────────────

describe('binarizeSqlSeries', () => {
  const dates = ['d0', 'd1', 'd2', 'd3'];

  it('above_abs — v >= threshold', () => {
    const raw = new Map<string, number | null>([
      ['d0', 3],
      ['d1', 1],
      ['d2', 0],
      ['d3', 5],
    ]);
    const s = binarizeSqlSeries(raw, dates, 'above_abs', 2, 28);
    expect(s.get('d0')).toBe(true); // 3>=2
    expect(s.get('d1')).toBe(false); // 1>=2 X
    expect(s.get('d3')).toBe(true); // 5>=2
  });

  it('below_abs — v <= threshold', () => {
    const raw = new Map<string, number | null>([['d0', 0]]);
    const s = binarizeSqlSeries(raw, ['d0'], 'below_abs', 0, 28);
    expect(s.get('d0')).toBe(true); // 0<=0
  });

  it('flag_present — v >= 1 (기본 임계)', () => {
    const raw = new Map<string, number | null>([
      ['d0', 1],
      ['d1', 0],
    ]);
    const s = binarizeSqlSeries(raw, ['d0', 'd1'], 'flag_present', null, 28);
    expect(s.get('d0')).toBe(true);
    expect(s.get('d1')).toBe(false);
  });

  it('above_avg — 워밍업(i<windowDays)은 null, 이후 rolling baseline 비교', () => {
    const raw = new Map<string, number | null>([
      ['d0', 1],
      ['d1', 1],
      ['d2', 10],
      ['d3', 0],
    ]);
    const s = binarizeSqlSeries(raw, dates, 'above_avg', null, 2);
    expect(s.get('d0')).toBeNull(); // 워밍업
    expect(s.get('d1')).toBeNull(); // 워밍업
    expect(s.get('d2')).toBe(true); // baseline mean(1,1)=1, 10>1
    expect(s.get('d3')).toBe(false); // baseline mean(1,10)=5.5, 0>5.5 X
  });

  it('below_avg — baseline 미만이면 true', () => {
    const raw = new Map<string, number | null>([
      ['d0', 1],
      ['d1', 1],
      ['d2', 10],
      ['d3', 0],
    ]);
    const s = binarizeSqlSeries(raw, dates, 'below_avg', null, 2);
    expect(s.get('d2')).toBe(false); // 10<1 X
    expect(s.get('d3')).toBe(true); // 0<5.5
  });

  it('raw가 null(측정불가)이면 null', () => {
    const raw = new Map<string, number | null>([['d0', null]]);
    const s = binarizeSqlSeries(raw, ['d0'], 'above_abs', 1, 28);
    expect(s.get('d0')).toBeNull();
  });
});

// ─── buildContingency ────────────────────────────────────

describe('buildContingency', () => {
  it('발현/비발현 × pass/fail 분류 + 측정불가(null) 발현일은 inconclusive', () => {
    const activation = new Map<string, boolean>([
      ['d0', true],
      ['d1', true],
      ['d2', false],
      ['d3', false],
      ['d4', true],
    ]);
    const signal: DaySeries = new Map([
      ['d0', true], // 발현 & pass → a
      ['d1', false], // 발현 & fail → b
      ['d2', true], // 비발현 & pass → c
      ['d3', false], // 비발현 & fail → d
      ['d4', null], // 발현 & 측정불가 → inconclusive
    ]);
    expect(buildContingency(activation, signal)).toEqual({
      a: 1,
      b: 1,
      c: 1,
      d: 1,
      inconclusive: 1,
    });
  });

  it('신호 시리즈에 없는 날(undefined)은 제외', () => {
    const activation = new Map<string, boolean>([
      ['d0', true],
      ['d9', true],
    ]);
    const signal: DaySeries = new Map([['d0', true]]);
    expect(buildContingency(activation, signal)).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 0,
      inconclusive: 0,
    });
  });
});

// ─── verifyContingency ───────────────────────────────────

describe('verifyContingency', () => {
  it('강한 연관 → 낮은 p, effect > 1, posterior alpha=1+a', () => {
    const v = verifyContingency({ a: 20, b: 2, c: 2, d: 20, inconclusive: 0 });
    expect(v.nActive).toBe(22);
    expect(v.nOff).toBe(22);
    expect(v.effect).toBeGreaterThan(3);
    expect(v.p).toBeLessThan(0.01);
    expect(v.posteriorAlpha).toBe(21); // 1 + a
    expect(v.posteriorBeta).toBe(3); // 1 + b
  });

  it('off일 0이면 effect/p = NaN (대조 불가)', () => {
    const v = verifyContingency({ a: 5, b: 5, c: 0, d: 0, inconclusive: 0 });
    expect(Number.isNaN(v.effect)).toBe(true);
    expect(Number.isNaN(v.p)).toBe(true);
  });

  it('무관(rateActive ≈ rateOff) → effect ≈ 1', () => {
    const v = verifyContingency({ a: 10, b: 10, c: 10, d: 10, inconclusive: 0 });
    expect(v.effect).toBeCloseTo(1, 5);
  });
});

// ─── classifyVerdict ─────────────────────────────────────

describe('classifyVerdict', () => {
  it('nActive ≥ 30 & q ≤ 0.05 & effect ≥ 1.3 → confirm', () => {
    expect(classifyVerdict({ nActive: 40, effect: 2.0 }, 0.01)).toBe('confirm');
  });

  it('nActive ≥ 30 & effect ∈ [0.95, 1.05] → reject', () => {
    expect(classifyVerdict({ nActive: 40, effect: 1.0 }, 0.8)).toBe('reject');
  });

  it('nActive < 30 → insufficient', () => {
    expect(classifyVerdict({ nActive: 10, effect: 2.0 }, 0.01)).toBe('insufficient');
  });

  it('effect NaN(off일 0) → insufficient', () => {
    expect(classifyVerdict({ nActive: 40, effect: NaN }, 0.01)).toBe('insufficient');
  });

  it('데이터 충분하나 effect 모호(1.05~1.3) → inconclusive', () => {
    expect(classifyVerdict({ nActive: 40, effect: 1.2 }, 0.5)).toBe('inconclusive');
  });

  it('effect 충분하나 q 비유의 → inconclusive (confirm 아님)', () => {
    expect(classifyVerdict({ nActive: 40, effect: 2.0 }, 0.5)).toBe('inconclusive');
  });

  // ── direction_mismatch (#555) ──
  it('nActive ≥ 30 & effect ≤ 0.77(명확한 역방향) → direction_mismatch', () => {
    expect(classifyVerdict({ nActive: 40, effect: 0.5 }, 0.5)).toBe('direction_mismatch');
  });

  it('effect 0.77 경계 → direction_mismatch (이하 포함)', () => {
    expect(classifyVerdict({ nActive: 40, effect: 0.77 }, 0.5)).toBe('direction_mismatch');
  });

  it('effect 0.9(게이트 위·reject 밴드 밖) → inconclusive (역방향 아님)', () => {
    expect(classifyVerdict({ nActive: 40, effect: 0.9 }, 0.5)).toBe('inconclusive');
  });

  it('nActive < 30 이면 역방향이어도 insufficient 우선', () => {
    expect(classifyVerdict({ nActive: 20, effect: 0.3 }, 0.5)).toBe('insufficient');
  });
});

// ─── buildDaySequence ────────────────────────────────────

describe('buildDaySequence', () => {
  it('windowDates 순서로 (active, pass), 측정불가(null)는 제외', () => {
    const activation = new Map<string, boolean>([
      ['d0', true],
      ['d1', false],
      ['d2', true],
      ['d3', true],
    ]);
    const signal: DaySeries = new Map([
      ['d0', true],
      ['d1', false],
      ['d2', null], // 측정불가 → 제외
      ['d3', true],
    ]);
    expect(buildDaySequence(activation, signal, ['d0', 'd1', 'd2', 'd3'])).toEqual([
      { active: true, pass: true },
      { active: false, pass: false },
      { active: true, pass: true },
    ]);
  });

  it('activation 없는 날은 active=false', () => {
    const signal: DaySeries = new Map([['d0', true]]);
    expect(buildDaySequence(new Map(), signal, ['d0'])).toEqual([{ active: false, pass: true }]);
  });
});

// ─── statusForVerdict (P3 e-value 게이트) ────────────────

describe('statusForVerdict', () => {
  it('active + reject → rejected (e 무관, 정당한 제거)', () => {
    expect(statusForVerdict('reject', 'active', 1)).toBe('rejected');
  });

  it('active + direction_mismatch → rejected (역방향 종결, #555)', () => {
    expect(statusForVerdict('direction_mismatch', 'active', 1)).toBe('rejected');
  });

  it('confirmed는 direction_mismatch에도 sticky (엔진이 재검증 안 함)', () => {
    expect(statusForVerdict('direction_mismatch', 'confirmed', 1)).toBe('confirmed');
  });

  it('active + confirm & e≥20 → confirmed (verified 승격)', () => {
    expect(statusForVerdict('confirm', 'active', 25)).toBe('confirmed');
  });

  it('active + confirm & e<20 → active (아직 확정 아님, emerging 후보)', () => {
    expect(statusForVerdict('confirm', 'active', 8)).toBe('active');
  });

  it('active + inconclusive/insufficient → active 유지 (e 무관)', () => {
    expect(statusForVerdict('inconclusive', 'active', 50)).toBe('active');
    expect(statusForVerdict('insufficient', 'active', 50)).toBe('active');
  });

  it('non-active(pending/archived/confirmed)는 엔진이 건드리지 않음 (confirmed sticky)', () => {
    expect(statusForVerdict('reject', 'pending', 1)).toBe('pending');
    expect(statusForVerdict('confirm', 'archived', 99)).toBe('archived');
    expect(statusForVerdict('reject', 'confirmed', 1)).toBe('confirmed');
  });
});

// ─── FDR 가족 분리 (#477 P4a, ADR-0037) ──────────────────

describe('familyOf', () => {
  it('strength_band → saju_strength', () => {
    expect(familyOf({ trigger_target_type: 'strength_band' })).toBe('saju_strength');
  });
  it('relation·hwa_sipsung → saju_relation (#477 P4b)', () => {
    expect(familyOf({ trigger_target_type: 'relation' })).toBe('saju_relation');
    expect(familyOf({ trigger_target_type: 'hwa_sipsung' })).toBe('saju_relation');
  });
  it('그 외(life_signal·stem) → baseline', () => {
    expect(familyOf({ trigger_target_type: 'life_signal' })).toBe('baseline');
    expect(familyOf({ trigger_target_type: 'stem' })).toBe('baseline');
  });
});

describe('bhFdrByFamily', () => {
  it('가족 격리 — 강도 시드 추가가 baseline 가족 q를 바꾸지 않음', () => {
    const baselineAlone = bhFdrByFamily([{ p: 0.01, family: 'baseline' }]);
    expect(baselineAlone[0]).toBeCloseTo(0.01, 6); // N=1

    const withStrength = bhFdrByFamily([
      { p: 0.01, family: 'baseline' },
      { p: 0.5, family: 'saju_strength' },
      { p: 0.6, family: 'saju_strength' },
      { p: 0.7, family: 'saju_strength' },
    ]);
    // baseline 가족은 여전히 N=1 → q=0.01 (한 가족이었다면 0.01*4=0.04로 늦춰짐).
    expect(withStrength[0]).toBeCloseTo(0.01, 6);
  });

  it('가족 내부는 함께 BH-FDR 보정 (monotone)', () => {
    const q = bhFdrByFamily([
      { p: 0.01, family: 'baseline' },
      { p: 0.04, family: 'baseline' },
    ]);
    expect(q[0]).toBeCloseTo(0.02, 6); // 0.01*2/1
    expect(q[1]).toBeCloseTo(0.04, 6); // 0.04*2/2
  });

  it('입력 순서·길이 보존 (가족 섞여 있어도 인덱스 유지)', () => {
    const items = [
      { p: 0.5, family: 'saju_strength' as const },
      { p: 0.01, family: 'baseline' as const },
      { p: 0.6, family: 'saju_strength' as const },
    ];
    const q = bhFdrByFamily(items);
    expect(q).toHaveLength(3);
    expect(q[1]).toBeCloseTo(0.01, 6); // baseline 단독 가족
    expect(Number.isFinite(q[0] ?? NaN)).toBe(true);
    expect(Number.isFinite(q[2] ?? NaN)).toBe(true);
  });

  it('saju_relation 가족 격리 — 관계 batch가 baseline·saju_strength q에 영향 없음 (#477 P4b)', () => {
    const q = bhFdrByFamily([
      { p: 0.01, family: 'baseline' },
      { p: 0.02, family: 'saju_strength' },
      // 자주 발현하는 관계 batch(유한 p 다수) — 자체 가족이라 다른 가족 m을 키우지 않음
      { p: 0.3, family: 'saju_relation' },
      { p: 0.4, family: 'saju_relation' },
      { p: 0.5, family: 'saju_relation' },
    ]);
    expect(q[0]).toBeCloseTo(0.01, 6); // baseline N=1
    expect(q[1]).toBeCloseTo(0.02, 6); // saju_strength N=1
    expect(q[2]).toBeCloseTo(0.5, 6); // saju_relation N=3 → 0.3*3/1
  });
});

// ─── 데이터-존재 윈도우 클립 (#504, ADR-0044) ────────────

describe('buildContingency — windowStart 데이터-존재 클립', () => {
  // 빈 과거(데이터-존재 이전)가 off&fail(d)로 새 들어가 rateOff를 0으로 깔고 effect를 폭발시키는
  // 측정 아티팩트(GIGO) 재현 → windowStart 클립이 교정하는지.
  const activation = new Map<string, boolean>([
    ['2026-01-01', false], // ↓ 빈 과거 4일 (데이터-존재 이전)
    ['2026-01-02', false],
    ['2026-01-03', false],
    ['2026-01-04', false],
    ['2026-01-05', true], // ↓ 실제 데이터 구간
    ['2026-01-06', true],
    ['2026-01-07', false],
    ['2026-01-08', false],
    ['2026-01-09', true],
    ['2026-01-10', false],
  ]);
  const series: DaySeries = new Map([
    ['2026-01-01', false], // COALESCE 0 = fail (결측을 0으로 오인)
    ['2026-01-02', false],
    ['2026-01-03', false],
    ['2026-01-04', false],
    ['2026-01-05', true],
    ['2026-01-06', true],
    ['2026-01-07', true],
    ['2026-01-08', false],
    ['2026-01-09', true],
    ['2026-01-10', true],
  ]);

  it('클립 없으면 빈 과거가 off&fail(d)로 새 → rateOff 폭락 → effect 폭증', () => {
    const cont = buildContingency(activation, series);
    expect(cont).toEqual({ a: 3, b: 0, c: 2, d: 5, inconclusive: 0 });
    expect(verifyContingency(cont).effect).toBeCloseTo(3.5, 1); // (3/3)/(2/7)
  });

  it('windowStart 클립이 빈 과거를 제외 → rateOff 정상화 → effect 정상', () => {
    const cont = buildContingency(activation, series, '2026-01-05');
    expect(cont).toEqual({ a: 3, b: 0, c: 2, d: 1, inconclusive: 0 });
    expect(verifyContingency(cont).effect).toBeCloseTo(1.5, 1); // (3/3)/(2/3)
  });
});

describe('buildDaySequence / splitRawByActivation — windowStart 클립', () => {
  const windowDates = ['2026-01-04', '2026-01-05', '2026-01-06'];
  const act = new Map<string, boolean>([
    ['2026-01-04', true],
    ['2026-01-05', true],
    ['2026-01-06', false],
  ]);

  it('buildDaySequence — windowStart 이전 제외', () => {
    const sig: DaySeries = new Map([
      ['2026-01-04', true],
      ['2026-01-05', false],
      ['2026-01-06', true],
    ]);
    expect(buildDaySequence(act, sig, windowDates, '2026-01-05')).toEqual([
      { active: true, pass: false },
      { active: false, pass: true },
    ]);
  });

  it('splitRawByActivation — windowStart 이전 제외', () => {
    const raw = new Map<string, number | null>([
      ['2026-01-04', 999],
      ['2026-01-05', 500],
      ['2026-01-06', 350],
    ]);
    expect(splitRawByActivation(act, raw, windowDates, '2026-01-05')).toEqual({
      active: [500],
      off: [350],
    });
  });
});

describe('데이터-존재 시작일 헬퍼 (#504)', () => {
  const starts: UserDataStarts = {
    byTable: new Map([
      ['schedules', '2026-03-05'],
      ['sleep_records', '2026-03-10'],
      ['expenses', '2026-01-01'],
      ['routine_records', '2026-03-07'],
      ['schedule_changes', '2026-05-18'], // audit 기록 계기 시작(#572) — schedules와 별개
    ]),
    global: '2026-01-01',
  };

  it('signalDataStart — domain→table MIN, 매핑 없으면 global fallback', () => {
    expect(signalDataStart('sleep', starts)).toBe('2026-03-10');
    expect(signalDataStart('expense', starts)).toBe('2026-01-01');
    expect(signalDataStart('audit', starts)).toBe('2026-05-18'); // audit→schedule_changes(#572, ≠ schedules)
    expect(signalDataStart('unknown', starts)).toBe('2026-01-01'); // fallback
    expect(signalDataStart(null, starts)).toBe('2026-01-01');
  });

  it('seedDataStart — saju=global, life_signal=의존 도메인', () => {
    expect(seedDataStart({ trigger_target_type: 'stem', trigger_aux: null }, starts)).toBe(
      '2026-01-01',
    ); // saju
    expect(
      seedDataStart(
        {
          trigger_target_type: 'life_signal',
          trigger_aux: { kind: 'threshold', source: 'sleep_minutes' },
        },
        starts,
      ),
    ).toBe('2026-03-10');
    expect(
      seedDataStart(
        {
          trigger_target_type: 'life_signal',
          trigger_aux: { kind: 'behavior_baseline', signal_name: 'streak' },
        },
        starts,
      ),
    ).toBe('2026-03-07'); // streak→routine
    // #510 회귀: slotGap·weekComparison은 routine_records 집계라 routine(옛 맵은 schedule=03-05로 오기).
    for (const signal_name of ['slotGap', 'weekComparison']) {
      expect(
        seedDataStart(
          {
            trigger_target_type: 'life_signal',
            trigger_aux: { kind: 'behavior_baseline', signal_name },
          },
          starts,
        ),
      ).toBe('2026-03-07'); // routine_records (≠ schedules 03-05)
    }
    expect(
      seedDataStart(
        { trigger_target_type: 'life_signal', trigger_aux: { kind: 'weekday', dow: 6 } },
        starts,
      ),
    ).toBe('2026-01-01'); // 캘린더 → 데이터 비의존 → global
  });

  it('maxDate — 둘 중 늦은 날, null=제약 없음', () => {
    expect(maxDate('2026-03-10', '2026-03-05')).toBe('2026-03-10');
    expect(maxDate('2026-03-05', '2026-03-10')).toBe('2026-03-10');
    expect(maxDate(null, '2026-03-05')).toBe('2026-03-05');
    expect(maxDate('2026-03-05', null)).toBe('2026-03-05');
    expect(maxDate(null, null)).toBeNull();
  });
});

// ─── computeUserDataStarts audit 특례 (#572, ADR-0054) ────
describe('computeUserDataStarts — audit(schedule_changes) 특례', () => {
  beforeEach(() => resetDb());

  it('schedule_changes 키를 byTable에 넣되 global floor는 DATA_TABLES 산출로 불변', async () => {
    // DATA_TABLES 최소 = expenses 2026-01-01 → global floor. audit 계기(2026-05-18)는 그보다 늦다.
    dataStartByTable = new Map([
      ['schedules', '2026-03-05'],
      ['routine_records', '2026-03-07'],
      ['sleep_records', '2026-03-10'],
      ['expenses', '2026-01-01'],
      ['diary_meta_tags', '2026-03-01'],
    ]);
    auditChangedStart = '2026-05-18';

    const starts = await computeUserDataStarts(1);

    // audit 특례: schedule_changes 키가 changed_at 최소값으로 들어간다(schedules와 별개).
    expect(starts.byTable.get('schedule_changes')).toBe('2026-05-18');
    expect(starts.byTable.get('schedules')).toBe('2026-03-05');
    // global floor는 DATA_TABLES 최소(expenses)로 불변 — audit 계기가 온보딩 floor를 오염시키지 않음.
    expect(starts.global).toBe('2026-01-01');
  });

  it('audit 데이터 없으면 schedule_changes 키 없음, global은 DATA_TABLES로 산출', async () => {
    dataStartByTable = new Map([['schedules', '2026-03-05']]);
    auditChangedStart = null;

    const starts = await computeUserDataStarts(1);

    expect(starts.byTable.has('schedule_changes')).toBe(false);
    expect(starts.global).toBe('2026-03-05');
  });
});

// ─── enrollment 클립 (#523 Phase 0, D1, ADR-0048) ────────
describe('enrollmentStart — 발굴/제안 링크 선택 편향 클립', () => {
  it('manual(카탈로그=선험 가설)은 클립 없음(null)', () => {
    expect(enrollmentStart('manual', '2026-05-01')).toBeNull();
    expect(enrollmentStart('manual', null)).toBeNull();
  });

  it('discovery/llm은 등록(created_at KST) 다음 날부터', () => {
    expect(enrollmentStart('discovery', '2026-05-01')).toBe('2026-05-02');
    expect(enrollmentStart('llm', '2026-05-01')).toBe('2026-05-02');
    expect(enrollmentStart('discovery', '2026-12-31')).toBe('2027-01-01'); // 연 경계
  });

  it('createdDate 결측이면 클립 없음(보수적)', () => {
    expect(enrollmentStart('discovery', null)).toBeNull();
    expect(enrollmentStart('llm', null)).toBeNull();
  });
});

describe('windowStart 3중 maxDate 합성 (#523 Phase 0)', () => {
  // verifyUserLinks의 합성식: max(시드 데이터-존재, 신호 데이터-존재, enrollment).
  const compose = (
    seedStart: string | null,
    signalStart: string | null,
    source: string,
    createdKst: string | null,
  ): string | null => maxDate(maxDate(seedStart, signalStart), enrollmentStart(source, createdKst));

  it('manual: enrollment null → 데이터-존재 max만 (발굴 클립 무영향)', () => {
    expect(compose('2026-01-01', '2026-03-10', 'manual', '2026-05-01')).toBe('2026-03-10');
  });

  it('discovery: 등록 익일이 데이터-존재보다 늦으면 등록 익일이 지배', () => {
    expect(compose('2026-01-01', '2026-03-10', 'discovery', '2026-05-01')).toBe('2026-05-02');
  });

  it('discovery: 데이터-존재가 등록 익일보다 늦으면 데이터-존재가 지배', () => {
    expect(compose('2026-01-01', '2026-06-01', 'discovery', '2026-05-01')).toBe('2026-06-01');
  });
});

describe('enrollment 클립이 검정 시퀀스에서 등록 전 일자를 제외 (#523 Phase 0)', () => {
  // 발굴 링크 created_at=01-05. 활성·발현이 그 전부터 있어도 등록 익일(01-06)부터만 검정에 든다.
  const windowDates = ['2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'];
  const act = new Map<string, boolean>([
    ['2026-01-04', true],
    ['2026-01-05', true],
    ['2026-01-06', true],
    ['2026-01-07', false],
  ]);
  const sig: DaySeries = new Map([
    ['2026-01-04', true],
    ['2026-01-05', true],
    ['2026-01-06', false],
    ['2026-01-07', true],
  ]);

  it('discovery 등록 익일(01-06) 클립 → 그 전 발현(01-04·05)이 시퀀스에서 빠짐', () => {
    const windowStart = enrollmentStart('discovery', '2026-01-05');
    expect(windowStart).toBe('2026-01-06');
    expect(buildDaySequence(act, sig, windowDates, windowStart)).toEqual([
      { active: true, pass: false }, // 01-06
      { active: false, pass: true }, // 01-07
    ]);
  });

  it('manual은 클립 없음 → 전체 윈도우 유지', () => {
    const windowStart = enrollmentStart('manual', '2026-01-05'); // null
    expect(buildDaySequence(act, sig, windowDates, windowStart)).toEqual([
      { active: true, pass: true }, // 01-04
      { active: true, pass: true }, // 01-05
      { active: true, pass: false }, // 01-06
      { active: false, pass: true }, // 01-07
    ]);
  });
});

// ─── splitHalvesConsistent (#523 P1, stability 플래그) ─────

describe('splitHalvesConsistent', () => {
  const o = (active: boolean, pass: boolean): { active: boolean; pass: boolean } => ({
    active,
    pass,
  });

  it('전·후반 효과 부호 같음 → true', () => {
    const seq = [
      o(true, true),
      o(false, false),
      o(true, true),
      o(false, false), // 전반: active 우세(+)
      o(true, true),
      o(false, false),
      o(true, true),
      o(false, false), // 후반: active 우세(+)
    ];
    expect(splitHalvesConsistent(seq)).toBe(true);
  });

  it('전·후반 부호 뒤집힘 → false', () => {
    const seq = [
      o(true, true),
      o(false, false),
      o(true, true),
      o(false, false), // 전반: active 우세(+)
      o(true, false),
      o(false, true),
      o(true, false),
      o(false, true), // 후반: active 열세(−)
    ];
    expect(splitHalvesConsistent(seq)).toBe(false);
  });

  it('한 반에 발현·비발현 한쪽만 → null(판정 보류)', () => {
    const seq = [
      o(true, true),
      o(true, false),
      o(true, true),
      o(true, false), // 전반: 전부 발현 → off 없음
      o(true, true),
      o(false, false),
      o(true, true),
      o(false, false),
    ];
    expect(splitHalvesConsistent(seq)).toBeNull();
  });

  it('너무 짧으면(<minPerHalf*2) null', () => {
    expect(splitHalvesConsistent([o(true, true), o(false, false)])).toBeNull();
  });
});

// ─── ensureMirrorSignalDef (#555) ────────────────────────

describe('ensureMirrorSignalDef', () => {
  const sqlSignal = (over: Partial<FakeSignalRow> = {}): FakeSignalRow => ({
    id: 10,
    name: 'sig_above',
    kind: 'sql',
    source: 'seed',
    sql_body: 'SELECT 1',
    value_type: 'continuous',
    direction: 'above_avg',
    threshold: null,
    tag_name: null,
    window_days: 28,
    domain: 'sleep',
    description: '설명',
    ...over,
  });

  beforeEach(() => resetDb());

  it('above_avg 신호 & 거울 없음 → below_avg 신호 생성', async () => {
    signalRow = sqlSignal({ direction: 'above_avg' });
    mirrorRows = [];
    const res = await ensureMirrorSignalDef(1, 10);
    expect(res.outcome).toBe('created');
    expect(res.mirrorSignalId).toBe(999);
    expect(inserts).toHaveLength(1);
    // INSERT는 direction만 반전(below_avg), status='active', pattern_links 생성 없음.
    expect(inserts[0]?.params).toContain('below_avg');
    expect(inserts[0]?.sql).toMatch(/INSERT INTO signal_defs/);
    expect(inserts[0]?.sql).not.toMatch(/pattern_links/);
  });

  it('below_avg 신호 → above_avg 방향으로 반전 생성', async () => {
    signalRow = sqlSignal({ name: 'sig_below', direction: 'below_avg' });
    mirrorRows = [];
    const res = await ensureMirrorSignalDef(1, 10);
    expect(res.outcome).toBe('created');
    expect(inserts[0]?.params).toContain('above_avg');
  });

  it('거울이 active로 이미 존재 → no-op(exists)', async () => {
    signalRow = sqlSignal();
    mirrorRows = [{ status: 'active' }];
    const res = await ensureMirrorSignalDef(1, 10);
    expect(res.outcome).toBe('exists');
    expect(res.mirrorSignalId).toBeNull();
    expect(inserts).toHaveLength(0);
  });

  it('거울이 pending으로 존재 → no-op(exists)', async () => {
    signalRow = sqlSignal();
    mirrorRows = [{ status: 'pending' }];
    const res = await ensureMirrorSignalDef(1, 10);
    expect(res.outcome).toBe('exists');
    expect(inserts).toHaveLength(0);
  });

  it('기각 이력만 존재(active/pending 없음) → 생성 스킵(skipped_rejected)', async () => {
    signalRow = sqlSignal();
    mirrorRows = [{ status: 'rejected' }];
    const res = await ensureMirrorSignalDef(1, 10);
    expect(res.outcome).toBe('skipped_rejected');
    expect(inserts).toHaveLength(0);
  });

  it('above_abs 신호 → 반전 대상 아님(ineligible)', async () => {
    signalRow = sqlSignal({ direction: 'above_abs' });
    const res = await ensureMirrorSignalDef(1, 10);
    expect(res.outcome).toBe('ineligible');
    expect(inserts).toHaveLength(0);
  });

  it('tag 신호 → 방향 없음(ineligible)', async () => {
    signalRow = sqlSignal({ kind: 'tag', direction: null, sql_body: null, tag_name: 'flow' });
    const res = await ensureMirrorSignalDef(1, 10);
    expect(res.outcome).toBe('ineligible');
    expect(inserts).toHaveLength(0);
  });

  it('llm 출신 신호 → 대상 아님(ineligible, seed만 거울 보장)', async () => {
    signalRow = sqlSignal({ source: 'llm' });
    const res = await ensureMirrorSignalDef(1, 10);
    expect(res.outcome).toBe('ineligible');
    expect(inserts).toHaveLength(0);
  });

  it('신호 없음(교차 유저·삭제) → ineligible', async () => {
    signalRow = null;
    const res = await ensureMirrorSignalDef(1, 10);
    expect(res.outcome).toBe('ineligible');
    expect(inserts).toHaveLength(0);
  });
});
