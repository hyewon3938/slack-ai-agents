'use client';

import type { MoveToastState } from '@/features/schedule/hooks/use-schedules';

interface MoveToastProps {
  toast: MoveToastState | null;
  onUndo: () => void;
  onDismiss: () => void;
}

/** 일정을 옮기거나 되돌린 직후 화면 아래에 잠깐 뜨는 알림 */
export function MoveToast({ toast, onUndo, onDismiss }: MoveToastProps) {
  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-20 z-[70] flex justify-center px-4 md:bottom-6"
    >
      <div className="flex max-w-md min-w-0 items-center gap-3 rounded-xl bg-gray-900/95 py-2.5 pr-2 pl-4 text-sm text-white shadow-lg">
        <span className="min-w-0 truncate">
          {toast.title}
          <span className="text-gray-300"> → {toast.label}</span>
        </span>
        {toast.kind === 'moved' ? (
          <button
            type="button"
            onClick={onUndo}
            className="shrink-0 rounded-lg px-2.5 py-1 font-medium text-blue-300 transition hover:bg-white/10"
          >
            되돌리기
            <span className="ml-1.5 hidden text-xs text-gray-400 md:inline">Ctrl+Z</span>
          </button>
        ) : (
          <span className="shrink-0 px-2.5 py-1 text-gray-300">되돌렸어</span>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="알림 닫기"
          className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-white/10 hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
