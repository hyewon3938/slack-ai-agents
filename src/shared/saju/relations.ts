/** 합충형파해 분석. */

import type { Cheongan, Jiji, Relations } from './types.js';
import {
  CHEONGAN_LIST,
  JIJI_LIST,
  JIJANGGAN,
  CHEONGAN_HAP,
  JIJI_CHUNG,
  JIJI_YUKHAP,
  JIJI_SAMHAP,
  JIJI_HYUNG,
  JIJI_PA,
  JIJI_HAE,
} from './tables.js';
import { cheonganIndex, jijiIndex } from './helpers.js';

// ─── 합충형파해 분석 ────────────────────────────────────

/** 원국과 일운 간 합충형파해 관계 탐지 */
export const getRelations = (
  wonkukStems: readonly Cheongan[],
  wonkukBranches: readonly Jiji[],
  targetStem: Cheongan | string,
  targetBranch: Jiji | string,
): Relations => {
  const tStemIdx = cheonganIndex(targetStem);
  const tBranchIdx = jijiIndex(targetBranch);

  const result: Relations = {
    cheonganHap: [],
    jijiChung: [],
    jijiHap: [],
    jijiHyung: [],
    jijipa: [],
    jijiHae: [],
    amhap: [],
  };

  // 천간합 탐지
  for (let i = 0; i < wonkukStems.length; i++) {
    const wIdx = cheonganIndex(wonkukStems[i]);
    for (const [a, b, element] of CHEONGAN_HAP) {
      if ((tStemIdx === a && wIdx === b) || (tStemIdx === b && wIdx === a)) {
        result.cheonganHap.push(`${CHEONGAN_LIST[tStemIdx]}-${wonkukStems[i]} 합(${element})`);
      }
    }
  }

  // 지지 관계 탐지
  for (let i = 0; i < wonkukBranches.length; i++) {
    const wIdx = jijiIndex(wonkukBranches[i]);
    checkJijiRelation(tBranchIdx, wIdx, JIJI_CHUNG, result.jijiChung, '충');
    checkJijiYukhap(tBranchIdx, wIdx, result.jijiHap);
    checkJijiRelation(tBranchIdx, wIdx, JIJI_HYUNG, result.jijiHyung, '형');
    checkJijiRelation(tBranchIdx, wIdx, JIJI_PA, result.jijipa, '파');
    checkJijiRelation(tBranchIdx, wIdx, JIJI_HAE, result.jijiHae, '해');
  }

  // 삼합 부분 체크 (일운 지지 + 원국 지지 2개 이상이면 삼합 성립)
  checkSamhap(tBranchIdx, wonkukBranches, result.jijiHap);

  // 암합 탐지 (지장간 간 천간합)
  checkAmhap(tBranchIdx, wonkukBranches, result.amhap);

  return result;
};

/** 지지 관계 체크 (충/형/파/해) */
const checkJijiRelation = (
  a: number,
  b: number,
  table: readonly (readonly [number, number])[],
  results: string[],
  label: string,
): void => {
  for (const [x, y] of table) {
    if ((a === x && b === y) || (a === y && b === x)) {
      results.push(`${JIJI_LIST[a]}-${JIJI_LIST[b]} ${label}`);
      return; // 중복 방지
    }
  }
};

/** 지지 육합 체크 */
const checkJijiYukhap = (a: number, b: number, results: string[]): void => {
  for (const [x, y, element] of JIJI_YUKHAP) {
    if ((a === x && b === y) || (a === y && b === x)) {
      results.push(`${JIJI_LIST[a]}-${JIJI_LIST[b]} 합(${element})`);
      return;
    }
  }
};

/** 삼합 체크: 일운 지지 + 원국 지지에서 삼합 구성 확인 */
const checkSamhap = (
  targetBranch: number,
  wonkukBranches: readonly Jiji[],
  results: string[],
): void => {
  const wIdxSet = new Set(wonkukBranches.map(jijiIndex));

  for (const [a, b, c, element] of JIJI_SAMHAP) {
    const trio = [a, b, c];
    if (!trio.includes(targetBranch)) continue;

    // 일운 지지를 포함한 삼합에서, 원국에 나머지 2개 중 1개 이상 있으면 반삼합
    const others = trio.filter((t) => t !== targetBranch);
    const matchCount = others.filter((t) => wIdxSet.has(t)).length;

    if (matchCount >= 2) {
      results.push(`${JIJI_LIST[a]}${JIJI_LIST[b]}${JIJI_LIST[c]} 삼합(${element})`);
    } else if (matchCount === 1) {
      const matched = others.find((t) => wIdxSet.has(t));
      if (matched === undefined) return;
      results.push(`${JIJI_LIST[targetBranch]}-${JIJI_LIST[matched]} 반삼합(${element})`);
    }
  }
};

/**
 * 암합 탐지: 두 지지의 지장간 간 천간합 여부.
 * 정기-정기 합 (주요 암합): 인축(갑기합토), 묘신(을경합금), 사유(병신합수), 오해(정임합목)
 * 중기-정기 합 (부차적 암합): 추가 감지
 */
const checkAmhap = (
  targetBranch: number,
  wonkukBranches: readonly Jiji[],
  results: string[],
): void => {
  const tEntry = JIJANGGAN[targetBranch];

  for (const wonkukBranch of wonkukBranches) {
    const wIdx = jijiIndex(wonkukBranch);
    if (wIdx === targetBranch) continue;

    const wEntry = JIJANGGAN[wIdx];
    const found = new Set<string>();

    // 정기-정기 천간합 체크 (주요 암합)
    for (const [a, b, element] of CHEONGAN_HAP) {
      if (
        (tEntry.jeonggi === a && wEntry.jeonggi === b) ||
        (tEntry.jeonggi === b && wEntry.jeonggi === a)
      ) {
        const label = `${JIJI_LIST[targetBranch]}-${JIJI_LIST[wIdx]} 암합(${element}) [${CHEONGAN_LIST[tEntry.jeonggi]}-${CHEONGAN_LIST[wEntry.jeonggi]}]`;
        found.add(label);
      }
    }

    // 중기-정기 천간합 체크 (부차적 암합)
    const pairs: [number | undefined, number | undefined][] = [
      [tEntry.junggi, wEntry.jeonggi],
      [tEntry.jeonggi, wEntry.junggi],
      [tEntry.junggi, wEntry.junggi],
    ];

    for (const [stemA, stemB] of pairs) {
      if (stemA === undefined || stemB === undefined) continue;
      for (const [a, b, element] of CHEONGAN_HAP) {
        if ((stemA === a && stemB === b) || (stemA === b && stemB === a)) {
          const label = `${JIJI_LIST[targetBranch]}-${JIJI_LIST[wIdx]} 암합(${element}) [${CHEONGAN_LIST[stemA]}-${CHEONGAN_LIST[stemB]}]`;
          if (!found.has(label)) found.add(label);
        }
      }
    }

    found.forEach((label) => results.push(label));
  }
};
