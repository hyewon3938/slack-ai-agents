'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import {
  DELETE_REASONS,
  type DeleteReason,
  type DeleteReasonCategory,
} from '@/features/schedule/lib/delete-reasons';

interface DeleteReasonModalProps {
  open: boolean;
  onClose: () => void;
  /** 사유와 함께 실제 삭제 실행. 삭제 확인은 이 모달이 유일한 지점 */
  onConfirm: (reason: DeleteReason) => Promise<void>;
}

export function DeleteReasonModal({ open, onClose, onConfirm }: DeleteReasonModalProps) {
  const [category, setCategory] = useState<DeleteReasonCategory | null>(null);
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // 열릴 때마다 초기화
  useEffect(() => {
    if (open) {
      setCategory(null);
      setText('');
      setDeleting(false);
    }
  }, [open]);

  const needText = category === 'other';
  const canSubmit = category !== null && (!needText || text.trim().length > 0) && !deleting;

  const handleConfirm = async () => {
    if (category === null || !canSubmit) return;
    setDeleting(true);
    try {
      await onConfirm({ category, text: text.trim() || null });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="일정 삭제">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">왜 삭제하는지 남겨두면 나중에 패턴 분석에 쓰여.</p>

        <div className="space-y-1.5">
          {DELETE_REASONS.map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                category === r.value
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="delete-reason"
                value={r.value}
                checked={category === r.value}
                onChange={() => setCategory(r.value)}
                className="h-4 w-4 border-gray-300 text-red-500 focus:ring-red-200"
              />
              <span className="text-sm text-gray-700">{r.label}</span>
            </label>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder={needText ? '무슨 일인지 적어줘' : '덧붙일 메모 (선택)'}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />

        <div className="flex gap-2">
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="rounded-lg bg-red-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            {deleting ? '삭제중...' : '삭제'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
