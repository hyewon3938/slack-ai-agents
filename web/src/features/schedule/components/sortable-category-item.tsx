'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CategoryRow, CategoryType } from '@/lib/types';
import { ColorPicker } from '@/components/ui/color-picker';
import { CategoryBadge, TypeBadge, TypeSelector } from './category-panel-parts';

interface SortableCategoryItemProps {
  cat: CategoryRow;
  isEditing: boolean;
  editName: string;
  editColor: string;
  editType: CategoryType;
  onEditNameChange: (v: string) => void;
  onEditColorChange: (v: string) => void;
  onEditTypeChange: (v: CategoryType) => void;
  onStartEdit: (cat: CategoryRow) => void;
  onSaveEdit: (id: number) => void;
  onCancelEdit: () => void;
  onDelete: (id: number) => void;
  childCount?: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function SortableCategoryItem({
  cat,
  isEditing,
  editName,
  editColor,
  editType,
  onEditNameChange,
  onEditColorChange,
  onEditTypeChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  childCount = 0,
  isExpanded = false,
  onToggleExpand,
}: SortableCategoryItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cat.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
    >
      {/* 드래그 핸들 */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab rounded p-1 text-gray-400 transition hover:bg-gray-100 active:cursor-grabbing"
        aria-label="드래그하여 순서 변경"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>

      {isEditing ? (
        <>
          <input
            type="text"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            autoFocus
          />
          <TypeSelector value={editType} onChange={onEditTypeChange} />
          <ColorPicker value={editColor} onChange={onEditColorChange} previewLabel={editName.trim() || '카테고리'} />
          <button
            onClick={() => onSaveEdit(cat.id)}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600"
          >
            저장
          </button>
          <button
            onClick={onCancelEdit}
            className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100"
          >
            취소
          </button>
        </>
      ) : (
        <>
          <CategoryBadge name={cat.name} colorKey={cat.color} />
          <TypeBadge type={cat.type} />
          {childCount > 0 && (
            <span className="text-xs text-gray-400">{childCount}</span>
          )}
          <div className="flex-1" />
          <button
            onClick={onToggleExpand}
            className="rounded-lg px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-100"
          >
            {isExpanded ? '접기' : '펼치기'}
          </button>
          <button
            onClick={() => onStartEdit(cat)}
            className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
          >
            수정
          </button>
          <button
            onClick={() => onDelete(cat.id)}
            className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-50"
          >
            삭제
          </button>
        </>
      )}
    </div>
  );
}
