'use client';

import type { RoutineRecordRow, RoutineTemplateRow } from '@/features/routine/lib/types';

interface FreeRoutineSectionProps {
  /** 전체 템플릿 — 자율·활성만 내부에서 추린다 */
  templates: RoutineTemplateRow[];
  /** 표시 중인 날짜의 기록 (자율 기록만 내부에서 센다) */
  records: RoutineRecordRow[];
  /** 기록 모달 열기. templateId를 주면 그 루틴이 선택된 상태로 열린다 */
  onOpenRecord: (templateId: number | null) => void;
}

/** 자율 섹션에 노출할 루틴 판정 — 체크리스트의 빈 상태 판정과 공유한다 */
export const isActiveFreeRoutine = (template: RoutineTemplateRow): boolean =>
  template.tracking_mode === 'free' && template.active;

/**
 * 자율 루틴 섹션 — 주기 없이 수행할 때마다 기록하는 루틴 (ADR-0061).
 * 달성률 개념을 적용하지 않고 그날 기록 횟수만 보여준다.
 */
export function FreeRoutineSection({ templates, records, onOpenRecord }: FreeRoutineSectionProps) {
  const freeTemplates = templates.filter(isActiveFreeRoutine);
  if (freeTemplates.length === 0) return null;

  const countByTemplate = new Map<number, number>();
  for (const record of records) {
    if (record.entry_type !== 'free') continue;
    countByTemplate.set(record.template_id, (countByTemplate.get(record.template_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500">자율 루틴</span>
        <div className="h-px flex-1 bg-gray-200" />
        <button
          onClick={() => onOpenRecord(null)}
          className="shrink-0 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-100"
        >
          기록하기
        </button>
      </div>
      {freeTemplates.map((template) => {
        const count = countByTemplate.get(template.id) ?? 0;
        return (
          <button
            key={template.id}
            onClick={() => onOpenRecord(template.id)}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:shadow-sm"
          >
            <span className="flex-1 text-sm font-medium text-gray-900">{template.name}</span>
            {count > 0 ? (
              <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
                {count}번
              </span>
            ) : (
              <span className="shrink-0 text-xs text-gray-400">기록 없음</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
