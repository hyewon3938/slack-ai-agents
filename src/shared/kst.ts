/**
 * KST (UTC+9) 날짜/시간 유틸리티.
 * 서버 타임존(UTC/KST 등)에 무관하게 정확한 KST 날짜를 반환.
 *
 * - getKSTDate(): 로컬 메서드(.getDate() 등)가 KST 값을 반환하도록 조정된 Date
 * - parseKSTDateStr(): DB의 YYYY-MM-DD 문자열을 KST 기준으로 파싱 (정오 KST + UTC 메서드)
 */

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

// ─── 현재 시각 기반 ─────────────────────────────────────

/**
 * KST 기준 현재 Date.
 * 내부 타임스탬프를 조정해 로컬 메서드가 KST 값을 반환하도록 함.
 * 수식: UTC + (localOffset + 540min) → 로컬 메서드 적용 시 UTC+9.
 */
const getKSTDate = (): Date => {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
};

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
export const getTodayISO = (): string => {
  const d = getKSTDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** KST 기준 어제 날짜 (YYYY-MM-DD) */
export const getYesterdayISO = (): string => {
  const d = getKSTDate();
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** 오늘 날짜 문자열 — YYYY-MM-DD (요일) */
export const getTodayString = (): string => {
  const d = getKSTDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const day = DAY_NAMES[d.getDay()];
  return `${yyyy}-${mm}-${dd} (${day})`;
};

/** KST 현재 시각 HH:MM */
export const getKSTTimeString = (): string => {
  const d = getKSTDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

/** KST 기준 요일 번호 (0=일 ~ 6=토) */
export const getKSTDayOfWeek = (): number => getKSTDate().getDay();

// ─── 날짜 문자열 기반 (DB 값 파싱) ─────────────────────

/**
 * YYYY-MM-DD 문자열 → KST 기준 날짜 컴포넌트.
 * 정오 KST(= 03:00 UTC)로 파싱해 UTC 메서드 사용 시 날짜 경계 문제 방지.
 */
const parseKSTDateStr = (dateStr: string): {
  year: number; month: number; day: number; dow: number;
} => {
  const parts = dateStr.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  return { year, month, day, dow: d.getUTCDay() };
};

/** "YYYY-MM-DD" → "M/D(요)" */
export const formatDateShort = (dateStr: string): string => {
  const { month, day, dow } = parseKSTDateStr(dateStr);
  return `${month}/${day}(${DAY_NAMES[dow]})`;
};

/** 날짜 문자열에 N일 더하기 (YYYY-MM-DD → YYYY-MM-DD) */
export const addDays = (dateStr: string, days: number): string => {
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};
