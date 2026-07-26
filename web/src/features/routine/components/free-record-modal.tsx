'use client';

import { useState } from 'react';
import type { RoutineRecordRow, RoutineTemplateRow } from '@/features/routine/lib/types';
import { Modal } from '@/components/ui/modal';
import { TrashIcon } from '@/components/ui/icons';
import { addDays, formatDateShort, getTodayISO } from '@/lib/kst';
import { isActiveFreeRoutine } from './free-routine-section';

/** 소급 기록 허용 범위 — 미래는 막고 과거는 이 일수까지만 (ADR-0061) */
const BACKFILL_DAYS = 90;

const FIELD =
  'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none';

interface FreeRecordModalProps {
  open: boolean;
  /** 전체 템플릿 — 자율·활성만 선택 목록에 올린다 */
  templates: RoutineTemplateRow[];
  /** recordsDate의 기록 (자율 기록만 목록에 올린다) */
  records: RoutineRecordRow[];
  /** records가 어느 날짜의 것인지 — 목록 라벨에 그대로 쓴다 */
  recordsDate: string;
  /** 열 때 미리 선택할 루틴 (null이면 첫 자율 루틴) */
  initialTemplateId: number | null;
  onCreate: (templateId: number, date: string, memo: string | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

/** 자율 루틴 기록 모달 — 기록 입력 + 오기록 회수(그날 기록 목록·삭제) */
export function FreeRecordModal({
  open,
  templates,
  records,
  recordsDate,
  initialTemplateId,
  onCreate,
  onDelete,
  onClose,
}: FreeRecordModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="자율 루틴 기록">
      <FreeRecordForm
        freeTemplates={templates.filter(isActiveFreeRoutine)}
        freeRecords={records.filter((r) => r.entry_type === 'free')}
        recordsDate={recordsDate}
        initialTemplateId={initialTemplateId}
        onCreate={onCreate}
        onDelete={onDelete}
        onClose={onClose}
      />
    </Modal>
  );
}

interface FreeRecordFormProps {
  freeTemplates: RoutineTemplateRow[];
  freeRecords: RoutineRecordRow[];
  recordsDate: string;
  initialTemplateId: number | null;
  onCreate: (templateId: number, date: string, memo: string | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

/** 모달이 닫히면 언마운트되므로 열 때마다 입력이 초기 상태로 돌아온다 */
function FreeRecordForm({
  freeTemplates,
  freeRecords,
  recordsDate,
  initialTemplateId,
  onCreate,
  onDelete,
  onClose,
}: FreeRecordFormProps) {
  const today = getTodayISO();
  const minDate = addDays(today, -BACKFILL_DAYS);

  const [templateId, setTemplateId] = useState<number | null>(
    initialTemplateId ?? freeTemplates[0]?.id ?? null,
  );
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dateInRange = date >= minDate && date <= today;

  const handleSubmit = async () => {
    if (templateId === null) return;
    setError(null);
    if (!dateInRange) {
      setError(`기록할 수 있는 날짜는 ${minDate} ~ ${today}야`);
      return;
    }
    setSaving(true);
    try {
      await onCreate(templateId, date, memo.trim() || null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '기록 저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('이 기록을 지울까?')) return;
    setError(null);
    setDeletingId(id);
    try {
      await onDelete(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '기록 삭제 실패');
    } finally {
      setDeletingId(null);
    }
  };

  if (freeTemplates.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-400">자율 루틴이 없어. 먼저 등록하자</p>
    );
  }

  return (
    <div className="space-y-5">
      {/* 루틴 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">루틴</label>
        <select
          value={templateId ?? ''}
          onChange={(e) => setTemplateId(Number(e.target.value))}
          className={FIELD}
        >
          {freeTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </div>

      {/* 날짜 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">날짜</label>
        <input
          type="date"
          value={date}
          min={minDate}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className={FIELD}
        />
        {!dateInRange ? (
          <p className="mt-1 text-xs text-red-500">
            {minDate} ~ {today} 사이만 기록할 수 있어
          </p>
        ) : (
          date !== recordsDate && (
            <p className="mt-1 text-xs text-gray-400">
              아래 목록은 {formatDateShort(recordsDate)} 기준이야
            </p>
          )
        )}
      </div>

      {/* 메모 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">메모</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="남기고 싶은 메모 (선택)"
          rows={2}
          className={`${FIELD} resize-none`}
        />
      </div>

      {/* 그날 기록 — 오기록 회수 경로 */}
      {freeRecords.length > 0 && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            {formatDateShort(recordsDate)} 기록 {freeRecords.length}건
          </label>
          <div className="space-y-2">
            {freeRecords.map((record) => (
              <div
                key={record.id}
                className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="flex-1 truncate text-gray-700">
                  {record.name}
                  {record.completed_at && (
                    <span className="ml-2 text-xs text-gray-400">
                      {record.completed_at.slice(11, 16)}
                    </span>
                  )}
                </span>
                {record.memo && (
                  <span className="max-w-[40%] truncate text-xs text-gray-400">{record.memo}</span>
                )}
                <button
                  onClick={() => handleDelete(record.id)}
                  disabled={deletingId === record.id}
                  className="shrink-0 rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                  aria-label={`${record.name} 기록 삭제`}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* 버튼 */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-100"
        >
          닫기
        </button>
        <button
          onClick={handleSubmit}
          disabled={templateId === null || !dateInRange || saving}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '저장 중...' : '기록'}
        </button>
      </div>
    </div>
  );
}
