/**
 * 사주 가설 1차 셋업 백테스팅 — admin script.
 * ADR-0019 Phase 4.
 *
 * 누적된 시드 outcome + diary_meta_tags 60일을 1회 스캔해 후보 가설 콘솔 출력.
 * 사용자가 결과를 보고 가설 5\~10개를 직접 등록 (`/insight 가설` 명령 또는 신규 register API).
 *
 * 실행: yarn tsx scripts/saju-hypothesis-backtest.ts --user 1 --lookback 60
 */

import { discoverCandidates } from '../src/agents/insight/hypothesis-discovery.js';

interface CliArgs {
  userId: number;
  lookbackDays: number;
}

const parseArgs = (argv: string[]): CliArgs => {
  let userId = 1;
  let lookbackDays = 60;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--user' && value) {
      userId = Number(value);
      i++;
    } else if (flag === '--lookback' && value) {
      lookbackDays = Number(value);
      i++;
    }
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error('--user 옵션이 양의 정수여야 함');
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays < 14) {
    throw new Error('--lookback 옵션은 14 이상이어야 함 (통계 안정성)');
  }
  return { userId, lookbackDays };
};

const main = async (): Promise<void> => {
  const { userId, lookbackDays } = parseArgs(process.argv.slice(2));
  console.warn(`[Backtest] user=${userId} lookback=${lookbackDays}일 스캔 시작`);

  const candidates = await discoverCandidates(userId, {
    mode: 'setup',
    lookbackDays,
  });

  if (candidates.length === 0) {
    console.warn('[Backtest] 통계 임계 통과 후보 없음. lookback 늘리거나 데이터 누적 더 기다려.');
    return;
  }

  console.warn(`\n[Backtest] 후보 ${candidates.length}건 (rate_ratio 내림차순):\n`);
  console.warn(
    '시드 → enum                        | n  | trig%  | base%  | ratio | raw_p   | fdr_q',
  );
  console.warn(
    '----------------------------------|----|--------|--------|-------|---------|--------',
  );
  for (const c of candidates) {
    const label = `${c.signalName} → ${c.enumTarget}`.padEnd(34);
    const n = String(c.nTriggerDays).padStart(3);
    const trigPct = `${(c.rateTrigger * 100).toFixed(1)}%`.padStart(6);
    const basePct = `${(c.rateBaseline * 100).toFixed(1)}%`.padStart(6);
    const ratio = c.rateRatio.toFixed(2).padStart(5);
    const rawP = c.rawP.toFixed(4).padStart(7);
    const fdrQ = c.fdrQ.toFixed(4).padStart(7);
    console.warn(`${label} | ${n} | ${trigPct} | ${basePct} | ${ratio} | ${rawP} | ${fdrQ}`);
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Backtest] 실패:', err);
    process.exit(1);
  });
