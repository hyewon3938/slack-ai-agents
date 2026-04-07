'use client';

interface Tab<T extends string> {
  id: T;
  label: string;
}

interface TopTabsProps<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
  /** 콘텐츠 영역 max-width와 일치시킬 값. default: 'max-w-5xl' */
  maxWidth?: string;
}

/** 페이지 상단 밑줄 스타일 탭 */
export function TopTabs<T extends string>({ tabs, active, onChange, maxWidth = 'max-w-5xl' }: TopTabsProps<T>) {
  return (
    <div className="border-b border-gray-200 bg-white px-4 pt-2">
      <div className={`mx-auto flex ${maxWidth} gap-1`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`rounded-t-lg px-4 py-2 text-xs font-medium transition ${
              active === tab.id
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'border-b-2 border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface PillTabsProps<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}

/** Pill 형태 서브 탭 */
export function PillTabs<T extends string>({ tabs, active, onChange, className = '' }: PillTabsProps<T>) {
  return (
    <div className={`flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
            active === tab.id
              ? 'bg-blue-600 text-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
