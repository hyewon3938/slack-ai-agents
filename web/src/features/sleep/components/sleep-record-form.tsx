'use client';

import { useState } from 'react';
import type { DailySleep, SleepRecordInput, SleepEventInput, SleepTag } from '../lib/types';
import { SLEEP_TAGS } from '../lib/types';
import { getTodayISO } from '@/lib/kst';
import { PlusIcon, TrashIcon, XMarkIcon } from '@/components/ui/icons';

/** 훅에서 내려받는 mutation 묶음 */
export interface SleepFormMutations {
  createRecord: (input: SleepRecordInput) => Promise<void>;
  updateRecord: (id: number, input: SleepRecordInput) => Promise<void>;
  deleteRecord: (id: number) => Promise<void>;
  createEvent: (input: SleepEventInput) => Promise<void>;
  deleteEvent: (id: number) => Promise<void>;
}

interface SleepRecordFormProps {
  /** add 모드 기본 날짜 (없으면 오늘) */
  date?: string;
  /** edit 모드: 해당 날짜의 통합 수면 데이터 */
  existing?: DailySleep | null;
  onSubmitDone: () => void;
  onClose: () => void;
  mutations: SleepFormMutations;
}

interface TimePair {
  bedtime: string;
  wake_time: string;
}

const FIELD =
  'rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none';

/** DB의 시각("HH:MM" 또는 "HH:MM:SS")을 input[type=time]이 쓰는 "HH:MM"으로 정규화 */
function toHHMM(t: string | null): string {
  return t ? t.slice(0, 5) : '';
}

export function SleepRecordForm({
  date,
  existing,
  onSubmitDone,
  onClose,
  mutations,
}: SleepRecordFormProps) {
  const { createRecord, deleteRecord, createEvent, deleteEvent } = mutations;

  const [recordDate, setRecordDate] = useState<string>(existing?.date ?? date ?? getTodayISO());
  const [segments, setSegments] = useState<TimePair[]>(() =>
    existing
      ? existing.nightSegments.map((s) => ({
          bedtime: toHHMM(s.bedtime),
          wake_time: toHHMM(s.wake_time),
        }))
      : [{ bedtime: '', wake_time: '' }],
  );
  const [midWakes, setMidWakes] = useState<string[]>(() =>
    existing ? existing.nightEvents.map((e) => toHHMM(e.event_time)) : [],
  );
  const [naps, setNaps] = useState<TimePair[]>(() =>
    existing
      ? [...existing.morningSleeps, ...existing.afternoonNaps].map((n) => ({
          bedtime: toHHMM(n.bedtime),
          wake_time: toHHMM(n.wake_time),
        }))
      : [],
  );
  const [tags, setTags] = useState<string[]>(() =>
    existing
      ? Array.from(
          new Set([...existing.nightSegments, ...existing.nightMemoRecords].flatMap((r) => r.tags)),
        )
      : [],
  );
  const [memo, setMemo] = useState<string>(
    () =>
      (existing
        ? [...existing.nightSegments, ...existing.nightMemoRecords].find((r) => r.memo)?.memo
        : '') ?? '',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!existing;

  // ─── 행 편집 헬퍼 ─────────────────────────────────
  const updatePair = (
    setter: React.Dispatch<React.SetStateAction<TimePair[]>>,
    index: number,
    key: keyof TimePair,
    value: string,
  ) => {
    setter((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  };

  const toggleTag = (tag: SleepTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const hasContent =
    segments.some((s) => s.bedtime || s.wake_time) ||
    naps.some((n) => n.bedtime || n.wake_time) ||
    midWakes.some((w) => w) ||
    memo.trim().length > 0 ||
    tags.length > 0;

  const handleSubmit = async () => {
    setError(null);
    const cleanSegments = segments.filter((s) => s.bedtime || s.wake_time);
    const cleanNaps = naps.filter((n) => n.bedtime || n.wake_time);
    const cleanMidWakes = midWakes.filter((w) => w);
    const trimmedMemo = memo.trim();

    if (
      cleanSegments.length === 0 &&
      cleanNaps.length === 0 &&
      cleanMidWakes.length === 0 &&
      !trimmedMemo &&
      tags.length === 0
    ) {
      setError('기록할 수면 정보를 입력해줘');
      return;
    }

    setLoading(true);
    try {
      // edit 모드 = replace-day: 기존 레코드/이벤트를 전부 삭제 후 재생성
      if (existing) {
        const oldRecords = [
          ...existing.nightSegments,
          ...existing.nightMemoRecords,
          ...existing.morningSleeps,
          ...existing.afternoonNaps,
        ];
        for (const r of oldRecords) {
          await deleteRecord(r.id);
        }
        for (const e of existing.nightEvents) {
          await deleteEvent(e.id);
        }
      }

      // 밤잠 구간 — 태그·메모는 첫 구간에만 실어 보낸다
      for (let i = 0; i < cleanSegments.length; i++) {
        const seg = cleanSegments[i];
        const first = i === 0;
        await createRecord({
          date: recordDate,
          sleep_type: 'night',
          bedtime: seg.bedtime || null,
          wake_time: seg.wake_time || null,
          tags: first ? tags : [],
          memo: first ? trimmedMemo || null : null,
        });
      }

      // 구간이 하나도 없는데 태그/메모만 있으면 메모 전용 밤잠 레코드 1개 생성
      if (cleanSegments.length === 0 && (trimmedMemo || tags.length > 0)) {
        await createRecord({
          date: recordDate,
          sleep_type: 'night',
          bedtime: null,
          wake_time: null,
          tags,
          memo: trimmedMemo || null,
        });
      }

      // 낮잠
      for (const nap of cleanNaps) {
        await createRecord({
          date: recordDate,
          sleep_type: 'nap',
          bedtime: nap.bedtime || null,
          wake_time: nap.wake_time || null,
        });
      }

      // 중간기상
      for (const time of cleanMidWakes) {
        await createEvent({ date: recordDate, event_time: time });
      }

      onSubmitDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 날짜 */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">날짜</label>
        <input
          type="date"
          value={recordDate}
          onChange={(e) => setRecordDate(e.target.value)}
          className={`${FIELD} w-full`}
        />
      </div>

      {/* 밤잠 구간 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">
            밤잠 구간 <span className="text-gray-400">(취침 ~ 기상)</span>
          </label>
          <button
            type="button"
            onClick={() => setSegments((r) => [...r, { bedtime: '', wake_time: '' }])}
            className="flex items-center gap-0.5 text-xs font-medium text-indigo-500 hover:text-indigo-600"
          >
            <PlusIcon size={13} /> 구간 추가
          </button>
        </div>
        <div className="space-y-2">
          {segments.length === 0 && (
            <p className="text-xs text-gray-400">밤잠 구간이 없어. 필요하면 추가하자</p>
          )}
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                value={seg.bedtime}
                onChange={(e) => updatePair(setSegments, i, 'bedtime', e.target.value)}
                className={FIELD}
                aria-label={`밤잠 ${i + 1} 취침 시각`}
              />
              <span className="text-gray-400">~</span>
              <input
                type="time"
                value={seg.wake_time}
                onChange={(e) => updatePair(setSegments, i, 'wake_time', e.target.value)}
                className={FIELD}
                aria-label={`밤잠 ${i + 1} 기상 시각`}
              />
              <button
                type="button"
                onClick={() => setSegments((r) => r.filter((_, idx) => idx !== i))}
                className="ml-auto rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                aria-label={`밤잠 ${i + 1} 삭제`}
              >
                <TrashIcon size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 중간기상 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">중간기상</label>
          <button
            type="button"
            onClick={() => setMidWakes((r) => [...r, ''])}
            className="flex items-center gap-0.5 text-xs font-medium text-indigo-500 hover:text-indigo-600"
          >
            <PlusIcon size={13} /> 추가
          </button>
        </div>
        {midWakes.length === 0 ? (
          <p className="text-xs text-gray-400">중간에 깬 적 없으면 비워둬</p>
        ) : (
          <div className="space-y-2">
            {midWakes.map((time, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="time"
                  value={time}
                  onChange={(e) =>
                    setMidWakes((r) => r.map((t, idx) => (idx === i ? e.target.value : t)))
                  }
                  className={FIELD}
                  aria-label={`중간기상 ${i + 1} 시각`}
                />
                <button
                  type="button"
                  onClick={() => setMidWakes((r) => r.filter((_, idx) => idx !== i))}
                  className="ml-auto rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                  aria-label={`중간기상 ${i + 1} 삭제`}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 낮잠 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">낮잠</label>
          <button
            type="button"
            onClick={() => setNaps((r) => [...r, { bedtime: '', wake_time: '' }])}
            className="flex items-center gap-0.5 text-xs font-medium text-indigo-500 hover:text-indigo-600"
          >
            <PlusIcon size={13} /> 추가
          </button>
        </div>
        {naps.length === 0 ? (
          <p className="text-xs text-gray-400">낮잠 잤으면 추가하자</p>
        ) : (
          <div className="space-y-2">
            {naps.map((nap, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="time"
                  value={nap.bedtime}
                  onChange={(e) => updatePair(setNaps, i, 'bedtime', e.target.value)}
                  className={FIELD}
                  aria-label={`낮잠 ${i + 1} 시작 시각`}
                />
                <span className="text-gray-400">~</span>
                <input
                  type="time"
                  value={nap.wake_time}
                  onChange={(e) => updatePair(setNaps, i, 'wake_time', e.target.value)}
                  className={FIELD}
                  aria-label={`낮잠 ${i + 1} 종료 시각`}
                />
                <button
                  type="button"
                  onClick={() => setNaps((r) => r.filter((_, idx) => idx !== i))}
                  className="ml-auto rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                  aria-label={`낮잠 ${i + 1} 삭제`}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 특이사항 태그 */}
      <section>
        <label className="mb-2 block text-xs font-medium text-gray-600">특이사항</label>
        <div className="flex flex-wrap gap-1.5">
          {SLEEP_TAGS.map((tag) => {
            const selected = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  selected
                    ? 'bg-indigo-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </section>

      {/* 메모 */}
      <section>
        <label className="mb-1 block text-xs font-medium text-gray-600">메모</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          placeholder="특이사항이나 남기고 싶은 메모"
          className={`${FIELD} w-full resize-none`}
        />
      </section>

      {error && (
        <div className="flex items-center gap-1 text-xs text-red-500">
          <XMarkIcon size={13} />
          {error}
        </div>
      )}

      {/* 버튼 */}
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-100"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading || !hasContent}
          className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50"
        >
          {loading ? '저장 중...' : isEdit ? '수정' : '저장'}
        </button>
      </div>
    </div>
  );
}
