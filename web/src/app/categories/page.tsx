'use client';

import { useState, useEffect, useCallback } from 'react';
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

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-[60vh] items-center justify-center">
          <div className="text-gray-400">로딩중...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-lg font-bold text-gray-800">카테고리 관리</h1>
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

        {/* 카테고리 목록 */}
        <div className="space-y-2">
          {categories.map((cat) => {
            const isEditing = editingId === cat.id;

            return (
              <div
                key={cat.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
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
                  </>
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

function CategoryBadge({ name, colorKey }: { name: string; colorKey: string }) {
  const style = getCategoryStyle(colorKey);
  if (style.isPreset && style.classes) {
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style.classes.bg} ${style.classes.text}`}>
        {name}
      </span>
    );
  }
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-semibold"
      style={{ backgroundColor: style.styles?.bg, color: style.styles?.text }}
    >
      {name}
    </span>
  );
}
