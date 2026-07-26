'use client';

import type { RoutineRecordRow, RoutineTemplateRow } from '@/features/routine/lib/types';
import { RoutineCard } from './routine-card';
import { FreeRoutineSection, isActiveFreeRoutine } from './free-routine-section';

interface RoutineChecklistProps {
  records: RoutineRecordRow[];
  onToggle: (id: number, completed: boolean) => void;
  onMemoClick: (record: RoutineRecordRow) => void;
  onEditTemplate: (templateId: number) => void;
  /** 자율 루틴 섹션용 전체 템플릿 — 배선한 화면에서만 전달한다 */
  templates?: RoutineTemplateRow[];
  /** 자율 기록 모달 열기 — 없으면 자율 섹션을 렌더하지 않는다 */
  onOpenFreeRecord?: (templateId: number | null) => void;
}

/** 시간대별 그룹 체크리스트 + 자율 루틴 섹션 */
export function RoutineChecklist({
  records,
  onToggle,
  onMemoClick,
  onEditTemplate,
  templates,
  onOpenFreeRecord,
}: RoutineChecklistProps) {
  // 기대된 발생만 체크리스트·달성률에 반영한다 — UI 층의 측정 격리 지점 (ADR-0061)
  const scheduled = records.filter((r) => r.entry_type === 'scheduled');
  const dayRecords = scheduled.filter((r) => r.time_slot === '낮' || !r.time_slot);
  const nightRecords = scheduled.filter((r) => r.time_slot === '밤');
  const completed = scheduled.filter((r) => r.completed).length;

  const freeTemplates = templates?.filter(isActiveFreeRoutine) ?? [];
  const showFreeSection = !!onOpenFreeRecord && freeTemplates.length > 0;

  if (scheduled.length === 0 && !showFreeSection) {
    return (
      <div className="py-12 text-center text-sm text-gray-400">
        오늘 루틴이 없어. 루틴을 추가해볼까?
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {dayRecords.length > 0 && (
        <Group
          title="☀️ 낮"
          records={dayRecords}
          onToggle={onToggle}
          onMemoClick={onMemoClick}
          onEditTemplate={onEditTemplate}
        />
      )}
      {nightRecords.length > 0 && (
        <Group
          title="🌙 밤"
          records={nightRecords}
          onToggle={onToggle}
          onMemoClick={onMemoClick}
          onEditTemplate={onEditTemplate}
        />
      )}

      {/* 달성률 바 (주기형 기록이 있을 때만 — 자율에는 달성률 개념이 없다) */}
      {scheduled.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <span className="text-sm font-medium text-gray-600">달성률</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${(completed / scheduled.length) * 100}%` }}
            />
          </div>
          <span className="text-sm font-semibold text-gray-900">
            {completed}/{scheduled.length} ({Math.round((completed / scheduled.length) * 100)}%)
          </span>
        </div>
      )}

      {showFreeSection && onOpenFreeRecord && (
        <FreeRoutineSection
          templates={freeTemplates}
          records={records}
          onOpenRecord={onOpenFreeRecord}
        />
      )}
    </div>
  );
}

function Group({
  title,
  records,
  onToggle,
  onMemoClick,
  onEditTemplate,
}: {
  title: string;
  records: RoutineRecordRow[];
  onToggle: (id: number, completed: boolean) => void;
  onMemoClick: (record: RoutineRecordRow) => void;
  onEditTemplate: (templateId: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500">{title}</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>
      {records.map((r) => (
        <RoutineCard
          key={r.id}
          record={r}
          onToggle={onToggle}
          onMemoClick={onMemoClick}
          onEdit={onEditTemplate}
        />
      ))}
    </div>
  );
}
