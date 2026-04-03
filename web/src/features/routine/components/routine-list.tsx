'use client';

import type { RoutineTemplateRow } from '@/lib/types';

interface RoutineListProps {
  templates: RoutineTemplateRow[];
  onEdit: (template: RoutineTemplateRow) => void;
  onToggleActive: (id: number, active: boolean) => void;
}

/** 루틴 관리 목록 (활성/비활성 그룹) */
export function RoutineList({ templates, onEdit, onToggleActive }: RoutineListProps) {
  const active = templates.filter((t) => t.active);
  const inactive = templates.filter((t) => !t.active);

  return (
    <div className="space-y-4">
      <Section
        title={`활성 루틴 (${active.length})`}
        templates={active}
        onEdit={onEdit}
        toggleLabel="⏸"
        toggleTitle="일시정지"
        onToggle={(id) => onToggleActive(id, false)}
      />
      {inactive.length > 0 && (
        <Section
          title={`비활성 루틴 (${inactive.length})`}
          templates={inactive}
          onEdit={onEdit}
          toggleLabel="▶"
          toggleTitle="재활성화"
          onToggle={(id) => onToggleActive(id, true)}
        />
      )}
    </div>
  );
}

function Section({
  title, templates, onEdit, toggleLabel, toggleTitle, onToggle,
}: {
  title: string;
  templates: RoutineTemplateRow[];
  onEdit: (t: RoutineTemplateRow) => void;
  toggleLabel: string;
  toggleTitle: string;
  onToggle: (id: number) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-500">{title}</h3>
      <div className="space-y-1.5">
        {templates.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5"
          >
            <span className={`flex-1 text-sm font-medium ${t.active ? 'text-gray-900' : 'text-gray-400'}`}>
              {t.name}
            </span>
            <span className="text-xs text-gray-400">
              {t.time_slot ?? '-'} / {t.frequency ?? '매일'}
            </span>
            <button
              onClick={() => onEdit(t)}
              className="text-xs text-gray-500 hover:text-blue-500"
            >
              수정
            </button>
            <button
              onClick={() => onToggle(t.id)}
              title={toggleTitle}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              {toggleLabel}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
