'use client';

import type { CategoryRow } from '@/lib/types';
import { ColorPicker } from '@/components/ui/color-picker';
import { CategoryBadge } from './category-panel-parts';

interface SubcategoryPanelProps {
  parentId: number;
  children: CategoryRow[];
  editingId: number | null;
  editName: string;
  editColor: string;
  onEditNameChange: (v: string) => void;
  onEditColorChange: (v: string) => void;
  onStartEdit: (cat: CategoryRow) => void;
  onSaveEdit: (id: number) => void;
  onCancelEdit: () => void;
  onDelete: (id: number) => void;
  onMoveUp: (id: number) => void;
  onMoveDown: (id: number) => void;
  newSubName: string;
  newSubColor: string;
  onNewSubNameChange: (v: string) => void;
  onNewSubColorChange: (v: string) => void;
  onCreateSub: (parentId: number) => void;
}

export function SubcategoryPanel({
  parentId,
  children,
  editingId,
  editName,
  editColor,
  onEditNameChange,
  onEditColorChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  newSubName,
  newSubColor,
  onNewSubNameChange,
  onNewSubColorChange,
  onCreateSub,
}: SubcategoryPanelProps) {
  return (
    <div className="mt-1 space-y-1 rounded-lg border border-gray-200 bg-white p-3">
      {/* 하위 카테고리 추가 폼 */}
      <div className="mb-2 flex items-center gap-2">
        <input
          type="text"
          value={newSubName}
          onChange={(e) => onNewSubNameChange(e.target.value)}
          placeholder="하위 카테고리 이름"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
        />
        <ColorPicker value={newSubColor} onChange={onNewSubColorChange} previewLabel={newSubName.trim() || '하위'} />
        <button
          onClick={() => onCreateSub(parentId)}
          disabled={!newSubName.trim()}
          className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
        >
          추가
        </button>
      </div>

      {/* 하위 카테고리 목록 */}
      {children.map((sub, idx) => {
        const isEditing = editingId === sub.id;
        return (
          <div key={sub.id} className="flex items-center gap-2 rounded-lg bg-white p-2">
            <div className="flex shrink-0 flex-col gap-0.5">
              <button
                onClick={() => onMoveUp(sub.id)}
                disabled={idx === 0}
                className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 disabled:opacity-20"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                onClick={() => onMoveDown(sub.id)}
                disabled={idx === children.length - 1}
                className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 disabled:opacity-20"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {isEditing ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => onEditNameChange(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
                <ColorPicker value={editColor} onChange={onEditColorChange} previewLabel={editName.trim() || '하위'} />
                <button
                  onClick={() => onSaveEdit(sub.id)}
                  className="rounded-lg bg-blue-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-600"
                >
                  저장
                </button>
                <button
                  onClick={onCancelEdit}
                  className="rounded-lg px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-100"
                >
                  취소
                </button>
              </div>
            ) : (
              <>
                <CategoryBadge name={sub.name} colorKey={sub.color} />
                <div className="flex-1" />
                <button
                  onClick={() => onStartEdit(sub)}
                  className="rounded-lg px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100"
                >
                  수정
                </button>
                <button
                  onClick={() => onDelete(sub.id)}
                  className="rounded-lg px-2.5 py-1 text-xs text-red-400 hover:bg-red-50"
                >
                  삭제
                </button>
              </>
            )}
          </div>
        );
      })}

      {children.length === 0 && (
        <p className="py-1 text-center text-xs text-gray-400">하위 카테고리가 없어</p>
      )}
    </div>
  );
}
