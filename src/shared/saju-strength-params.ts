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

/**
 * 합화(合化) 변환 규칙 노브 — #477 P4b (ADR-0038).
 *
 * 합화 = 합(천간합/육합/삼합)이 化신 통근 조건을 만족하면 구성 글자 오행을 化 오행으로 변환.
 * 변환된 글자는 강도·밴드·절대상태·효과적 십성에 일관 반영(saju-strength 입력단 공통 변환).
 * 검증 깊이 = v1a(합 성립 + 충개합)까지. 깊은 상호작용은 노브 기본 off(헌장 ④ 미리 선언,
 * 활성은 데이터 게이트/후속 — 켜면 SET 전체 리플레이로 소급 적용, ADR-0034).
 */
export interface HwaParams {
  /** 化신 통근 게이트 — 化 오행이 활성 지지(본기/지장간)에 뿌리내려야 합화 성립. false=합=합화로 느슨 */
  HWA_REQUIRE_ROOT: boolean;
  /** 충개합 — 합 구성 지지가 다른 활성 지지와 충이면 합 무효(동적 운이 정적 합을 깸, v1a 핵심) */
  HWA_CHUNGGAEHAP: boolean;
  /** 일간 천간 변질 허용 — 합이 일간에 닿을 때 변환할지. v1 보수적 불변(학파 의존) */
  HWA_DAYMASTER_TRANSFORM: boolean;
  /** [깊은 노브, 기본 off] 탐합망충 — 합이 충을 푸는 역방향 해소 */
  HWA_TAMHAP_MANGCHUNG: boolean;
  /** [깊은 노브, 기본 off] 쟁합/투합 — 다중 합 경쟁 처리 */
  HWA_JAENGHAP: boolean;
  /** [깊은 노브, 기본 off] 형/파의 합 약화 */
  HWA_HYUNGPA_BREAK: boolean;
  /** [깊은 노브, 기본 off] 글자 거리/위치 가중 */
  HWA_DISTANCE: boolean;
}

export const SAJU_HWA_PARAMS: HwaParams = {
  HWA_REQUIRE_ROOT: true,
  HWA_CHUNGGAEHAP: true,
  HWA_DAYMASTER_TRANSFORM: false,
  HWA_TAMHAP_MANGCHUNG: false,
  HWA_JAENGHAP: false,
  HWA_HYUNGPA_BREAK: false,
  HWA_DISTANCE: false,
} as const;
