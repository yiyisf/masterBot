import type { MessageContract } from '@cmaster/contracts';
import Link from 'next/link';
import { memo, useMemo } from 'react';
import { ArtifactCard } from '../artifacts/artifact-card';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '';

interface RunAttemptViewModel {
  readonly id: string;
  readonly triggerMessageId: string;
  readonly status: 'accepted' | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
  readonly retryable: boolean;
  readonly createdAt: string;
}

interface ConversationThreadCommands {
  readonly loadOlder: () => void;
  readonly loadOlderRuns: () => void;
  readonly showNewContent: () => void;
  readonly runAgain: (messageId: string) => void;
}

const copy = {
  'zh-CN': {
    older: '加载更早的 Messages', olderRuns: '加载更早的 Run 尝试', newContent: '显示新内容', attempts: 'Run 尝试', runAgain: '再次运行', continueAttempt: '继续创建 Run 尝试',
    employee: 'Employee', assistant: 'CMaster', artifact: 'Artifact', messagesLabel: 'Conversation Messages',
    statuses: { accepted: '已接受', queued: '排队中', running: '进行中', waiting: '等待处理', succeeded: '已完成', failed: '失败', cancelled: '已取消' },
  },
  'en-US': {
    older: 'Load older messages', olderRuns: 'Load older run attempts', newContent: 'Show new content', attempts: 'Run attempts', runAgain: 'Run again', continueAttempt: 'Continue creating run attempt',
    employee: 'Employee', assistant: 'CMaster', artifact: 'Artifact', messagesLabel: 'Conversation messages',
    statuses: { accepted: 'Accepted', queued: 'Queued', running: 'Active', waiting: 'Waiting', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled' },
  },
} as const;

const noRunAttempts: readonly RunAttemptViewModel[] = [];

const ConversationMessageRow = memo(function ConversationMessageRow({
  conversationId,
  locale,
  message,
  attempts,
  canRunAgain,
  recoveringRunMessageId,
  selectedRunId,
  runAgain,
}: Readonly<{
  conversationId: string;
  locale: keyof typeof copy;
  message: MessageContract;
  attempts: readonly RunAttemptViewModel[];
  canRunAgain: boolean;
  recoveringRunMessageId?: string;
  selectedRunId?: string;
  runAgain: (messageId: string) => void;
}>) {
  const text = copy[locale];
  return (
    <article className="message" data-message-sequence={message.sequence}>
      <strong>{message.author === 'employee' ? text.employee : text.assistant}</strong>
      {message.parts.map((part, index) => part.type === 'text'
        ? <p key={`${message.id}-text-${index}`}>{part.text}</p>
        : <ArtifactCard key={part.artifactVersionId} apiUrl={apiUrl}
            artifactId={part.artifactId} artifactVersionId={part.artifactVersionId}
            locale={locale} />)}
      {attempts.length > 0 ? (
        <section aria-label={`${text.attempts}: ${message.sequence}`}>
          <ul className="run-attempt-list">
            {attempts.map((run) => (
              <li key={run.id} className={run.id === selectedRunId ? 'selected' : ''}>
                <Link href={`/workspace/conversations/${conversationId}/runs/${run.id}`}
                  aria-current={run.id === selectedRunId ? 'true' : undefined}>
                  Run · {text.statuses[run.status]}
                </Link>
                {run.retryable ? (
                  <button type="button" className="button secondary"
                    disabled={!canRunAgain || (recoveringRunMessageId !== undefined
                      && recoveringRunMessageId !== message.id)}
                    onClick={() => runAgain(message.id)}>
                    {recoveringRunMessageId === message.id
                      ? text.continueAttempt : text.runAgain}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
});

export function ConversationThread({
  conversationId,
  locale,
  messages,
  runs,
  canLoadOlder,
  canLoadOlderRuns,
  hasNewContent,
  canRunAgain,
  recoveringRunMessageId,
  selectedRunId,
  commands,
}: Readonly<{
  conversationId: string;
  locale: keyof typeof copy;
  messages: readonly MessageContract[];
  runs: readonly RunAttemptViewModel[];
  canLoadOlder: boolean;
  canLoadOlderRuns: boolean;
  hasNewContent: boolean;
  canRunAgain: boolean;
  recoveringRunMessageId?: string;
  selectedRunId?: string;
  commands: ConversationThreadCommands;
}>) {
  const text = copy[locale];
  const attemptsByMessage = useMemo(() => {
    const indexed = new Map<string, RunAttemptViewModel[]>();
    for (const run of runs) {
      const attempts = indexed.get(run.triggerMessageId) ?? [];
      attempts.push(run);
      indexed.set(run.triggerMessageId, attempts);
    }
    return indexed;
  }, [runs]);
  return (
    <section aria-label={text.messagesLabel}>
      {canLoadOlder ? (
        <button className="button secondary" type="button" onClick={commands.loadOlder}>
          {text.older}
        </button>
      ) : null}
      {messages.map((message) => (
        <ConversationMessageRow key={message.id}
          conversationId={conversationId}
          locale={locale}
          message={message}
          attempts={attemptsByMessage.get(message.id) ?? noRunAttempts}
          canRunAgain={canRunAgain}
          {...(recoveringRunMessageId ? { recoveringRunMessageId } : {})}
          {...(selectedRunId ? { selectedRunId } : {})}
          runAgain={commands.runAgain} />
      ))}
      {canLoadOlderRuns ? (
        <button className="button secondary" type="button" onClick={commands.loadOlderRuns}>
          {text.olderRuns}
        </button>
      ) : null}
      {hasNewContent ? (
        <button className="new-content" type="button" onClick={commands.showNewContent}>
          {text.newContent}
        </button>
      ) : null}
    </section>
  );
}
