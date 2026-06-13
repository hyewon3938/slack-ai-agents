import { describe, it, expect, vi } from 'vitest';

// descriptiveStats inline SQL은 빈 결과로 모킹 — 측정/교과서/렌더 결정론만 검증.
vi.mock('../db.js', () => ({
  query: vi.fn(async () => ({ rows: [] })),
}));

import {
  derivePeriodContext,
  buildInterpretationPayload,
  renderInterpretationBlocks,
  type PeriodInterpretationRecord,
  type InterpretationPayload,
} from '../period-interpretation.js';
import { indexCells, type ResponseCell } from '../response-profile.js';
import { makePillar, type Cheongan, type Jiji } from '../saju-calendar.js';
import type { LedgerCardData, ForecastSourceCell } from '../period-forecast.js';

const NATAL = {
  dayMaster: '갑' as Cheongan,
  stems: ['갑', '병', '경', '임'] as Cheongan[],
  branches: ['자', '인', '신', '오'] as Jiji[], // 인신충 발생 (지지에 신·인)
};

const cell = (over: Partial<ResponseCell>): ResponseCell => ({
  axisLevel: 'char_stem',
  axisKey: '병',
  element: '화',
  domain: 'schedule',
  tier: 'emerging',
  alpha: 2,
  beta: 2,
  shrunkEffect: 1.5,
  nLinks: 1,
  nActiveDays: 20, // ≥ cellMinActive(15) → stopAtChar
  stability: null,
  sourceLinkIds: [1],
  ...over,
});

// ─── derivePeriodContext (결정론) ────────────────────────

describe('derivePeriodContext', () => {
  it('갑 일간 + 병인 → 식신(천간)·비견(지지)·화/목 결정론', () => {
    const ctx = derivePeriodContext(NATAL, makePillar('병', '인'), 'wolun');
    expect(ctx.stem).toBe('병');
    expect(ctx.branch).toBe('인');
    expect(ctx.stemSipsung).toBe('식신'); // 갑(목)→병(화) 식신
    expect(ctx.branchSipsung).toBe('비견'); // 인 본기 갑(목) vs 갑 = 비견
    expect(ctx.stemElement).toBe('화');
    expect(ctx.branchElement).toBe('목');
  });

  it('합충 도출 — 원국 신(申) vs 기간 인(寅) = 인신충', () => {
    const ctx = derivePeriodContext(NATAL, makePillar('병', '인'), 'wolun');
    expect(ctx.relations.jijiChung.some((s) => s.includes('인') && s.includes('신'))).toBe(true);
  });

  it('입력 동일 → 출력 동일 (순수)', () => {
    const a = derivePeriodContext(NATAL, makePillar('병', '인'), 'seun');
    const b = derivePeriodContext(NATAL, makePillar('병', '인'), 'seun');
    expect(a).toEqual(b);
  });
});

// ─── buildInterpretationPayload (불변식 + 교과서 dedup) ───

describe('buildInterpretationPayload', () => {
  it('불변식: measuredCells 전수가 profileIndex 행 출신', async () => {
    const index = indexCells([
      cell({ axisLevel: 'char_stem', axisKey: '병', domain: 'schedule', nActiveDays: 20 }),
      cell({
        axisLevel: 'group',
        axisKey: '재성',
        element: '토',
        domain: 'sleep',
        nActiveDays: 18,
      }),
    ]);
    const ctx = derivePeriodContext(NATAL, makePillar('병', '인'), 'wolun');
    const payload = await buildInterpretationPayload(
      ctx,
      index,
      { dayMaster: '갑' },
      { start: '2024-03-10', end: '2024-04-03' },
      1,
      '2026-06-13',
    );
    expect(payload.measuredCells.length).toBeGreaterThan(0);
    for (const m of payload.measuredCells) {
      expect(index.has(`${m.resolvedLevel}|${m.axisKey}|${m.domain}`)).toBe(true);
    }
  });

  it('측정된 축은 교과서에서 제외 — stem 측정 시 stem-sipsung 빠지고 branch-sipsung 남음', async () => {
    const index = indexCells([
      cell({ axisLevel: 'char_stem', axisKey: '병', domain: 'schedule', nActiveDays: 20 }),
    ]);
    const ctx = derivePeriodContext(NATAL, makePillar('병', '인'), 'wolun');
    const payload = await buildInterpretationPayload(
      ctx,
      index,
      { dayMaster: '갑' },
      { start: '2024-03-10', end: '2024-04-03' },
      1,
      '2026-06-13',
    );
    expect(payload.textbookCells.some((t) => t.axis === 'stem-sipsung')).toBe(false);
    expect(payload.textbookCells.some((t) => t.axis === 'branch-sipsung')).toBe(true);
    // 합충은 항상 교과서(가중치 편입 금지)
    expect(payload.textbookCells.some((t) => t.axis === 'relation')).toBe(true);
  });

  it('빈 프로필 → measuredCells 0, 교과서·합충으로 채움 (D8 대비)', async () => {
    const index = indexCells([]);
    const ctx = derivePeriodContext(NATAL, makePillar('병', '인'), 'wolun');
    const payload = await buildInterpretationPayload(
      ctx,
      index,
      { dayMaster: '갑' },
      { start: '2024-03-10', end: '2024-04-03' },
      1,
      '2026-06-13',
    );
    expect(payload.measuredCells).toHaveLength(0);
    expect(payload.textbookCells.length).toBeGreaterThan(0);
  });
});

// ─── renderInterpretationBlocks (결정론 렌더 + D8) ────────

const payloadWith = (over: Partial<InterpretationPayload>): InterpretationPayload => ({
  measuredCells: [],
  textbookCells: [],
  descriptiveStats: {
    scope: '테스트 범위',
    rangeCount: 0,
    sleep: null,
    routine: null,
    diary: null,
  },
  ...over,
});

const record = (payload: InterpretationPayload): PeriodInterpretationRecord => ({
  periodType: 'wolun',
  pillar: '병인',
  periodStart: '2026-07-07',
  periodEnd: '2026-08-06',
  payload,
  narrative: '서사 텍스트야.',
});

describe('renderInterpretationBlocks', () => {
  it('측정 셀 있으면 측정 섹션 렌더', () => {
    const blocks = renderInterpretationBlocks(
      record(
        payloadWith({
          measuredCells: [
            {
              domain: 'schedule',
              via: 'stem',
              resolvedLevel: 'char_stem',
              axisKey: '병',
              element: '화',
              tier: 'emerging',
              shrunkEffect: 1.5,
              nActiveDays: 20,
              sourceLinkIds: [1],
            },
          ],
        }),
      ),
    );
    const txt = JSON.stringify(blocks);
    expect(txt).toContain('측정된 너의 반응');
    expect(txt).toContain('탐색적');
  });

  it('measuredCells=0 일급 경로 — 빈 카드 아님, 교과서·누적·사다리로 채움 (D8)', () => {
    const blocks = renderInterpretationBlocks(
      record(
        payloadWith({
          textbookCells: [{ axis: 'stem-sipsung', label: '식신', gloss: '표현·여유' }],
        }),
      ),
    );
    const txt = JSON.stringify(blocks);
    expect(txt).toContain('아직 없어'); // 측정 0 명시
    expect(txt).toContain('교과서 일반론');
    // 사다리 지위 + 전이 가설 footer는 항상
    expect(blocks.some((b) => b.type === 'context')).toBe(true);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });

  it('세운/대운 라벨·전이 가설 footer 동반', () => {
    const blocks = renderInterpretationBlocks({
      ...record(payloadWith({})),
      periodType: 'daeun',
    });
    const txt = JSON.stringify(blocks);
    expect(txt).toContain('대운');
    expect(txt).toContain('검증');
  });

  // ─── 예측 장부 섹션 (Phase 3) ──────────────────────────
  const srcCell = (axisKey: string, signalId: number): ForecastSourceCell => ({
    domain: 'sleep',
    via: 'stem',
    resolvedLevel: 'char_stem',
    axisKey,
    element: '화',
    tier: 'emerging',
    shrunkEffect: 1.5,
    nActiveDays: 20,
    signalId,
  });

  it('ledger 주입 — 지난 채점 결과(적중+delta %p) + 이번 예측 섹션 노출', () => {
    const ledger: LedgerCardData = {
      periodType: 'wolun',
      scored: [
        {
          signalId: 1,
          status: 'scored',
          predictedDirection: 'up',
          baselineRate: 0.3,
          measuredRate: 0.7,
          measuredDelta: 0.4,
          directionHit: true,
          sourceCell: srcCell('병', 1),
        },
      ],
      forecasts: [
        {
          signalId: 2,
          status: 'open',
          predictedDirection: 'up',
          baselineRate: 0.4,
          sourceCell: srcCell('정', 2),
        },
      ],
    };
    const txt = JSON.stringify(renderInterpretationBlocks(record(payloadWith({})), ledger));
    expect(txt).toContain('지난 기간 장부 결과');
    expect(txt).toContain('적중');
    expect(txt).toContain('+40%p');
    expect(txt).toContain('이번 기간 예측');
    // baseline 원수치(0.3/0.4 → 30%/40%)는 비노출 (§9)
    expect(txt).not.toContain('30%)');
  });

  it('ledger no_call — 예측 안 함도 명시(D8, 침묵 금지)', () => {
    const ledger: LedgerCardData = {
      periodType: 'seun',
      scored: [],
      forecasts: [
        {
          signalId: null,
          status: 'no_call',
          predictedDirection: null,
          baselineRate: null,
          sourceCell: { reason: '측정된 반응이 아직 없어' },
        },
      ],
    };
    const txt = JSON.stringify(renderInterpretationBlocks(record(payloadWith({})), ledger));
    expect(txt).toContain('이번 기간 예측');
    expect(txt).toContain('예측 안 함');
    expect(txt).toContain('측정된 반응이 아직 없어');
  });

  it('ledger 미주입 — 장부 섹션 없음(기존 동작 보존)', () => {
    const txt = JSON.stringify(renderInterpretationBlocks(record(payloadWith({}))));
    expect(txt).not.toContain('이번 기간 예측');
    expect(txt).not.toContain('지난 기간 장부 결과');
  });
});
