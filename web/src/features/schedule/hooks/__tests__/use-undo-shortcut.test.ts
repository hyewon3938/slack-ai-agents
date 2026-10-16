import { describe, it, expect } from 'vitest';
import { isUndoShortcut } from '../use-undo-shortcut';

const key = (
  overrides: Partial<Parameters<typeof isUndoShortcut>[0]> = {},
): Parameters<typeof isUndoShortcut>[0] => ({
  key: 'z',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe('isUndoShortcut', () => {
  it('Ctrl+Z를 되돌리기로 인식한다', () => {
    expect(isUndoShortcut(key({ ctrlKey: true }))).toBe(true);
  });

  it('macOS의 Cmd+Z를 되돌리기로 인식한다', () => {
    expect(isUndoShortcut(key({ metaKey: true }))).toBe(true);
  });

  it('Caps Lock으로 대문자 Z가 들어와도 인식한다', () => {
    expect(isUndoShortcut(key({ key: 'Z', ctrlKey: true }))).toBe(true);
  });

  it('Shift가 붙은 다시 실행 조합은 제외한다', () => {
    expect(isUndoShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('수정 키 없이 Z만 누르면 무시한다', () => {
    expect(isUndoShortcut(key())).toBe(false);
  });

  it('다른 키 조합은 무시한다', () => {
    expect(isUndoShortcut(key({ key: 'y', ctrlKey: true }))).toBe(false);
  });
});
