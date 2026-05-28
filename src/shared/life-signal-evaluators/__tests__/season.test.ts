import { describe, expect, it } from 'vitest';

import type { DailyContext, SeasonAux } from '../../pattern-match.js';
import { evaluateSeason } from '../season.js';

const baseCtx = (date: string): DailyContext => ({ date, userId: 1 }) as unknown as DailyContext;

describe('evaluateSeason', () => {
  it('봄 = 3, 4, 5월', async () => {
    const aux: SeasonAux = { kind: 'season', season: 'spring' };
    expect(await evaluateSeason(aux, baseCtx('2026-03-15'))).toBe(true);
    expect(await evaluateSeason(aux, baseCtx('2026-05-31'))).toBe(true);
    expect(await evaluateSeason(aux, baseCtx('2026-02-28'))).toBe(false);
    expect(await evaluateSeason(aux, baseCtx('2026-06-01'))).toBe(false);
  });

  it('여름 = 6, 7, 8월', async () => {
    const aux: SeasonAux = { kind: 'season', season: 'summer' };
    expect(await evaluateSeason(aux, baseCtx('2026-06-01'))).toBe(true);
    expect(await evaluateSeason(aux, baseCtx('2026-08-31'))).toBe(true);
    expect(await evaluateSeason(aux, baseCtx('2026-09-01'))).toBe(false);
  });

  it('가을 = 9, 10, 11월', async () => {
    const aux: SeasonAux = { kind: 'season', season: 'autumn' };
    expect(await evaluateSeason(aux, baseCtx('2026-09-01'))).toBe(true);
    expect(await evaluateSeason(aux, baseCtx('2026-11-30'))).toBe(true);
    expect(await evaluateSeason(aux, baseCtx('2026-12-01'))).toBe(false);
  });

  it('겨울 = 12, 1, 2월 (연말연시 경계)', async () => {
    const aux: SeasonAux = { kind: 'season', season: 'winter' };
    expect(await evaluateSeason(aux, baseCtx('2026-12-31'))).toBe(true);
    expect(await evaluateSeason(aux, baseCtx('2026-01-01'))).toBe(true);
    expect(await evaluateSeason(aux, baseCtx('2026-02-28'))).toBe(true);
    expect(await evaluateSeason(aux, baseCtx('2026-03-01'))).toBe(false);
  });
});
