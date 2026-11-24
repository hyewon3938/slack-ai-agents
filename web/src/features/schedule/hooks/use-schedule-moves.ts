'use client';

/** 일정 날짜 이동과 되돌리기, 그 결과를 알리는 토스트를 관리한다. */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { format, addDays } from 'date-fns';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import {
  formatRangeLabel,
  isSameRange,
  UNDO_LIMIT,
  type DateRange,
  type MoveEntry,
} from '@/features/schedule/lib/date-move';
import { sendJson } from '@/lib/send-json';

/** 이동·되돌리기 결과를 알리는 토스트 내용 */
export interface MoveToastState {
  kind: 'moved' | 'undone';
  title: string;
  label: string;
  /** 같은 문구가 연달아 떠도 타이머를 새로 시작하기 위한 값 */
  key: number;
}

const TOAST_DURATION_MS = 5_000;

interface ScheduleMovesDeps {
  schedules: ScheduleRow[];
  setSchedules: Dispatch<SetStateAction<ScheduleRow[]>>;
  /** 저장 요청이 진행 중인 수. 0보다 크면 폴링 결과로 목록을 덮어쓰지 않는다 */
  mutatingRef: { current: number };
  fetchData: () => Promise<void>;
}

export function useScheduleMoves({
  schedules,
  setSchedules,
  mutatingRef,
  fetchData,
}: ScheduleMovesDeps) {
  const [toast, setToast] = useState<MoveToastState | null>(null);
  // 되돌리기 기록 — 최근 이동이 배열 끝
  const undoStackRef = useRef<MoveEntry[]>([]);
  const schedulesRef = useRef(schedules);

  useEffect(() => {
    schedulesRef.current = schedules;
  }, [schedules]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  /** 날짜 범위를 화면에 먼저 반영하고 PATCH 1회로 저장한다. 저장 성공 여부를 돌려준다 */
  const applyRange = useCallback(
    async (id: number, range: DateRange): Promise<boolean> => {
      setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...range } : s)));
      mutatingRef.current++;
      try {
        const res = await sendJson(`/api/schedules/${id}`, 'PATCH', range);
        return res.ok;
      } catch {
        return false;
      } finally {
        mutatingRef.current--;
      }
    },
    [setSchedules, mutatingRef],
  );

  const showToast = useCallback((kind: MoveToastState['kind'], title: string, range: DateRange) => {
    setToast({ kind, title, label: formatRangeLabel(range), key: Date.now() });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  /** 드래그·하루 미루기·백로그 이동이 함께 쓰는 경로. 저장에 성공하면 되돌리기 기록에 쌓는다 */
  const handleMove = async (id: number, next: DateRange) => {
    const schedule = schedules.find((s) => s.id === id);
    if (!schedule) return;
    const before: DateRange = { date: schedule.date, end_date: schedule.end_date };
    if (isSameRange(before, next)) return;

    if (!(await applyRange(id, next))) {
      setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...before } : s)));
      alert('일정 이동에 실패했어');
      return;
    }
    undoStackRef.current = [
      ...undoStackRef.current,
      { id, title: schedule.title, before, after: next },
    ].slice(-UNDO_LIMIT);
    showToast('moved', schedule.title, next);
  };

  /** 마지막 이동을 되돌린다. 되돌릴 기록이 없으면 false */
  const undoLastMove = useCallback((): boolean => {
    const entry = undoStackRef.current.pop();
    if (!entry) return false;
    const isLoaded = schedulesRef.current.some((s) => s.id === entry.id);

    void applyRange(entry.id, entry.before).then((ok) => {
      if (!ok) {
        undoStackRef.current.push(entry);
        setSchedules((prev) => prev.map((s) => (s.id === entry.id ? { ...s, ...entry.after } : s)));
        alert('되돌리기에 실패했어');
        return;
      }
      showToast('undone', entry.title, entry.before);
      // 조회 범위 밖으로 나가 목록에서 빠졌던 일정은 다시 불러와야 화면에 보인다
      if (!isLoaded) void fetchData();
    });
    return true;
  }, [applyRange, showToast, fetchData, setSchedules]);

  const handlePostpone = async (id: number) => {
    const schedule = schedules.find((s) => s.id === id);
    if (!schedule?.date) return;
    const next = format(addDays(new Date(schedule.date + 'T12:00:00'), 1), 'yyyy-MM-dd');
    await handleMove(id, { date: next, end_date: null });
  };

  const handleMoveToBacklog = (id: number) => handleMove(id, { date: null, end_date: null });

  return { toast, dismissToast, handleMove, undoLastMove, handlePostpone, handleMoveToBacklog };
}
