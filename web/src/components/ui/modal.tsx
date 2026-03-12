'use client';

import { useEffect, useRef, useCallback } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** 닫기 전 확인. false 반환 시 닫기 취소 */
  onBeforeClose?: () => boolean;
}

export function Modal({ open, onClose, title, children, onBeforeClose }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const guardedClose = useCallback(() => {
    if (onBeforeClose && !onBeforeClose()) return;
    onClose();
  }, [onClose, onBeforeClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  // ESC 키로 닫을 때 가드 적용
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      guardedClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [open, guardedClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        guardedClose();
      }
    },
    [guardedClose],
  );

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 m-auto w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-xl border-0 bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      <div onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={guardedClose}
            className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </dialog>
  );
}
