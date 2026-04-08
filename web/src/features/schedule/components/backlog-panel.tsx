'use client';

import { useState, useCallback } from 'react';
import { getCategoryStyle } from '@/lib/types';
import { getTodayISO } from '@/lib/kst';
import { useBacklog } from '@/features/schedule/hooks/use-backlog';
import { Modal } from '@/components/ui/modal';
import { ScheduleForm } from '@/features/schedule/components/schedule-form';
import { StatusBadge } from '@/features/schedule/components/status-badge';

export function BacklogPanel() {
  const {
    schedules,
    categories,
    editingSchedule,
    setEditingSchedule,
    showCreateModal,
    setShowCreateModal,
    loading,
    grouped,
    sortedCategories,
    handleAssignDate,
    handleUpdate,
    handleDelete,
    handleCreate,
  } = useBacklog();

  const [formDirty, setFormDirty] = useState(false);
  const handleBeforeClose = useCallback(
    () => !formDirty || confirm('수정 중인 내용이 있어. 닫을까?'),
    [formDirty],
  );

  const handleAddToToday = (id: number) => {
    handleAssignDate(id, getTodayISO());
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4">
        <div className="mb-4 h-8 w-32 animate-pulse rounded bg-gray-200" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="mb-4 space-y-2">
            <div className="h-6 w-24 animate-pulse rounded-full bg-gray-200" />
            <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
            <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">
            백로그 <span className="text-sm font-normal text-gray-400">({schedules.length}건)</span>
          </h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
          >
            + 추가
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl overflow-hidden p-4">
        {schedules.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400">백로그 없음</p>
            <p className="mt-1 text-sm text-gray-300">날짜 없이 추가된 일정이 여기에 표시돼</p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedCategories.map((cat) => {
              const items = grouped.get(cat) ?? [];
              const catRow = categories.find((c) => c.name === cat);
              const colorKey = catRow?.color ?? 'gray';
              const style = getCategoryStyle(colorKey);

              return (
                <div key={cat}>
                  <h3
                    className="mb-2 inline-block rounded-full px-3 py-1 text-xs font-semibold"
                    style={{ backgroundColor: style.bg, color: style.text }}
                  >
                    {cat} ({items.length})
                  </h3>

                  <div className="space-y-2">
                    {items.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 max-md:flex-wrap"
                      >
                        <div
                          className="min-w-0 flex-1 cursor-pointer"
                          onClick={() => setEditingSchedule(s)}
                        >
                          <div className="flex items-center gap-2">
                            {s.important && <span className="shrink-0 text-amber-500">★</span>}
                            <span className="text-sm font-medium text-gray-800">{s.title}</span>
                            <StatusBadge status={s.status} />
                          </div>
                          {s.memo && (
                            <p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{s.memo}</p>
                          )}
                        </div>

                        <button
                          onClick={() => handleAddToToday(s.id)}
                          className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-100"
                        >
                          오늘 추가
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 생성 모달 */}
      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} onBeforeClose={handleBeforeClose} title="백로그 추가">
        <ScheduleForm
          categories={categories}
          defaultDate={null}
          onSubmit={handleCreate}
          onClose={() => setShowCreateModal(false)}
          onDirtyChange={setFormDirty}
        />
      </Modal>

      {/* 수정 모달 */}
      <Modal
        open={!!editingSchedule}
        onClose={() => setEditingSchedule(null)}
        onBeforeClose={handleBeforeClose}
        title="일정 수정"
      >
        {editingSchedule && (
          <ScheduleForm
            schedule={editingSchedule}
            categories={categories}
            onSubmit={handleUpdate}
            onDelete={handleDelete}
            onClose={() => setEditingSchedule(null)}
            onDirtyChange={setFormDirty}
          />
        )}
      </Modal>

      {/* 모바일 FAB */}
      <button
        onClick={() => setShowCreateModal(true)}
        className="fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500 text-2xl text-white shadow-lg transition hover:bg-blue-600 md:hidden"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
      >
        +
      </button>
    </>
  );
}
