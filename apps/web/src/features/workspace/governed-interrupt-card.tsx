'use client';

import type { PendingInterruptContract } from '@cmaster/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PendingResolutionResult, PendingResponse } from './pending-resolution';

const copy = {
  'zh-CN': {
    confirmation: 'Employee Confirmation',
    confirmationDescription: '这是对不可变 Approval Subject 的一次确认或拒绝；不能修改参数或授予长期权限。',
    outcome: '不确定 Tool 结果复核',
    outcomeDescription: '继续只表示接受当前不确定性；不会重试原 ToolCall，也不会把结果改写为成功或失败。',
    confirm: '仅确认本次', reject: '拒绝', continue: '带着不确定性继续', open: '打开 Run 上下文',
    stillPending: 'Server 显示此事项仍待处理。可以重试同一个决定。',
    handled: '事项已由 Server 处理，当前状态已刷新。',
    inProgress: '先前的决定结果仍未确定。只能恢复同一个决定。',
    unavailable: '暂时无法确认当前状态。请稍后重试。',
    confirmed: '确认决定已记录；Run 正在恢复。', rejected: '拒绝决定已记录；Run 正在恢复。',
  },
  'en-US': {
    confirmation: 'Employee confirmation',
    confirmationDescription: 'This is one confirmation or rejection of an immutable Approval Subject. Parameters cannot be edited and no reusable permission is granted.',
    outcome: 'Uncertain tool outcome review',
    outcomeDescription: 'Continuing accepts the current uncertainty. It does not retry the original ToolCall or relabel the effect as success or failure.',
    confirm: 'Confirm once', reject: 'Reject', continue: 'Continue with uncertainty', open: 'Open run context',
    stillPending: 'The server still shows this item as pending. You can retry the same decision.',
    handled: 'The server has already handled this item. Current state was refreshed.',
    inProgress: 'The result of the earlier decision is still unknown. Only that same decision can be recovered.',
    unavailable: 'Current state could not be confirmed. Try again shortly.',
    confirmed: 'The confirmation was recorded and the run is resuming.',
    rejected: 'The rejection was recorded and the run is resuming.',
  },
} as const;

interface GovernedInterruptReference {
  readonly conversationId: string;
  readonly runId: string;
  readonly interruptId: string;
}

export type GovernedInterruptViewModel = PendingInterruptContract | (
  GovernedInterruptReference & (
    | {
        readonly kind: 'employee_confirmation';
        readonly allowedResponses: readonly ('confirm' | 'reject')[];
        readonly decisionStatus?: 'pending' | 'confirmed' | 'rejected';
        readonly approvalSubject: {
          readonly title: string;
          readonly details: Readonly<Record<string, string>>;
        };
      }
    | {
        readonly kind: 'uncertain_tool_outcome_review';
        readonly allowedResponses: readonly 'continue_with_uncertainty'[];
        readonly subject: {
          readonly title: string;
          readonly details: Readonly<Record<string, string>>;
        };
      }
  )
);

export function GovernedInterruptCard({
  item,
  locale,
  resolve,
}: Readonly<{
  item: GovernedInterruptViewModel;
  locale: keyof typeof copy;
  resolve: (response: PendingResponse) => Promise<PendingResolutionResult>;
}>) {
  const text = copy[locale];
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();

  useEffect(() => {
    if (feedback) statusRef.current?.focus();
  }, [feedback]);

  async function decide(response: PendingResponse): Promise<void> {
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await resolve(response);
      setFeedback(result.kind === 'handled' ? text.handled
        : result.kind === 'still_pending' ? text.stillPending : text.inProgress);
    } catch {
      setFeedback(text.unavailable);
    } finally {
      setBusy(false);
    }
  }

  const subject = item.kind === 'employee_confirmation' ? item.approvalSubject : item.subject;
  return (
    <article className="pending-card">
      <p className="status-pill">{item.kind === 'employee_confirmation'
        ? text.confirmation : text.outcome}</p>
      <h2>{item.kind === 'employee_confirmation' ? text.confirmation : text.outcome}</h2>
      <p>{item.kind === 'employee_confirmation'
        ? text.confirmationDescription : text.outcomeDescription}</p>
      {item.kind === 'employee_confirmation' && item.decisionStatus !== undefined
        && item.decisionStatus !== 'pending'
        ? <p role="status">{text[item.decisionStatus]}</p> : null}
      <h3>{subject.title}</h3>
      {Object.keys(subject.details).length > 0 ? (
        <dl>{Object.entries(subject.details).map(([key, value]) => (
          <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
        ))}</dl>
      ) : null}
      <p><Link href={`/workspace/conversations/${item.conversationId}/runs/${item.runId}`}>
        {text.open}
      </Link></p>
      <div className="pending-actions">
        {item.kind === 'employee_confirmation' ? (
          <>
            {item.allowedResponses.includes('confirm') ? (
              <button className="button" disabled={busy}
                onClick={() => void decide('confirm')}>{text.confirm}</button>
            ) : null}
            {item.allowedResponses.includes('reject') ? (
              <button className="button secondary" disabled={busy}
                onClick={() => void decide('reject')}>{text.reject}</button>
            ) : null}
          </>
        ) : item.allowedResponses.includes('continue_with_uncertainty') ? (
          <button className="button" disabled={busy}
            onClick={() => void decide('continue_with_uncertainty')}>{text.continue}</button>
        ) : null}
      </div>
      {feedback ? <p ref={statusRef} role="status" tabIndex={-1}>{feedback}</p> : null}
    </article>
  );
}
