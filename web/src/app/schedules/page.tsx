'use client';

import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { startOfWeek, endOfWeek } from 'date-fns';
import { useSchedules } from '@/hooks/use-schedules';
import { AppShell } from '@/components/ui/app-shell';
import { CalendarHeader } from '@/components/calendar/calendar-header';
import { MonthView, DayDetailPanel } from '@/components/calendar/month-view';
import { WeekView } from '@/components/calendar/week-view';
import { DayView } from '@/components/calendar/day-view';
import { FilterBar } from '@/components/ui/filter-bar';
import { DndCalendar } from '@/components/calendar/dnd-calendar';
import { Modal } from '@/components/ui/modal';
import { ScheduleForm } from '@/components/schedule/schedule-form';

function getTitle(view: string, currentDate: Date): string {
  switch (view) {
    case 'month':
      return format(currentDate, 'yyyy년 M월', { locale: ko });
    case 'week': {
      const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
      const we = endOfWeek(currentDate, { weekStartsOn: 0 });
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
    handleSelectDate,
    toggleCategory,
    toggleStatus,
    clearFilters,
  } = useSchedules();

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
                />
              )}
            </div>

            {view === 'month' && selectedDate && (
              <div className="w-full md:sticky md:top-0 md:w-80 md:self-stretch md:max-h-[calc(100vh-160px)] md:overflow-y-auto">
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

      {/* 생성 모달 */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="일정 추가"
      >
        <ScheduleForm
          categories={categories}
          defaultDate={selectedDate ?? format(currentDate, 'yyyy-MM-dd')}
          onSubmit={handleCreate}
          onClose={() => setShowCreateModal(false)}
        />
      </Modal>

      {/* 수정 모달 */}
      <Modal
        open={!!editingSchedule}
        onClose={() => setEditingSchedule(null)}
        title="일정 수정"
      >
        {editingSchedule && (
          <ScheduleForm
            schedule={editingSchedule}
            categories={categories}
            onSubmit={handleUpdate}
            onDelete={handleDelete}
            onClose={() => setEditingSchedule(null)}
          />
        )}
      </Modal>
    </AppShell>
  );
}
