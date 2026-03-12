'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CategoryRow } from '@/lib/types';
import { getCategoryStyle } from '@/lib/types';
import { AppShell } from '@/components/ui/app-shell';
import { ColorPicker } from '@/components/ui/color-picker';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('violet');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [activeId, setActiveId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        const data = (await res.json()) as { data: CategoryRow[] };
        setCategories(data.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const saveOrder = useCallback(async (items: CategoryRow[]) => {
    const orders = items.map((c, i) => ({ id: c.id, sort_order: i + 1 }));
    try {
      await fetch('/api/categories/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
    } catch {
      // ignore — 로컬 순서는 이미 반영됨
    }
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(Number(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setCategories((prev) => {
        const oldIndex = prev.findIndex((c) => c.id === Number(active.id));
        const newIndex = prev.findIndex((c) => c.id === Number(over.id));
        const updated = arrayMove(prev, oldIndex, newIndex);
        saveOrder(updated);
        return updated;
      });
    },
    [saveOrder],
  );

  const handleMoveUp = useCallback(
    (id: number) => {
      setCategories((prev) => {
        const idx = prev.findIndex((c) => c.id === id);
        if (idx <= 0) return prev;
        const updated = arrayMove(prev, idx, idx - 1);
        saveOrder(updated);
        return updated;
      });
    },
    [saveOrder],
  );

  const handleMoveDown = useCallback(
    (id: number) => {
      setCategories((prev) => {
        const idx = prev.findIndex((c) => c.id === id);
        if (idx < 0 || idx >= prev.length - 1) return prev;
        const updated = arrayMove(prev, idx, idx + 1);
        saveOrder(updated);
        return updated;
      });
    },
    [saveOrder],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (res.ok) {
        setNewName('');
        setNewColor('violet');
        await fetchCategories();
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? '카테고리 추가 실패');
      }
    } catch {
      alert('카테고리 추가에 실패했어');
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return;

    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      if (res.ok) {
        setEditingId(null);
        await fetchCategories();
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? '카테고리 수정 실패');
      }
    } catch {
      alert('카테고리 수정에 실패했어');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(`'${categories.find((c) => c.id === id)?.name}' 카테고리를 삭제할까?`)) return;

    try {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchCategories();
      }
    } catch {
      alert('카테고리 삭제에 실패했어');
    }
  };

  const startEdit = (cat: CategoryRow) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color);
  };

  const activeCat = activeId ? categories.find((c) => c.id === activeId) : null;

  if (loading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl p-4">
          <div className="mb-6 h-20 animate-pulse rounded-lg bg-gray-100" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="mb-2 h-14 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-lg font-bold text-gray-800">카테고리 관리</h1>
          <p className="mt-0.5 text-xs text-gray-400">순서를 변경하면 일정에도 반영돼</p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl p-4">
        {/* 새 카테고리 추가 */}
        <form onSubmit={handleCreate} className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">카테고리 추가</h2>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="카테고리 이름"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <ColorPicker value={newColor} onChange={setNewColor} previewLabel={newName.trim() || '카테고리'} />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
            >
              추가
            </button>
          </div>
        </form>

        {/* 카테고리 목록 — 데스크탑 DnD */}
        <div className="hidden md:block">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={categories.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {categories.map((cat) => (
                  <SortableCategoryItem
                    key={cat.id}
                    cat={cat}
                    isEditing={editingId === cat.id}
                    editName={editName}
                    editColor={editColor}
                    onEditNameChange={setEditName}
                    onEditColorChange={setEditColor}
                    onStartEdit={startEdit}
                    onSaveEdit={handleUpdate}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeCat && (
                <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 shadow-lg">
                  <CategoryBadge name={activeCat.name} colorKey={activeCat.color} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>

        {/* 카테고리 목록 — 모바일 (화살표 버튼) */}
        <div className="space-y-2 md:hidden">
          {categories.map((cat, idx) => {
            const isEditing = editingId === cat.id;

            return (
              <div
                key={cat.id}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3"
              >
                {/* 순서 변경 버튼 */}
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    onClick={() => handleMoveUp(cat.id)}
                    disabled={idx === 0}
                    className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 disabled:opacity-20"
                    aria-label="위로 이동"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleMoveDown(cat.id)}
                    disabled={idx === categories.length - 1}
                    className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 disabled:opacity-20"
                    aria-label="아래로 이동"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {isEditing ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      autoFocus
                    />
                    <ColorPicker value={editColor} onChange={setEditColor} previewLabel={editName.trim() || '카테고리'} />
                    <button
                      onClick={() => handleUpdate(cat.id)}
                      className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600"
                    >
                      저장
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <>
                    <CategoryBadge name={cat.name} colorKey={cat.color} />
                    <div className="flex-1" />
                    <button
                      onClick={() => startEdit(cat)}
                      className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      className="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

// ─── 데스크탑 정렬 가능 아이템 ─────────────────────────────

interface SortableCategoryItemProps {
  cat: CategoryRow;
  isEditing: boolean;
  editName: string;
  editColor: string;
  onEditNameChange: (v: string) => void;
  onEditColorChange: (v: string) => void;
  onStartEdit: (cat: CategoryRow) => void;
  onSaveEdit: (id: number) => void;
  onCancelEdit: () => void;
  onDelete: (id: number) => void;
}

function SortableCategoryItem({
  cat,
  isEditing,
  editName,
  editColor,
  onEditNameChange,
  onEditColorChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
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
          <div className="flex-1" />
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

// ─── 공통 컴포넌트 ─────────────────────────────────────────

function CategoryBadge({ name, colorKey }: { name: string; colorKey: string }) {
  const style = getCategoryStyle(colorKey);
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-semibold"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {name}
    </span>
  );
}
