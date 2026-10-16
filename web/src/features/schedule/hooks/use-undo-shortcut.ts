'use client';

import { useEffect } from 'react';

type ShortcutKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** Ctrl+Z 또는 macOS의 Cmd+Z. Shift가 붙은 다시 실행 조합은 제외 */
export function isUndoShortcut(e: ShortcutKey): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';
}

/** 텍스트를 입력하는 곳에서는 브라우저 기본 되돌리기를 그대로 둔다 */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * 페이지 전체에서 되돌리기 단축키를 받는다.
 * 입력칸에 포커스가 있거나 모달이 열려 있으면 동작하지 않는다.
 * onUndo는 되돌릴 기록이 있었는지를 돌려준다.
 */
export function useUndoShortcut(onUndo: () => boolean): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!isUndoShortcut(e) || e.repeat) return;
      if (isTextInput(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      if (onUndo()) e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return (): void => window.removeEventListener('keydown', handler);
  }, [onUndo]);
}
