/**
 * Vercel cron 드리프트를 흡수하는 스냅샷 대상 날짜 계산 (순수 함수).
 *
 * - 입력 시각에서 driftBufferMs(기본 1시간)를 차감
 * - 차감 후 시각을 KST(UTC+9)로 환산해 YYYY-MM-DD 반환
 * - 최대 ~1시간 드리프트까지 당일 날짜 보장
 */
export function resolveSnapshotDate(
  nowUtc: Date,
  driftBufferMs = 3_600_000,
): string {
  const anchor = new Date(nowUtc.getTime() - driftBufferMs);
  const kst = new Date(anchor.getTime() + 9 * 3_600_000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
