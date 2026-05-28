/**
 * lunar evaluator — 음력 초하루 / 보름.
 *
 * 1차 stub: 양력→음력 변환 구현 미완 (saju-calendar.ts에 변환 함수 없음).
 * Phase 3에서는 lunar 시드를 catalog에 INSERT하지 않으므로 이 evaluator는 호출되지 않는 게 정상.
 * 호출되더라도 false 반환 (전체 매칭 흐름은 정상 동작).
 *
 * Follow-up: `korean-lunar-calendar` 패키지 도입 또는 정적 음력 1/15 양력 매핑 테이블 (2026~2027).
 */

import type { DailyContext, LunarAux } from '../saju-match.js';

export const evaluateLunar = async (_aux: LunarAux, _ctx: DailyContext): Promise<boolean> => {
  // 음력 변환 미구현 — Phase 3 시드 풀에서 제외. 호출되면 false.
  return false;
};
