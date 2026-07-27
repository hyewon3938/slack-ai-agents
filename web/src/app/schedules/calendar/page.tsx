'use client';

import { Suspense, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { startOfWeek, endOfWeek } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';
import { WEEK_START } from '@/features/schedule/lib/calendar-utils';
import { useSchedules } from '@/features/schedule/hooks/use-schedules';
import { TabsSkeleton, ListSkeleton } from '@/components/ui/skeleton';
import { CalendarHeader } from '@/features/schedule/components/calendar-header';
import { MonthView } from '@/features/schedule/components/month-view';
import { DayDetailPanel } from '@/features/schedule/components/day-detail-panel';
import { WeekView } from '@/features/schedule/components/week-view';
import { DayView } from '@/features/schedule/components/day-view';
import { FilterBar } from '@/components/ui/filter-bar';
import { DndCalendar } from '@/features/schedule/components/dnd-calendar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Modal } from '@/components/ui/modal';
import { ScheduleForm } from '@/features/schedule/components/schedule-form';
import { DeleteReasonModal } from '@/features/schedule/components/delete-reason-modal';
import type { CalendarView } from '@/features/schedule/components/calendar-header';

function getInitialView(): CalendarView {
  if (typeof window === 'undefined') return 'day';
  return window.innerWidth >= 768 ? 'week' : 'day';
}

function getTitle(view: string, currentDate: Date): string {
  switch (view) {
    case 'month':
      return format(currentDate, 'yyyy년 M월', { locale: ko });
    case 'week': {
      const ws = startOfWeek(currentDate, { weekStartsOn: WEEK_START });
      const we = endOfWeek(currentDate, { weekStartsOn: WEEK_START });
      return `${format(ws, 'M/d')} - ${format(we, 'M/d')}`;
    }
    case 'day':
      return format(currentDate, 'M월 d일 (EEE)', { locale: ko });
    default:
      return '';
  }
}

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 p-4">
          <div className="mx-auto max-w-3xl">
            <ListSkeleton rows={5} rowHeight="h-20" />
          </div>
        </div>
      }
    >
      <CalendarContent />
    </Suspense>
  );
}

function CalendarContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const viewParam = searchParams.get('view') as CalendarView | null;
  const validViews: CalendarView[] = ['month', 'week', 'day'];
  const initialView = viewParam && validViews.includes(viewParam) ? viewParam : getInitialView();

  const {
    view,
    setView,
    currentDate,
    categories,
    selectedDate,
    editingSchedule,
    setEditingSchedule,
    showCreateModal,
    setShowCreateModal,
    selectedCategories,
    selectedSubcategories,
    selectedStatuses,
    loading,
    filteredSchedules,
    handlePrev,
    handleNext,
    handleToday,
    handleStatusChange,
    handleToggleImportant,
    handleDateChange,
    handleEndDateChange,
    handleCreate,
    handleUpdate,
    handlePostpone,
    handleMoveToBacklog,
    deleteTarget,
    setDeleteTarget,
    requestDelete,
    confirmDelete,
    handleSelectDate,
    toggleCategory,
    toggleSubcategory,
    toggleStatus,
    clearFilters,
  } = useSchedules(initialView);

  const [formDirty, setFormDirty] = useState(false);

  const handleViewChange = useCallback(
    (v: CalendarView) => {
      setView(v);
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', v);
      router.replace(`/schedules/calendar?${params.toString()}`, { scroll: false });
    },
    [setView, router, searchParams],
  );

  const handleBeforeClose = useCallback(
    () => !formDirty || confirm('수정 중인 내용이 있어. 닫을까?'),
    [formDirty],
  );

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <TabsSkeleton count={3} />
        <div className="flex-1 p-4">
          <div className="mx-auto max-w-3xl">
            <ListSkeleton rows={5} rowHeight="h-20" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <CalendarHeader
        view={view}
        onViewChange={handleViewChange}
        title={getTitle(view, currentDate)}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onAdd={() => setShowCreateModal(true)}
      />

      <FilterBar
        categories={categories}
        selectedCategories={selectedCategories}
        selectedSubcategories={selectedSubcategories}
        selectedStatuses={selectedStatuses}
        onToggleCategory={toggleCategory}
        onToggleSubcategory={toggleSubcategory}
        onToggleStatus={toggleStatus}
        onClearFilters={clearFilters}
      />

      <DndCalendar
        schedules={filteredSchedules}
        onDateChange={handleDateChange}
        onEndDateChange={handleEndDateChange}
      >
        <div
          className={`md:flex md:flex-1 md:min-h-0 ${view === 'month' && selectedDate ? '' : 'md:flex-col'}`}
        >
          <div
            className={
              view === 'month' && selectedDate ? 'flex-1' : 'md:flex md:flex-1 md:flex-col'
            }
          >
            {view === 'month' && (
              <MonthView
                currentDate={currentDate}
                schedules={filteredSchedules}
                categories={categories}
                selectedDate={selectedDate}
                onSelectDate={handleSelectDate}
                onScheduleClick={setEditingSchedule}
                onStatusChange={handleStatusChange}
              />
            )}
            {view === 'week' && (
              <WeekView
                currentDate={currentDate}
                schedules={filteredSchedules}
                categories={categories}
                selectedDate={selectedDate}
                onSelectDate={handleSelectDate}
                onScheduleClick={setEditingSchedule}
                onStatusChange={handleStatusChange}
                onToggleImportant={handleToggleImportant}
                onPostpone={handlePostpone}
                onMoveToBacklog={handleMoveToBacklog}
                onDelete={requestDelete}
              />
            )}
            {view === 'day' && (
              <DayView
                currentDate={currentDate}
                schedules={filteredSchedules}
                categories={categories}
                onScheduleClick={setEditingSchedule}
                onStatusChange={handleStatusChange}
                onToggleImportant={handleToggleImportant}
                onPostpone={handlePostpone}
                onMoveToBacklog={handleMoveToBacklog}
                onDelete={requestDelete}
              />
            )}
          </div>

          {/* 데스크탑: 사이드 패널 */}
          {view === 'month' && selectedDate && (
            <div className="hidden md:block md:sticky md:top-0 md:w-80 md:self-stretch md:max-h-[calc(100vh-160px)] md:overflow-y-auto">
              <DayDetailPanel
                dateStr={selectedDate}
                schedules={filteredSchedules}
                categories={categories}
                onScheduleClick={setEditingSchedule}
                onStatusChange={handleStatusChange}
                onClose={() => handleSelectDate(selectedDate)}
              />
            </div>
          )}
        </div>
      </DndCalendar>

      {/* 모바일: 바텀시트 */}
      <BottomSheet
        open={view === 'month' && !!selectedDate}
        onClose={() => selectedDate && handleSelectDate(selectedDate)}
      >
        {selectedDate && (
          <DayDetailPanel
            dateStr={selectedDate}
            schedules={filteredSchedules}
            categories={categories}
            onScheduleClick={setEditingSchedule}
            onStatusChange={handleStatusChange}
            onClose={() => handleSelectDate(selectedDate)}
          />
        )}
      </BottomSheet>

      {/* 생성 모달 */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onBeforeClose={handleBeforeClose}
        title="일정 추가"
      >
        <ScheduleForm
          categories={categories}
          defaultDate={selectedDate ?? format(currentDate, 'yyyy-MM-dd')}
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
            onDelete={() => requestDelete(editingSchedule.id)}
            onClose={() => setEditingSchedule(null)}
            onDirtyChange={setFormDirty}
          />
        )}
      </Modal>

      {/* 삭제 사유 모달 — 삭제 확인의 유일한 지점 (#590) */}
      <DeleteReasonModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
