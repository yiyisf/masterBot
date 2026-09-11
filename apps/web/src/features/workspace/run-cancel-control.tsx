'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

export type RunCancellationOutcome =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'tool_effect_in_flight' }
  | { readonly kind: 'too_late' };

const copy = {
  'zh-CN': {
    open: '取消 Run', title: '取消这个 Run？',
    explanation: '取消会停止后续工作，但不会撤销已经完成的 Tool effect。',
    close: '返回', confirm: '确认取消', cancelled: 'Run 已取消。已完成的 Tool effect 不会被撤销。',
    inFlight: 'Tool effect 仍在执行，当前不能取消。已刷新 Server 状态。',
    tooLate: '结果已经生成，无法取消。已刷新 Server 状态。',
    unavailable: '无法确认取消结果。已尝试刷新 Server 状态。',
  },
  'en-US': {
    open: 'Cancel run', title: 'Cancel this run?',
    explanation: 'Cancellation stops later work. It does not undo completed Tool effects.',
    close: 'Go back', confirm: 'Confirm cancellation', cancelled: 'The run was cancelled. Completed Tool effects were not undone.',
    inFlight: 'A Tool effect is still in flight, so cancellation is currently unavailable. Server state was refreshed.',
    tooLate: 'The result was already generated, so cancellation is too late. Server state was refreshed.',
    unavailable: 'The cancellation result could not be confirmed. Server state refresh was attempted.',
  },
} as const;

export function RunCancelControl({
  locale,
  cancellable,
  cancel,
  refresh,
}: Readonly<{
  locale: keyof typeof copy;
  cancellable: boolean;
  cancel: () => Promise<RunCancellationOutcome>;
  refresh: () => Promise<void>;
}>) {
  const text = copy[locale];
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const openedBefore = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();

  useEffect(() => {
    if (open) {
      openedBefore.current = true;
      closeRef.current?.focus();
    } else if (openedBefore.current) {
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (feedback) statusRef.current?.focus();
  }, [feedback]);

  function close(): void {
    if (!busy) setOpen(false);
  }

  function trapFocus(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === closeRef.current) {
      event.preventDefault();
      confirmRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
      event.preventDefault();
      closeRef.current?.focus();
    }
  }

  async function confirm(): Promise<void> {
    setBusy(true);
    setFeedback(undefined);
    let outcome: RunCancellationOutcome | undefined;
    try {
      outcome = await cancel();
    } catch {
      setFeedback(text.unavailable);
    }
    try {
      await refresh();
    } catch {
      if (!outcome) setFeedback(text.unavailable);
    }
    setBusy(false);
    if (outcome?.kind === 'cancelled') {
      setFeedback(text.cancelled);
      setOpen(false);
    } else if (outcome?.kind === 'tool_effect_in_flight') {
      setFeedback(text.inFlight);
    } else if (outcome?.kind === 'too_late') {
      setFeedback(text.tooLate);
    }
  }

  return (
    <>
      {cancellable ? (
        <button ref={triggerRef} className="button" type="button" onClick={() => setOpen(true)}>
          {text.open}
        </button>
      ) : null}
      {open ? (
        <div className="dialog-backdrop">
          <div className="cancel-dialog" role="dialog" aria-modal="true"
            aria-labelledby="cancel-dialog-title" onKeyDown={trapFocus}>
            <h2 id="cancel-dialog-title">{text.title}</h2>
            <p>{text.explanation}</p>
            <div className="pending-actions">
              <button ref={closeRef} className="button secondary" type="button"
                disabled={busy} onClick={close}>{text.close}</button>
              <button ref={confirmRef} className="button" type="button"
                disabled={busy} onClick={() => void confirm()}>{text.confirm}</button>
            </div>
            {feedback ? <p ref={statusRef} role="status" tabIndex={-1}>{feedback}</p> : null}
          </div>
        </div>
      ) : feedback ? <p ref={statusRef} role="status" tabIndex={-1}>{feedback}</p> : null}
    </>
  );
}
