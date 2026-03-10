export interface ScheduleRow {
  id: number;
  title: string;
  date: string | null;
  end_date: string | null;
  status: string;
  category: string | null;
  memo: string | null;
  important: boolean;
  created_at?: string;
}

export interface CategoryRow {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

export type ScheduleStatus = 'todo' | 'in-progress' | 'done' | 'cancelled';

export const SCHEDULE_STATUSES: ScheduleStatus[] = ['todo', 'in-progress', 'done', 'cancelled'];

export const STATUS_LABELS: Record<ScheduleStatus, string> = {
  todo: '할일',
  'in-progress': '진행중',
  done: '완료',
  cancelled: '취소',
};

export interface CategoryColors {
  bg: string;
  border: string;
  text: string;
}

/** 프리셋 Tailwind 색상 (기존 데이터 호환) */
export const PRESET_COLORS: Record<string, { hex: string; colors: CategoryColors }> = {
  violet: { hex: '#8b5cf6', colors: { bg: 'bg-violet-100', border: 'border-violet-300', text: 'text-violet-700' } },
  amber: { hex: '#f59e0b', colors: { bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-700' } },
  rose: { hex: '#f43f5e', colors: { bg: 'bg-rose-100', border: 'border-rose-300', text: 'text-rose-700' } },
  emerald: { hex: '#10b981', colors: { bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-700' } },
  sky: { hex: '#0ea5e9', colors: { bg: 'bg-sky-100', border: 'border-sky-300', text: 'text-sky-700' } },
  blue: { hex: '#3b82f6', colors: { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-700' } },
  orange: { hex: '#f97316', colors: { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-700' } },
  pink: { hex: '#ec4899', colors: { bg: 'bg-pink-100', border: 'border-pink-300', text: 'text-pink-700' } },
  teal: { hex: '#14b8a6', colors: { bg: 'bg-teal-100', border: 'border-teal-300', text: 'text-teal-700' } },
  indigo: { hex: '#6366f1', colors: { bg: 'bg-indigo-100', border: 'border-indigo-300', text: 'text-indigo-700' } },
  gray: { hex: '#6b7280', colors: { bg: 'bg-gray-100', border: 'border-gray-300', text: 'text-gray-700' } },
};

/** CATEGORY_COLORS — 프리셋 이름 또는 hex 값 모두 지원 */
export const CATEGORY_COLORS: Record<string, CategoryColors> = Object.fromEntries(
  Object.entries(PRESET_COLORS).map(([k, v]) => [k, v.colors]),
);

/** hex 색상의 상대 밝기 (0~1) */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** hex 값에서 배경색 기반 스타일 생성 (색상 → 배경, 텍스트 자동 결정) */
export function hexToStyles(hex: string): { bg: string; border: string; text: string } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const textColor = luminance(hex) > 0.6 ? '#1f2937' : '#ffffff';
  return {
    bg: `rgba(${r}, ${g}, ${b}, 0.85)`,
    border: `rgba(${r}, ${g}, ${b}, 1)`,
    text: textColor,
  };
}

/** 색상 키(프리셋명 또는 hex)에서 표시용 색상 가져오기 */
export function getCategoryStyle(colorKey: string): {
  isPreset: boolean;
  classes?: CategoryColors;
  styles?: { bg: string; border: string; text: string };
} {
  if (PRESET_COLORS[colorKey]) {
    return { isPreset: true, classes: PRESET_COLORS[colorKey].colors };
  }
  if (colorKey.startsWith('#')) {
    return { isPreset: false, styles: hexToStyles(colorKey) };
  }
  return { isPreset: true, classes: PRESET_COLORS.gray.colors };
}

/** 색상 키에서 hex 값 가져오기 */
export function colorToHex(colorKey: string): string {
  return PRESET_COLORS[colorKey]?.hex ?? (colorKey.startsWith('#') ? colorKey : '#6b7280');
}

export const COLOR_OPTIONS = Object.keys(PRESET_COLORS);
