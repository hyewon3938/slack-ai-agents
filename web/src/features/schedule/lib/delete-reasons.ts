/**
 * 일정 삭제 사유 고정 어휘 (#590, ADR-0060).
 * schedule_changes.delete_reason_category CHECK 제약(마이그레이션 106)과 동기 — 값 변경 시 마이그레이션도 함께.
 */
export const DELETE_REASONS = [
  { value: 'mistake', label: '실수로 만든 일정' },
  { value: 'changed_mind', label: '하기 싫어졌거나 마음이 바뀜' },
  { value: 'external', label: '상대방·외부 사정으로 취소됨' },
  { value: 'rescheduled', label: '다른 날짜·일정으로 대체함' },
  { value: 'other', label: '기타' },
] as const;

export type DeleteReasonCategory = (typeof DELETE_REASONS)[number]['value'];

export interface DeleteReason {
  category: DeleteReasonCategory;
  text: string | null;
}

export const isDeleteReasonCategory = (value: unknown): value is DeleteReasonCategory =>
  typeof value === 'string' && DELETE_REASONS.some((r) => r.value === value);
