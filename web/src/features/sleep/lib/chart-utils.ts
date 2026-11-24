/** 요일 한글 약자 (일~토) */
import { DAY_NAMES } from '@/lib/kst';

/**
 * 차트용 날짜 라벨 생성
 * - 기본: 일(day)만 표시  (예: "02")
 * - 1일이면 월-일 표시    (예: "04-01")
 */
export function formatDateLabel(dateStr: string): string {
  const day = dateStr.slice(8, 10);
  if (day === '01') {
    return `${dateStr.slice(5, 7)}-${day}`;
  }
  return day;
}

/** 날짜 문자열 → 요일 한글 1글자 */
export function getDayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_NAMES[d.getDay()];
}

/** 분 → "N시간 M분" (0분이면 "N시간") */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}
