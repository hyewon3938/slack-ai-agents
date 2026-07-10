'use client';

import { useState, useCallback, useEffect } from 'react';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import { SCHEDULE_STATUSES, STATUS_LABELS } from '@/features/schedule/lib/types';
import type { CategoryRow } from '@/lib/types';
import { getCategoryStyle } from '@/lib/types';

interface ScheduleFormProps {
  schedule?: ScheduleRow | null;
  categories: CategoryRow[];
  defaultDate?: string | null;
  onSubmit: (data: Partial<ScheduleRow>) => Promise<void>;
  // 실제 삭제가 아니라 삭제 사유 모달을 여는 트리거 (#590)
  onDelete?: () => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/** categoryId가 가리키는 카테고리의 최상위(parent_id IS NULL) id */
const getTopCategoryId = (categoryId: number | null, categories: CategoryRow[]): number | null => {
  if (categoryId == null) return null;
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return null;
  return cat.parent_id ?? cat.id;
};

/** categoryId가 가리키는 카테고리의 type (child 우선, 없으면 parent) */
const getCategoryTypeById = (
  categoryId: number | null,
  categories: CategoryRow[],
): string | null => {
  if (categoryId == null) return null;
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return null;
  if (cat.type) return cat.type;
  const top = categories.find((c) => c.id === cat.parent_id);
  return top?.type ?? null;
};

export function ScheduleForm({
  schedule,
  categories,
  defaultDate,
  onSubmit,
  onDelete,
  onClose,
  onDirtyChange,
}: ScheduleFormProps) {
  const [title, setTitle] = useState(schedule?.title ?? '');
  const [date, setDate] = useState(schedule?.date ?? defaultDate ?? '');
  const [endDate, setEndDate] = useState(schedule?.end_date ?? '');
  const [showEndDate, setShowEndDate] = useState(!!schedule?.end_date);
  const [status, setStatus] = useState(schedule?.status ?? 'todo');
  const [categoryId, setCategoryId] = useState<number | null>(schedule?.category_id ?? null);
  // child가 선택돼 있으면 그 parent를 펼침. parent만 선택 또는 null이면 펼침 없음.
  const initialExpandedTop = (() => {
    if (!schedule?.category_id) return null;
    const cat = categories.find((c) => c.id === schedule.category_id);
    return cat?.parent_id ?? null;
  })();
  const [expandedTopId, setExpandedTopId] = useState<number | null>(initialExpandedTop);
  const [memo, setMemo] = useState(schedule?.memo ?? '');
  const [important, setImportant] = useState(schedule?.important ?? false);
  const [saving, setSaving] = useState(false);

  const parentCategories = categories.filter((c) => c.parent_id === null);
  const getChildrenById = (parentId: number) => categories.filter((c) => c.parent_id === parentId);
  const topCategoryId = getTopCategoryId(categoryId, categories);
  const categoryType = getCategoryTypeById(categoryId, categories);

  const isDirty = useCallback(() => {
    if (!schedule) {
      return !!(title || date || endDate || memo || categoryId != null || important);
    }
    return (
      title !== (schedule.title ?? '') ||
      date !== (schedule.date ?? '') ||
      endDate !== (schedule.end_date ?? '') ||
      status !== schedule.status ||
      categoryId !== (schedule.category_id ?? null) ||
      memo !== (schedule.memo ?? '') ||
      important !== (schedule.important ?? false)
    );
  }, [title, date, endDate, status, categoryId, memo, important, schedule]);

  useEffect(() => {
    onDirtyChange?.(isDirty());
  }, [isDirty, onDirtyChange]);

  const handleClose = useCallback(() => {
    if (isDirty() && !confirm('수정 중인 내용이 있어. 닫을까?')) return;
    onClose();
  }, [isDirty, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    // 종료일이 시작일보다 이전이면 경고
    if (showEndDate && endDate && date && endDate < date) {
      alert('종료일은 시작일 이후여야 해');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        date: date || null,
        end_date: showEndDate && endDate ? endDate : null,
        status,
        category_id: categoryId,
        memo: memo || null,
        important,
      });
      onClose();
    } catch {
      alert('저장에 실패했어');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 제목 */}
      <div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="일정 제목"
          autoFocus
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
        />
      </div>

      {/* 날짜 */}
      <div>
        <label className="mb-1 block text-xs text-gray-500">날짜</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* 종료일 토글 */}
      {!showEndDate ? (
        <button
          type="button"
          onClick={() => setShowEndDate(true)}
          className="text-xs text-blue-500 hover:text-blue-600"
        >
          + 종료일 추가
        </button>
      ) : (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-gray-500">종료일</label>
            <button
              type="button"
              onClick={() => {
                setShowEndDate(false);
                setEndDate('');
              }}
              className="text-xs text-gray-400 hover:text-red-400"
            >
              종료일 제거
            </button>
          </div>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      )}

      {/* 상태 — event 타입 카테고리는 상태 변경 불필요 */}
      {categoryType !== 'event' && (
        <div>
          <label className="mb-1 block text-xs text-gray-500">상태</label>
          <div className="flex gap-1">
            {SCHEDULE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                  status === s
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 카테고리 */}
      <div>
        <label className="mb-2 block text-xs text-gray-500">카테고리</label>
        <div className="flex flex-wrap gap-1.5">
          {expandedTopId != null ? (
            <>
              {/* 펼쳐진 상위 카테고리 */}
              {(() => {
                const parent = parentCategories.find((c) => c.id === expandedTopId);
                if (!parent) return null;
                const style = getCategoryStyle(parent.color);
                return (
                  <button
                    type="button"
                    onClick={() => setExpandedTopId(null)}
                    className="rounded-full px-3 py-1.5 text-xs font-medium"
                    style={{
                      backgroundColor: style.bg,
                      color: style.text,
                      outline: `2px solid ${style.border}`,
                      outlineOffset: '2px',
                    }}
                  >
                    {parent.name} ▾
                  </button>
                );
              })()}
            </>
          ) : (
            <>
              {/* 없음 버튼 */}
              <button
                type="button"
                onClick={() => {
                  setCategoryId(null);
                  setExpandedTopId(null);
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  categoryId == null
                    ? 'bg-gray-200 ring-2 ring-gray-400 ring-offset-1'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                없음
              </button>
              {/* 상위 카테고리 버튼들 */}
              {parentCategories.map((c) => {
                const style = getCategoryStyle(c.color);
                const selected = topCategoryId === c.id;
                const children = getChildrenById(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(c.id);
                      setExpandedTopId(children.length > 0 ? c.id : null);
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      selected ? '' : 'opacity-60 hover:opacity-100'
                    }`}
                    style={{
                      backgroundColor: style.bg,
                      color: style.text,
                      ...(selected
                        ? { outline: `2px solid ${style.border}`, outlineOffset: '2px' }
                        : {}),
                    }}
                  >
                    {c.name}
                  </button>
                );
              })}
            </>
          )}
        </div>
        {/* 하위 카테고리 목록 */}
        {expandedTopId != null && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {getChildrenById(expandedTopId).map((sub) => {
              const style = getCategoryStyle(sub.color);
              const selected = categoryId === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setCategoryId(selected ? expandedTopId : sub.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    selected ? '' : 'opacity-60 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: style.bg,
                    color: style.text,
                    ...(selected
                      ? { outline: `2px solid ${style.border}`, outlineOffset: '2px' }
                      : {}),
                  }}
                >
                  {sub.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 중요 */}
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={important}
          onChange={(e) => setImportant(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-200"
        />
        <span className="text-sm text-gray-700">중요 표시 ★</span>
      </label>

      {/* 메모 */}
      <div>
        <label className="mb-1 block text-xs text-gray-500">메모</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="메모 (선택)"
          rows={5}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none md:min-h-[180px]"
        />
      </div>

      {/* 버튼 */}
      <div className="flex gap-2">
        {onDelete && schedule && (
          /* 삭제 확인은 사유 모달(DeleteReasonModal) 단일 지점 — 여기에 confirm 추가 금지 (#590) */
          <button
            type="button"
            onClick={() => onDelete()}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50"
          >
            삭제
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleClose}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? '저장중...' : schedule ? '수정' : '추가'}
        </button>
      </div>
    </form>
  );
}
