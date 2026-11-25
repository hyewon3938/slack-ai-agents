'use client';

import { useState } from 'react';
import type { CategoryLimitWithUsage } from '@/features/budget/lib/types';
import { PencilIcon, CheckCircleIcon, XMarkIcon } from '@/components/ui/icons';

export function CategoryLimitItem({
  limit,
  onUpdate,
  onDelete,
}: {
  limit: CategoryLimitWithUsage;
  onUpdate: (id: number, target_count: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState(String(limit.target_count));

  const handleSave = async () => {
    const t = Number(target);
    if (!Number.isInteger(t) || t < 1 || t > 50) return;
    setSaving(true);
    try {
      await onUpdate(limit.id, t);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{limit.category}</span>
        {!editing && (
          <button
            onClick={() => {
              setTarget(String(limit.target_count));
              setEditing(true);
            }}
            className="rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
          >
            <PencilIcon size={14} />
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-gray-400">한도</label>
            <input
              type="number"
              min="1"
              max="50"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
            />
            <span className="text-xs text-gray-400">회</span>
          </div>
          <div className="flex justify-between">
            <button
              onClick={() => {
                if (confirm('이 한도를 삭제할까?')) void onDelete(limit.id);
              }}
              disabled={saving}
              className="text-xs text-red-400 hover:text-red-600"
            >
              삭제
            </button>
            <div className="flex gap-1.5">
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100"
              >
                <XMarkIcon size={16} />
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="rounded-md p-1 text-blue-500 hover:bg-blue-50"
              >
                <CheckCircleIcon size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-1 text-sm text-gray-500">주기당 {limit.target_count}회</div>
      )}
    </div>
  );
}
