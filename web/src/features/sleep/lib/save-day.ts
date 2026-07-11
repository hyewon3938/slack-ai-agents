import type { DailySleep, SleepRecordInput } from './types';

/** 폼에서 내려받는 mutation 묶음 (성공 시 resolve, 실패 시 reject) */
export interface SleepDayMutations {
  createRecord: (input: SleepRecordInput) => Promise<void>;
  updateRecord: (id: number, input: SleepRecordInput) => Promise<void>;
  deleteRecord: (id: number) => Promise<void>;
  createEvent: (input: { date: string; event_time: string }) => Promise<void>;
  deleteEvent: (id: number) => Promise<void>;
}

/** 하루치 수면의 원하는 최종 상태 (duration은 서버 계산이라 미포함) */
export interface SleepDayDraft {
  date: string;
  /** 밤잠 구간 payload (태그·메모는 첫 구간에 탑재된 상태) */
  nightPayloads: SleepRecordInput[];
  napPayloads: SleepRecordInput[];
  midWakeTimes: string[];
}

/**
 * 폼 payload를 기존 레코드 id에 위치 매칭 — 남으면 UPDATE, 넘치면 INSERT,
 * 모자라는 기존 id는 삭제 대상(deleteBucket)에 담기만 한다(여기서 삭제하지 않음).
 */
async function reconcileRecords(
  payloads: SleepRecordInput[],
  existingIds: number[],
  m: SleepDayMutations,
  deleteBucket: number[],
): Promise<void> {
  const count = Math.max(payloads.length, existingIds.length);
  for (let i = 0; i < count; i++) {
    const payload = payloads[i];
    const id = existingIds[i];
    if (payload && id !== undefined) await m.updateRecord(id, payload);
    else if (payload) await m.createRecord(payload);
    else if (id !== undefined) deleteBucket.push(id);
  }
}

/**
 * 하루치 수면 기록 저장.
 *
 * - `existing === null` → 추가 모드: draft를 전부 생성.
 * - `existing` 있음 → 편집 모드: 제자리 재조정. 기존 레코드를 UPDATE하고,
 *   폼에서 사라진 레코드만 삭제 대상에 담아 **모든 upsert가 성공한 뒤 맨 마지막에만** 삭제한다.
 *
 * 핵심 불변식(#598): 파괴적 DELETE는 upsert가 전부 끝난 뒤에만 실행된다.
 * 어떤 upsert가 실패하면 그 지점에서 throw되어 삭제 단계에 도달하지 못하므로,
 * 편집이 실패해도 기존 데이터가 유실되지 않는다. (기존 replace-day는 먼저 전부
 * 삭제하고 재생성해서, 재생성 실패 시 데이터가 영구 소실됐다.)
 */
export async function saveSleepDay(
  existing: DailySleep | null,
  draft: SleepDayDraft,
  m: SleepDayMutations,
): Promise<void> {
  if (!existing) {
    for (const payload of draft.nightPayloads) await m.createRecord(payload);
    for (const payload of draft.napPayloads) await m.createRecord(payload);
    for (const time of draft.midWakeTimes) {
      await m.createEvent({ date: draft.date, event_time: time });
    }
    return;
  }

  const existingNightIds = [...existing.nightSegments, ...existing.nightMemoRecords].map(
    (r) => r.id,
  );
  const existingNapIds = [...existing.morningSleeps, ...existing.afternoonNaps].map((r) => r.id);
  const recordsToDelete: number[] = [];

  // 1) 비파괴 upsert 먼저 — 하나라도 실패하면 여기서 throw (삭제 단계 도달 X)
  await reconcileRecords(draft.nightPayloads, existingNightIds, m, recordsToDelete);
  await reconcileRecords(draft.napPayloads, existingNapIds, m, recordsToDelete);
  // 중간기상은 UPDATE 개념이 없어 생성(비파괴)부터, 기존 삭제는 뒤로 미룬다
  for (const time of draft.midWakeTimes) {
    await m.createEvent({ date: draft.date, event_time: time });
  }

  // 2) 여기 도달 = 모든 upsert 성공 → 이제서야 파괴적 삭제
  for (const id of recordsToDelete) await m.deleteRecord(id);
  for (const e of existing.nightEvents) await m.deleteEvent(e.id);
}
