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
import type { CategoryRow, CategoryType } from '@/lib/types';
import { getCategoryStyle, CATEGORY_TYPES } from '@/lib/types';
import { AppShell } from '@/components/ui/app-shell';
import { ColorPicker } from '@/components/ui/color-picker';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('violet');
  const [newType, setNewType] = useState<CategoryType>('task');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editType, setEditType] = useState<CategoryType>('task');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [newSubColor, setNewSubColor] = useState('gray');

  const parentCategories = categories.filter((c) => c.parent_id === null);
  const getChildren = (parentId: number) =>
    categories.filter((c) => c.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order);

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
        const parents = prev.filter((c) => c.parent_id === null);
        const children = prev.filter((c) => c.parent_id !== null);
        const oldIndex = parents.findIndex((c) => c.id === Number(active.id));
        const newIndex = parents.findIndex((c) => c.id === Number(over.id));
        const updatedParents = arrayMove(parents, oldIndex, newIndex);
        saveOrder(updatedParents);
        return [...updatedParents, ...children];
      });
    },
    [saveOrder],
  );

  const handleMoveUp = useCallback(
    (id: number, parentId: number | null = null) => {
      setCategories((prev) => {
        const siblings = prev.filter((c) => c.parent_id === parentId);
        const others = prev.filter((c) => c.parent_id !== parentId);
        const idx = siblings.findIndex((c) => c.id === id);
        if (idx <= 0) return prev;
        const updated = arrayMove(siblings, idx, idx - 1);
        saveOrder(updated);
        return [...others, ...updated].sort((a, b) => {
          if (a.parent_id === null && b.parent_id !== null) return -1;
          if (a.parent_id !== null && b.parent_id === null) return 1;
          return 0;
        });
      });
    },
    [saveOrder],
  );

  const handleMoveDown = useCallback(
    (id: number, parentId: number | null = null) => {
      setCategories((prev) => {
        const siblings = prev.filter((c) => c.parent_id === parentId);
        const others = prev.filter((c) => c.parent_id !== parentId);
        const idx = siblings.findIndex((c) => c.id === id);
        if (idx < 0 || idx >= siblings.length - 1) return prev;
        const updated = arrayMove(siblings, idx, idx + 1);
        saveOrder(updated);
        return [...others, ...updated].sort((a, b) => {
          if (a.parent_id === null && b.parent_id !== null) return -1;
          if (a.parent_id !== null && b.parent_id === null) return 1;
          return 0;
        });
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
        body: JSON.stringify({ name: newName.trim(), color: newColor, type: newType }),
      });
      if (res.ok) {
        setNewName('');
        setNewColor('violet');
        setNewType('task');
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
        body: JSON.stringify({ name: editName.trim(), color: editColor, type: editType }),
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

  const handleCreateSub = async (parentId: number) => {
    if (!newSubName.trim()) return;
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSubName.trim(), color: newSubColor, parent_id: parentId }),
      });
      if (res.ok) {
        setNewSubName('');
        setNewSubColor('gray');
        await fetchCategories();
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? '하위 카테고리 추가 실패');
      }
    } catch {
      alert('하위 카테고리 추가에 실패했어');
    }
  };

  const startEdit = (cat: CategoryRow) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color);
    setEditType(cat.type);
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
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="카테고리 이름"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <TypeSelector value={newType} onChange={setNewType} />
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
              items={parentCategories.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {parentCategories.map((cat) => {
                  const children = getChildren(cat.id);
                  const isExpanded = expandedId === cat.id;
                  return (
                    <div key={cat.id}>
                      <SortableCategoryItem
                        cat={cat}
                        isEditing={editingId === cat.id}
                        editName={editName}
                        editColor={editColor}
                        editType={editType}
                        onEditNameChange={setEditName}
                        onEditColorChange={setEditColor}
                        onEditTypeChange={setEditType}
                        onStartEdit={startEdit}
                        onSaveEdit={handleUpdate}
                        onCancelEdit={() => setEditingId(null)}
                        onDelete={handleDelete}
                        childCount={children.length}
                        isExpanded={isExpanded}
                        onToggleExpand={() => setExpandedId(isExpanded ? null : cat.id)}
                      />
                      {isExpanded && (
                        <SubcategoryPanel
                          parentId={cat.id}
                          children={children}
                          editingId={editingId}
                          editName={editName}
                          editColor={editColor}
                          onEditNameChange={setEditName}
                          onEditColorChange={setEditColor}
                          onStartEdit={startEdit}
                          onSaveEdit={handleUpdate}
                          onCancelEdit={() => setEditingId(null)}
                          onDelete={handleDelete}
                          onMoveUp={(id) => handleMoveUp(id, cat.id)}
                          onMoveDown={(id) => handleMoveDown(id, cat.id)}
                          newSubName={newSubName}
                          newSubColor={newSubColor}
                          onNewSubNameChange={setNewSubName}
                          onNewSubColorChange={setNewSubColor}
                          onCreateSub={handleCreateSub}
                        />
                      )}
                    </div>
                  );
                })}
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
          {parentCategories.map((cat, idx) => {
            const isEditing = editingId === cat.id;
            const children = getChildren(cat.id);
            const isExpanded = expandedId === cat.id;

            return (
              <div key={cat.id}>
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
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
                      disabled={idx === parentCategories.length - 1}
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
                      <TypeSelector value={editType} onChange={setEditType} />
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
                      <TypeBadge type={cat.type} />
                      {children.length > 0 && (
                        <span className="text-xs text-gray-400">{children.length}</span>
                      )}
                      <div className="flex-1" />
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : cat.id)}
                        className="rounded-lg px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-100"
                      >
                        {isExpanded ? '접기' : '펼치기'}
                      </button>
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
                {isExpanded && (
                  <SubcategoryPanel
                    parentId={cat.id}
                    children={children}
                    editingId={editingId}
                    editName={editName}
                    editColor={editColor}
                    onEditNameChange={setEditName}
                    onEditColorChange={setEditColor}
                    onStartEdit={startEdit}
                    onSaveEdit={handleUpdate}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={handleDelete}
                    onMoveUp={(id) => handleMoveUp(id, cat.id)}
                    onMoveDown={(id) => handleMoveDown(id, cat.id)}
                    newSubName={newSubName}
                    newSubColor={newSubColor}
                    onNewSubNameChange={setNewSubName}
                    onNewSubColorChange={setNewSubColor}
                    onCreateSub={handleCreateSub}
                  />
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

function SortableCategoryItem({
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

// ─── 하위 카테고리 패널 ─────────────────────────────────────

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

function SubcategoryPanel({
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

function TypeBadge({ type }: { type: CategoryType }) {
  const label = CATEGORY_TYPES.find((t) => t.value === type)?.label ?? type;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        type === 'event'
          ? 'bg-purple-100 text-purple-600'
          : 'bg-gray-100 text-gray-500'
      }`}
    >
      {label}
    </span>
  );
}

function TypeSelector({
  value,
  onChange,
}: {
  value: CategoryType;
  onChange: (v: CategoryType) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-gray-300 p-0.5">
      {CATEGORY_TYPES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === t.value
              ? 'bg-blue-500 text-white'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
