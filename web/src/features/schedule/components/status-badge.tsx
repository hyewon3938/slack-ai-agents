import type { ScheduleStatus } from '@/features/schedule/lib/types';

const STATUS_STYLES: Record<ScheduleStatus, string> = {
  todo: 'bg-slate-100 text-slate-700',
  'in-progress': 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-400',
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status as ScheduleStatus] ?? STATUS_STYLES.todo;
  const label =
    status === 'todo' ? '할일' :
    status === 'in-progress' ? '진행중' :
    status === 'done' ? '완료' :
    status === 'cancelled' ? '취소' : status;

  return (
    <span className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
