/** 오늘이 월요일이라는 전제 — 전주 월요일(=7일 전) ISO 반환 (카드 라벨용). */
export const previousMondayISO = (todayIso: string): string => {
  const d = new Date(`${todayIso}T12:00:00+09:00`);
  const dow = d.getUTCDay(); // 0=일, 1=월
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (daysSinceMonday + 7));
  return monday.toISOString().slice(0, 10);
};
