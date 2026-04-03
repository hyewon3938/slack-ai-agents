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

/** 체크리스트/통계/관리 뷰 전환 토글 */
export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="flex rounded-lg bg-gray-100">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            view === tab.key
              ? 'bg-blue-500 text-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
