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

export const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  violet: { bg: 'bg-violet-100', border: 'border-violet-300', text: 'text-violet-700' },
  amber: { bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-700' },
  rose: { bg: 'bg-rose-100', border: 'border-rose-300', text: 'text-rose-700' },
  emerald: { bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-700' },
  sky: { bg: 'bg-sky-100', border: 'border-sky-300', text: 'text-sky-700' },
  blue: { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-700' },
  orange: { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-700' },
  pink: { bg: 'bg-pink-100', border: 'border-pink-300', text: 'text-pink-700' },
  teal: { bg: 'bg-teal-100', border: 'border-teal-300', text: 'text-teal-700' },
  indigo: { bg: 'bg-indigo-100', border: 'border-indigo-300', text: 'text-indigo-700' },
  gray: { bg: 'bg-gray-100', border: 'border-gray-300', text: 'text-gray-700' },
};

export const COLOR_OPTIONS = Object.keys(CATEGORY_COLORS);
