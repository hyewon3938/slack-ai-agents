import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from '@slack/bolt';
import type { LinkVerification } from '../../../shared/pattern/types.js';
import type { ConfoundResult } from '../../../shared/pattern/confound-types.js';

// 단계마다 DB·Slack 경계라 모두 mock — processUser의 순서·격리 계약만 본다.
vi.mock('../../../shared/pattern/verify-links.js', () => ({ verifyUserLinks: vi.fn() }));
vi.mock('../../../shared/pattern/strength-cutpoints.js', () => ({
  computeStrengthCutpoints: vi.fn(),
}));
vi.mock('../../../shared/pattern/mirror-signal.js', () => ({ ensureMirrorSignalDef: vi.fn() }));
vi.mock('../../../shared/pattern/confound-flag.js', () => ({ flagConfounds: vi.fn() }));
vi.mock('../../../shared/pattern/seed-saturation.js', () => ({ runSaturationSweep: vi.fn() }));
vi.mock('../../discovery-recommend.js', () => ({ recommendDiscoveries: vi.fn() }));
vi.mock('../persist-links.js', () => ({
  persistLinkVerification: vi.fn(),
  persistWeeklySnapshot: vi.fn(),
  persistStrengthCutpoints: vi.fn(),
  persistConfound: vi.fn(),
}));
vi.mock('../response-profile.js', () => ({ persistResponseProfile: vi.fn() }));

const { processUser } = await import('../process-user.js');
const { verifyUserLinks } = await import('../../../shared/pattern/verify-links.js');
const { computeStrengthCutpoints } = await import('../../../shared/pattern/strength-cutpoints.js');
const { ensureMirrorSignalDef } = await import('../../../shared/pattern/mirror-signal.js');
const { flagConfounds } = await import('../../../shared/pattern/confound-flag.js');
const { runSaturationSweep } = await import('../../../shared/pattern/seed-saturation.js');
const { recommendDiscoveries } = await import('../../discovery-recommend.js');
const { persistLinkVerification, persistWeeklySnapshot, persistConfound } = await import(
  '../persist-links.js'
);
const { persistResponseProfile } = await import('../response-profile.js');

// ─── helpers ─────────────────────────────────────────────
const APP = {} as App;
const USER = 1;
const run = (): Promise<void> => processUser(APP, USER, 'C-TEST', '2026-03-02', '2026-03-08');

const makeLink = (linkId: number, over: Partial<LinkVerification> = {}): LinkVerification => ({
  linkId,
  seedId: 1,
  signalId: linkId * 10,
  seedName: 'seed_1',
  seedLabel: '시드 1',
  patternKind: 'saju',
  signalName: `signal_${linkId}`,
  signalLabel: `신호 ${linkId}`,
  signalKind: 'sql',
  valueType: 'binary',
  currentStatus: 'active',
  a: 0,
  b: 0,
  c: 0,
  d: 0,
  inconclusive: 0,
  nActive: 0,
  nOff: 0,
  rateActive: 0,
  rateOff: 0,
  effect: 1,
  pValue: 1,
  fisherP: 1,
  qValue: 1,
  mannWhitney: null,
  posteriorAlpha: 1,
  posteriorBeta: 1,
  posteriorP: 0.5,
  eValue: 1,
  lastMatchedAt: null,
  windowStart: null,
  family: 'baseline',
  stability: null,
  verdict: 'inconclusive',
  nextStatus: 'active',
  ...over,
});

const makeConfound = (linkId: number): ConfoundResult => ({
  linkId,
  confound: { scannedAt: '2026-03-08', suspected: [] },
});

const boom = (): Promise<never> => Promise.reject(new Error('fixture failure'));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(computeStrengthCutpoints).mockResolvedValue([]);
  vi.mocked(verifyUserLinks).mockResolvedValue([]);
  vi.mocked(runSaturationSweep).mockResolvedValue({ archived: [], revived: [] });
  vi.mocked(flagConfounds).mockResolvedValue([]);
});

// ─── 단계 격리 ───────────────────────────────────────────

describe('processUser 단계 격리', () => {
  it('강도 컷 산출이 실패해도 링크 검증과 저장은 진행한다', async () => {
    vi.mocked(computeStrengthCutpoints).mockImplementation(boom);
    vi.mocked(verifyUserLinks).mockResolvedValue([makeLink(1)]);

    await run();

    expect(persistLinkVerification).toHaveBeenCalledTimes(1);
    expect(persistWeeklySnapshot).toHaveBeenCalledTimes(1);
  });

  it('링크 검증 자체가 실패하면 예외를 올리고 뒤 단계를 돌리지 않는다', async () => {
    vi.mocked(verifyUserLinks).mockImplementation(boom);

    await expect(run()).rejects.toThrow('fixture failure');
    expect(runSaturationSweep).not.toHaveBeenCalled();
    expect(recommendDiscoveries).not.toHaveBeenCalled();
    expect(persistResponseProfile).not.toHaveBeenCalled();
  });

  it('한 링크 저장이 실패하면 그 링크 스냅샷만 건너뛰고 다음 링크는 저장한다', async () => {
    vi.mocked(verifyUserLinks).mockResolvedValue([makeLink(1), makeLink(2)]);
    vi.mocked(persistLinkVerification).mockImplementation(async (l) => {
      if (l.linkId === 1) throw new Error('fixture failure');
    });

    await run();

    expect(vi.mocked(persistLinkVerification).mock.calls.map(([l]) => l.linkId)).toEqual([1, 2]);
    expect(vi.mocked(persistWeeklySnapshot).mock.calls.map(([, l]) => l.linkId)).toEqual([2]);
  });

  it('포화 sweep이 실패해도 교란 플래그·발굴·프로필 집계는 진행한다', async () => {
    vi.mocked(runSaturationSweep).mockImplementation(boom);

    await run();

    expect(flagConfounds).toHaveBeenCalledTimes(1);
    expect(recommendDiscoveries).toHaveBeenCalledTimes(1);
    expect(persistResponseProfile).toHaveBeenCalledTimes(1);
  });

  it('교란 플래그 산출이 실패해도 발굴과 프로필 집계는 진행한다', async () => {
    vi.mocked(flagConfounds).mockImplementation(boom);

    await run();

    expect(recommendDiscoveries).toHaveBeenCalledTimes(1);
    expect(persistResponseProfile).toHaveBeenCalledTimes(1);
  });

  it('교란 결과 하나의 저장이 실패해도 다음 결과는 저장한다', async () => {
    vi.mocked(flagConfounds).mockResolvedValue([makeConfound(1), makeConfound(2)]);
    vi.mocked(persistConfound).mockImplementation(async (_userId, r) => {
      if (r.linkId === 1) throw new Error('fixture failure');
    });

    await run();

    expect(vi.mocked(persistConfound).mock.calls.map(([, r]) => r.linkId)).toEqual([1, 2]);
  });

  it('발굴이 실패해도 프로필 집계는 진행한다', async () => {
    vi.mocked(recommendDiscoveries).mockImplementation(boom);

    await run();

    expect(persistResponseProfile).toHaveBeenCalledTimes(1);
  });
});

// ─── 역방향 거울 신호 ────────────────────────────────────

describe('processUser 역방향 거울 신호', () => {
  it.each([
    { verdict: 'direction_mismatch', nextStatus: 'rejected', called: true },
    { verdict: 'direction_mismatch', nextStatus: 'active', called: false },
    { verdict: 'reject', nextStatus: 'rejected', called: false },
  ] as const)(
    'verdict=$verdict, nextStatus=$nextStatus이면 거울 보장 호출 여부는 $called',
    async ({ verdict, nextStatus, called }) => {
      vi.mocked(verifyUserLinks).mockResolvedValue([makeLink(1, { verdict, nextStatus })]);

      await run();

      if (called) expect(ensureMirrorSignalDef).toHaveBeenCalledWith(USER, 10);
      else expect(ensureMirrorSignalDef).not.toHaveBeenCalled();
    },
  );

  it('링크 저장이 실패해도 그 링크의 거울 보장은 시도한다', async () => {
    vi.mocked(verifyUserLinks).mockResolvedValue([
      makeLink(1, { verdict: 'direction_mismatch', nextStatus: 'rejected' }),
    ]);
    vi.mocked(persistLinkVerification).mockImplementation(boom);

    await run();

    expect(ensureMirrorSignalDef).toHaveBeenCalledWith(USER, 10);
  });

  it('거울 보장이 실패해도 다음 링크 저장과 거울 보장은 진행한다', async () => {
    const mismatch = { verdict: 'direction_mismatch', nextStatus: 'rejected' } as const;
    vi.mocked(verifyUserLinks).mockResolvedValue([makeLink(1, mismatch), makeLink(2, mismatch)]);
    vi.mocked(ensureMirrorSignalDef).mockImplementation(async (_userId, signalId) => {
      if (signalId === 10) throw new Error('fixture failure');
      return { outcome: 'exists', mirrorSignalId: null };
    });

    await run();

    expect(vi.mocked(persistLinkVerification).mock.calls.map(([l]) => l.linkId)).toEqual([1, 2]);
    expect(vi.mocked(ensureMirrorSignalDef).mock.calls.map(([, id]) => id)).toEqual([10, 20]);
  });
});
