'use client';

import { useCallback } from 'react';
import { useRoutines } from '@/features/routine/hooks/use-routines';
import { RoutineList } from '@/features/routine/components/routine-list';
import { RoutineForm } from '@/features/routine/components/routine-form';
import { Modal } from '@/components/ui/modal';
import { ListSkeleton } from '@/components/ui/skeleton';

export default function ManagePage() {
  const {
    templates, loading,
    showForm, editingTemplate,
    setShowForm, setEditingTemplate,
    handleCreateTemplate, handleUpdateTemplate, handleDeleteTemplate,
  } = useRoutines();

  const handleFormSubmit = useCallback(
    async (data: { name: string; time_slot: string | null; frequency: string | null; start_date?: string }) => {
      if (editingTemplate) {
        await handleUpdateTemplate(editingTemplate.id, data);
      } else {
        await handleCreateTemplate(data);
      }
    },
    [editingTemplate, handleUpdateTemplate, handleCreateTemplate],
  );

  const handleToggleActive = useCallback(
    (id: number, active: boolean) => handleUpdateTemplate(id, { active }),
    [handleUpdateTemplate],
  );

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-4">
        <ListSkeleton rows={5} rowHeight="h-14" />
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 md:py-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">루틴 관리</h2>
            <button
              onClick={() => setShowForm(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + 추가
            </button>
          </div>
          <RoutineList
            templates={templates}
            onEdit={setEditingTemplate}
            onToggleActive={handleToggleActive}
          />
        </div>
      </div>

      {/* 추가/수정 모달 */}
      <Modal
        open={showForm || !!editingTemplate}
        onClose={() => { setShowForm(false); setEditingTemplate(null); }}
        title={editingTemplate ? '루틴 수정' : '루틴 추가'}
      >
        <RoutineForm
          template={editingTemplate ?? undefined}
          onSubmit={handleFormSubmit}
          onDelete={editingTemplate ? () => handleDeleteTemplate(editingTemplate.id) : undefined}
          onClose={() => { setShowForm(false); setEditingTemplate(null); }}
        />
      </Modal>
    </>
  );
}
