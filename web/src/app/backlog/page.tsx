'use client';

import { useState, useCallback } from 'react';
import { getCategoryStyle } from '@/lib/types';
import { useBacklog } from '@/features/schedule/hooks/use-backlog';
import { AppShell } from '@/components/ui/app-shell';
import { Modal } from '@/components/ui/modal';
import { ScheduleForm } from '@/features/schedule/components/schedule-form';
import { StatusBadge } from '@/features/schedule/components/status-badge';

export default function BacklogPage() {
  const {
    schedules,
    categories,
    editingSchedule,
    setEditingSchedule,
    showCreateModal,
    setShowCreateModal,
    assigningDate,
    setAssigningDate,
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
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <h1 className="text-lg font-bold text-gray-800">
            백로그 <span className="text-sm font-normal text-gray-400">({schedules.length}건)</span>
          </h1>
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
                  {style.isPreset && style.classes ? (
                    <h2 className={`mb-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${style.classes.bg} ${style.classes.text}`}>
                      {cat} ({items.length})
                    </h2>
                  ) : (
                    <h2
                      className="mb-2 inline-block rounded-full px-3 py-1 text-xs font-semibold"
                      style={{ backgroundColor: style.styles?.bg, color: style.styles?.text }}
                    >
                      {cat} ({items.length})
                    </h2>
                  )}

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
                            <span className="min-w-0 truncate text-sm font-medium text-gray-800">{s.title}</span>
                            <StatusBadge status={s.status} />
                          </div>
                          {s.memo && (
                            <p className="mt-1 truncate text-xs text-gray-500">{s.memo}</p>
                          )}
                        </div>

                        {/* 날짜 지정 */}
                        {assigningDate?.id === s.id ? (
                          <div className="flex items-center gap-1 max-md:w-full">
                            <input
                              type="date"
                              value={assigningDate.date}
                              onChange={(e) =>
                                setAssigningDate({ id: s.id, date: e.target.value })
                              }
                              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                              autoFocus
                            />
                            <button
                              onClick={() => handleAssignDate(s.id, assigningDate.date)}
                              disabled={!assigningDate.date}
                              className="rounded bg-blue-500 px-2 py-1 text-xs text-white disabled:opacity-50"
                            >
                              확인
                            </button>
                            <button
                              onClick={() => setAssigningDate(null)}
                              className="rounded px-2 py-1 text-xs text-gray-400"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() =>
                              setAssigningDate({
                                id: s.id,
                                date: new Date().toISOString().slice(0, 10),
                              })
                            }
                            className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition hover:bg-gray-100"
                          >
                            날짜 지정
                          </button>
                        )}
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
        className="fixed right-4 bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500 text-2xl text-white shadow-lg transition hover:bg-blue-600 md:hidden"
      >
        +
      </button>
    </AppShell>
  );
}
