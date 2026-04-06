'use client';

import type { RoutineView } from '../hooks/use-routines';

interface ViewToggleProps {
  view: RoutineView;
  onChange: (view: RoutineView) => void;
}

const TABS: { key: RoutineView; label: string }[] = [
  { key: 'checklist', label: '체크리스트' },
  { key: 'stats', label: '통계' },
  { key: 'manage', label: '관리' },
];

/** 체크리스트/통계/관리 뷰 전환 — 일정 탭과 동일한 밑줄 스타일 */
export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="flex gap-1">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`rounded-t-lg px-4 py-2 text-xs font-medium transition ${
            view === tab.key
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
