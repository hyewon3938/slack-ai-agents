/** 기간 해석 — 서사·렌더 공용 라벨과 고정 문구. */

import type { PeriodType } from './types.js';

/** 도메인 자연어 명사(카드 라벨용). */
export const DOMAIN_LABEL: Record<string, string> = {
  schedule: '일정',
  routine: '루틴',
  sleep: '수면',
  expense: '지출',
  diary_meta: '일기',
};

export const PERIOD_LABEL: Record<PeriodType, string> = {
  wolun: '이번 절기달 운세',
  seun: '올해 운세(입춘 기준)',
  daeun: '대운 흐름',
};

/** 검증가능성 사다리 — 각 층의 지위 라벨(출력에 항상 동반). */
export const LADDER_STATUS: Record<PeriodType, string> = {
  wolun: '월운은 누적 관찰 단계 — 통계로 확정한 게 아니라 경향을 쌓아가는 중이야',
  seun: '세운은 평생 표본이 한두 번뿐 — 통계로 확정은 영구히 못 해, 경향 참고용',
  daeun: '대운은 검증이 안 되는 층 — 교과서 해석과 가중치 참고로만 보자',
};

export const TRANSFER_HEDGE =
  '일운에서 측정된 반응이 더 큰 주기에도 같은 방향으로 이어진다는 건 아직 검증 안 된 가정이야. 운과 원국이 맞물리면 방향이 달라질 수도 있어';
