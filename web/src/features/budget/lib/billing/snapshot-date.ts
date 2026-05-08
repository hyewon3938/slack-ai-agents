/**
 * 전일 스냅샷 대상 날짜 계산 (순수 함수).
 *
 * - 발화 시각의 KST 날짜에서 1일을 차감해 YYYY-MM-DD 반환
 * - 새벽 발화(KST 05:00)에서 어제 데이터를 저장하기 위한 용도
 * - 발화 시각이 KST 자정~새벽 시간대여도 전일을 안전하게 가리킴
 */
export function resolvePreviousDayDate(nowUtc: Date): string {
  const kstMs = nowUtc.getTime() + 9 * 3_600_000;
  const previousDayMs = kstMs - 24 * 3_600_000;
  const kst = new Date(previousDayMs);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
