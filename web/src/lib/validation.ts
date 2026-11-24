/** API 입력 문자열 길이 제한 */
export const MAX_LENGTHS = {
  title: 100,
  name: 100,
  description: 200,
  memo: 500,
  reason: 300,
  category: 50,
  color: 7,
  paymentMethod: 50,
  timeSlot: 50,
  frequency: 30,
} as const;

type FieldName = keyof typeof MAX_LENGTHS;

/**
 * 문자열 필드 길이 검증.
 * 초과 시 에러 메시지 반환, 통과 시 null.
 */
export const validateStringLength = (value: unknown, field: FieldName): string | null => {
  if (typeof value !== 'string') return null; // optional 필드는 통과
  const max = MAX_LENGTHS[field];
  if (value.length > max) {
    return `${field}은(는) ${max}자 이하여야 합니다 (현재 ${value.length}자)`;
  }
  return null;
};

/**
 * 동적 route의 id 세그먼트를 양의 정수로 바꾼다.
 * 숫자가 아니거나(NaN), 소수·0·음수면 null.
 */
export const parseRouteId = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** 양의 정수 id인지 (body로 받은 외래 키 검증용) */
export const isPositiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** YYYY-MM-DD 형식 날짜 문자열인지 */
export const isISODate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * 여러 필드를 한번에 검증.
 * 첫 번째 에러 메시지 반환, 모두 통과 시 null.
 */
export const validateFields = (fields: Array<[unknown, FieldName]>): string | null => {
  for (const [value, field] of fields) {
    const error = validateStringLength(value, field);
    if (error) return error;
  }
  return null;
};
