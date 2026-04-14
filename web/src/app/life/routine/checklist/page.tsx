'use client';

import { useCallback } from 'react';
import type { RoutineRecordRow } from '@/features/routine/lib/types';
import { useRoutines } from '@/features/routine/hooks/use-routines';
import { DateNav } from '@/features/routine/components/date-nav';
import { RoutineChecklist } from '@/features/routine/components/routine-checklist';
import { RoutineForm } from '@/features/routine/components/routine-form';
import { RoutineRecordDetail } from '@/features/routine/components/routine-record-detail';
import { Modal } from '@/components/ui/modal';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ListSkeleton } from '@/components/ui/skeleton';

export default function ChecklistPage() {
  const {
    selectedDate, templates, records, loading,
    showForm, editingTemplate, editingRecord,
    setShowForm, setEditingTemplate, setEditingRecord,
    handlePrevDate, handleNextDate, handleToday,
    handleCreateTemplate, handleUpdateTemplate, handleDeleteTemplate,
    handleToggleRecord, handleUpdateMemo,
  } = useRoutines();

  const handleEditTemplate = useCallback(
    (templateId: number) => {
      const t = templates.find((tpl) => tpl.id === templateId);
      if (t) setEditingTemplate(t);
    },
    [templates, setEditingTemplate],
  );

  const handleMemoClick = useCallback(
    (record: RoutineRecordRow) => setEditingRecord(record),
    [setEditingRecord],
  );

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
        <div className="mx-auto max-w-5xl space-y-5 px-4 py-4 md:py-6">
          <DateNav
            date={selectedDate}
            onPrev={handlePrevDate}
            onNext={handleNextDate}
            onToday={handleToday}
          />
          <RoutineChecklist
            records={records}
            onToggle={handleToggleRecord}
            onMemoClick={handleMemoClick}
            onEditTemplate={handleEditTemplate}
          />
        </div>
      </div>

      {/* 모바일 FAB */}
      <button
        onClick={() => setShowForm(true)}
        className="fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-2xl text-white shadow-lg hover:bg-blue-700 md:hidden"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
      >
        +
      </button>

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

      {/* 기록 상세 (데스크탑: 모달, 모바일: 바텀시트) */}
      <div className="hidden md:block">
        <Modal
          open={!!editingRecord}
          onClose={() => setEditingRecord(null)}
          title="기록 상세"
        >
          {editingRecord && (
            <RoutineRecordDetail
              record={editingRecord}
              onSaveMemo={handleUpdateMemo}
              onClose={() => setEditingRecord(null)}
            />
          )}
        </Modal>
      </div>
      <BottomSheet
        open={!!editingRecord}
        onClose={() => setEditingRecord(null)}
      >
        {editingRecord && (
          <div className="px-4 pb-4">
            <RoutineRecordDetail
              record={editingRecord}
              onSaveMemo={handleUpdateMemo}
              onClose={() => setEditingRecord(null)}
            />
          </div>
        )}
      </BottomSheet>
    </>
  );
}
