/**
 * 결정론 사주 실효강도 모델의 명리학 파라미터 — #477 P4a (ADR-0036).
 *
 * 통계 노브(insight-thresholds.ts)와 의도적으로 분리한다. 이쪽은 "명리학 규칙"의 가중치 —
 * 생조/극설 부호, 위치별 무게, 월령(득령) 배수, 통근 보너스, 분위수 등분 수.
 * 전부 노브(헌장 ⑤): 0으로 두면 해당 규칙이 꺼진다. 잠정 정본 시작값이며,
 * 상대 분위수 밴드(ADR-0036)라 절대 스케일이 아니라 "내 안에서의 상대 강/약"만 결정 → 값에 둔감.
 */

export interface SajuStrengthParams {
  /** 천간(투출) 글자 1개 기여 무게 */
  W_STEM: number;
  /** 지지 본기(정기) 무게 — 뿌리라 천간보다 약간 무겁게 */
  W_BRANCH_MAIN: number;
  /** 지장간 중기 무게 */
  W_JANGGAN_MID: number;
  /** 지장간 여기(잔기) 무게 */
  W_JANGGAN_YEOGI: number;
  /** 생조(비겁·인성) 부호 가중 — 대상을 돕는 글자 */
  saengjo: number;
  /** 극설(식상·재·관) 부호 가중 — 대상을 빼거나 누르는 글자 */
  geukseol: number;
  /** 월령 득령 배수 — 글자가 (간결판) 원국 월지 본기 오행과 같으면 ×배수 */
  W_WOLLYEONG: number;
  /** 통근 게이트 보너스 — 대상 오행이 천간 투출 + 지장간 뿌리를 동시에 가지면 +보너스(이진 게이트) */
  W_TONGGEUN: number;
  /** 분위수 밴드 수 (3 = 약/적정/강 tertile) */
  QUANTILE_DIVISIONS: number;
  /** 절대 신강 판정 하한 — 일간 생조 비율 ≥ 이 값이면 '신강' (검정 비사용, 맥락·미래용) */
  ABS_STRONG_RATIO: number;
  /** 절대 신약 판정 상한 — 일간 생조 비율 ≤ 이 값이면 '신약' */
  ABS_WEAK_RATIO: number;
}

export const SAJU_STRENGTH_PARAMS: SajuStrengthParams = {
  W_STEM: 1.0,
  W_BRANCH_MAIN: 1.2,
  W_JANGGAN_MID: 0.5,
  W_JANGGAN_YEOGI: 0.3,
  saengjo: 1.0,
  geukseol: 1.0,
  W_WOLLYEONG: 1.5,
  W_TONGGEUN: 0.5,
  QUANTILE_DIVISIONS: 3,
  ABS_STRONG_RATIO: 0.55,
  ABS_WEAK_RATIO: 0.45,
} as const;
