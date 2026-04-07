'use client';

import { useCallback } from 'react';
import type { RoutineView } from '../hooks/use-routines';
import type { RoutineRecordRow } from '@/features/routine/lib/types';
import { useRoutines } from '../hooks/use-routines';
import { DateNav } from './date-nav';
import { RoutineChecklist } from './routine-checklist';
import { RoutineStats } from './routine-stats';
import { RoutineList } from './routine-list';
import { RoutineForm } from './routine-form';
import { RoutineRecordDetail } from './routine-record-detail';
import { Modal } from '@/components/ui/modal';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { TopTabs } from '@/components/ui/tabs';
import { TabsSkeleton, ListSkeleton } from '@/components/ui/skeleton';

const ROUTINE_TABS: { id: RoutineView; label: string }[] = [
  { id: 'checklist', label: '체크리스트' },
  { id: 'stats', label: '통계' },
  { id: 'manage', label: '관리' },
];

export function RoutinePage() {
  const {
    view, selectedDate, templates, records, stats, yearlyStats, loading,
    showForm, editingTemplate, editingRecord,
    setView, setShowForm, setEditingTemplate, setEditingRecord,
    handlePrevDate, handleNextDate, handleToday,
    handleCreateTemplate, handleUpdateTemplate, handleDeleteTemplate,
    handleToggleRecord, handleUpdateMemo,
    fetchStats,
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
    async (data: { name: string; time_slot: string | null; frequency: string | null }) => {
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
      <div className="flex flex-1 flex-col">
        <TabsSkeleton count={3} />
        <div className="mx-auto w-full max-w-5xl px-4 py-4">
          <ListSkeleton rows={5} rowHeight="h-14" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col">
      {/* 탭 바 */}
      <TopTabs tabs={ROUTINE_TABS} active={view} onChange={setView} />

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-4 md:py-6">
          {view === 'checklist' && (
            <div className="space-y-5">
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
          )}
          {view === 'stats' && (
            <RoutineStats
              stats={stats}
              yearlyStats={yearlyStats}
              fetchStats={fetchStats}
              selectedDate={selectedDate}
            />
          )}
          {view === 'manage' && (
            <div className="space-y-4">
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
          )}
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
    </div>
  );
}

