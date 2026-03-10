'use client';

export type CalendarView = 'month' | 'week' | 'day';

interface CalendarHeaderProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  title: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onAdd: () => void;
}

export function CalendarHeader({
  view,
  onViewChange,
  title,
  onPrev,
  onNext,
  onToday,
  onAdd,
}: CalendarHeaderProps) {
  const views: { key: CalendarView; label: string }[] = [
    { key: 'month', label: '월' },
    { key: 'week', label: '주' },
    { key: 'day', label: '일' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
      {/* 날짜 네비게이션 */}
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={onToday}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
        >
          오늘
        </button>
        <button
          onClick={onNext}
          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <h2 className="flex-1 text-center text-lg font-bold text-gray-800 md:text-left">{title}</h2>

      {/* 뷰 전환 */}
      <div className="flex rounded-lg bg-gray-100 p-0.5">
        {views.map((v) => (
          <button
            key={v.key}
            onClick={() => onViewChange(v.key)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              view === v.key
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* 추가 버튼 (데스크탑) */}
      <button
        onClick={onAdd}
        className="hidden rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 md:block"
      >
        + 일정 추가
      </button>

      {/* FAB (모바일) */}
      <button
        onClick={onAdd}
        className="fixed right-4 bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500 text-2xl text-white shadow-lg transition hover:bg-blue-600 md:hidden"
      >
        +
      </button>
    </div>
  );
}
