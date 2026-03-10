/**
 * KST (UTC+9) 날짜 유틸리티.
 * src/shared/kst.ts에서 필요한 함수만 복제.
 */

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

const getKSTDate = (): Date => {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
};

export const getTodayISO = (): string => {
  const d = getKSTDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseKSTDateStr = (
  dateStr: string,
): { year: number; month: number; day: number; dow: number } => {
  const parts = dateStr.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  return { year, month, day, dow: d.getUTCDay() };
};

export const formatDateShort = (dateStr: string): string => {
  const { month, day, dow } = parseKSTDateStr(dateStr);
  return `${month}/${day}(${DAY_NAMES[dow]})`;
};

export const getDayName = (dateStr: string): string => {
  const { dow } = parseKSTDateStr(dateStr);
  return DAY_NAMES[dow] ?? '';
};

export const addDays = (dateStr: string, days: number): string => {
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};
