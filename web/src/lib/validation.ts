/** API 입력 문자열 길이 제한 */
export const MAX_LENGTHS = {
  title: 100,
  name: 100,
  description: 200,
  memo: 500,
  category: 50,
  subcategory: 50,
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
export const validateStringLength = (
  value: unknown,
  field: FieldName,
): string | null => {
  if (typeof value !== 'string') return null; // optional 필드는 통과
  const max = MAX_LENGTHS[field];
  if (value.length > max) {
    return `${field}은(는) ${max}자 이하여야 합니다 (현재 ${value.length}자)`;
  }
  return null;
};

/**
 * 여러 필드를 한번에 검증.
 * 첫 번째 에러 메시지 반환, 모두 통과 시 null.
 */
export const validateFields = (
  fields: Array<[unknown, FieldName]>,
): string | null => {
  for (const [value, field] of fields) {
    const error = validateStringLength(value, field);
    if (error) return error;
  }
  return null;
};
