'use client';

import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { startOfWeek, endOfWeek } from 'date-fns';
import { WEEK_START } from '@/features/schedule/lib/calendar-utils';
import { useSchedules } from '@/features/schedule/hooks/use-schedules';
import { AppShell } from '@/components/ui/app-shell';
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

export default function SchedulesPage() {
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
    selectedStatuses,
    loading,
    filteredSchedules,
    handlePrev,
    handleNext,
    handleToday,
    handleStatusChange,
    handleDateChange,
    handleEndDateChange,
    handleCreate,
    handleUpdate,
    handleDelete,
    handlePostpone,
    handleMoveToBacklog,
    handleDeleteById,
    handleSelectDate,
    toggleCategory,
    toggleStatus,
    clearFilters,
  } = useSchedules();

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
      <div className="flex flex-1 flex-col">
        <CalendarHeader
          view={view}
          onViewChange={setView}
          title={getTitle(view, currentDate)}
          onPrev={handlePrev}
          onNext={handleNext}
          onToday={handleToday}
          onAdd={() => setShowCreateModal(true)}
        />

        <FilterBar
          categories={categories}
          selectedCategories={selectedCategories}
          selectedStatuses={selectedStatuses}
          onToggleCategory={toggleCategory}
          onToggleStatus={toggleStatus}
          onClearFilters={clearFilters}
        />

        <DndCalendar
          schedules={filteredSchedules}
          categories={categories}
          onDateChange={handleDateChange}
          onEndDateChange={handleEndDateChange}
        >
          <div className={`md:flex md:flex-1 md:min-h-0 ${view === 'month' && selectedDate ? '' : 'md:flex-col'}`}>
            <div className={view === 'month' && selectedDate ? 'flex-1' : 'md:flex md:flex-1 md:flex-col'}>
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
                />
              )}
              {view === 'day' && (
                <DayView
                  currentDate={currentDate}
                  schedules={filteredSchedules}
                  categories={categories}
                  onScheduleClick={setEditingSchedule}
                  onStatusChange={handleStatusChange}
                  onPostpone={handlePostpone}
                  onMoveToBacklog={handleMoveToBacklog}
                  onDelete={handleDeleteById}
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
      </div>

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
            onDelete={handleDelete}
            onClose={() => setEditingSchedule(null)}
            onDirtyChange={setFormDirty}
          />
        )}
      </Modal>
    </AppShell>
  );
}
