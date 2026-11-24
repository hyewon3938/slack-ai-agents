/**
 * 만세력 계산 유틸리티.
 * 결정론적 사주 데이터(일주/월주/년주/십성/십이운성/합충)를 코드로 계산.
 * 모든 함수는 일간/원국을 파라미터로 받는 범용 유틸리티 (개인 데이터 하드코딩 없음).
 *
 * CLI: npx tsx src/shared/saju-calendar.ts [날짜] [일수]
 * 모듈: import { getDayPillar, calculateDailyFortune } from './saju-calendar.js'
 *
 * 구현은 ./saju/ 아래 역할별 파일에 있고, 이 파일은 공개 심볼 재수출과 CLI 진입점만 맡는다.
 */

import { fileURLToPath } from 'node:url';
import { runCLI } from './saju/cli.js';

export type {
  Cheongan,
  Jiji,
  Sipsung,
  Sibiunsung,
  Pillar,
  SipsungResult,
  JijangganEntry,
  Relations,
  DailyFortuneData,
  Element,
  PillarSet,
} from './saju/types.js';
export type { StemHapRule, BranchHapRule } from './saju/tables.js';
export {
  CHEONGAN_HAP_RULES,
  JIJI_YUKHAP_RULES,
  JIJI_SAMHAP_RULES,
  JIJI_CHUNG_PAIRS,
} from './saju/tables.js';
export {
  getDayPillar,
  getYearPillar,
  getIpchunDate,
  getMonthPillar,
  getJeolgiMonthRange,
  isJeolgiTransitionDay,
} from './saju/pillars.js';
export {
  getSipsung,
  getJijiSipsung,
  getSipsungResult,
  getSibiunsung,
  getJijanggan,
} from './saju/sipsung.js';
export { getRelations } from './saju/relations.js';
export { calculateDailyFortune, calculateFortuneRange } from './saju/fortune.js';
export {
  getElementByCheongan,
  getElementByJiji,
  makePillar,
  parsePillarString,
  getDaeunPillar,
} from './saju/pillar-utils.js';

// CLI 진입점
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  runCLI().catch((err: unknown) => {
    console.error('[saju-calendar] 오류:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
