'use client';

import { useState, useRef, useEffect } from 'react';

interface ActionMenuProps {
  scheduleId: number;
  important?: boolean;
  onToggleImportant?: (id: number) => void;
  onPostpone: (id: number) => void;
  onMoveToBacklog: (id: number) => void;
  onDelete: (id: number) => void;
}

export function ActionMenu({
  scheduleId,
  important,
  onToggleImportant,
  onPostpone,
  onMoveToBacklog,
  onDelete,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {onToggleImportant && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onToggleImportant(scheduleId);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              {important ? '중요 해제' : '중요 설정'}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onPostpone(scheduleId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            내일로 미루기
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onMoveToBacklog(scheduleId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            백로그로 이동
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete(scheduleId);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50"
          >
            삭제
          </button>
        </div>
      )}
    </div>
  );
}
