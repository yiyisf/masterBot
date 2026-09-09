import type { MessageContract } from '@cmaster/contracts';
import Link from 'next/link';

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
    employee: 'Employee', assistant: 'CMaster', artifact: 'Artifact',
    statuses: { accepted: '已接受', queued: '排队中', running: '进行中', waiting: '等待处理', succeeded: '已完成', failed: '失败', cancelled: '已取消' },
  },
  'en-US': {
    older: 'Load older messages', olderRuns: 'Load older run attempts', newContent: 'Show new content', attempts: 'Run attempts', runAgain: 'Run again', continueAttempt: 'Continue creating run attempt',
    employee: 'Employee', assistant: 'CMaster', artifact: 'Artifact',
    statuses: { accepted: 'Accepted', queued: 'Queued', running: 'Active', waiting: 'Waiting', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled' },
  },
} as const;

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
  return (
    <section aria-label="Conversation messages">
      {canLoadOlder ? (
        <button className="button secondary" type="button" onClick={commands.loadOlder}>
          {text.older}
        </button>
      ) : null}
      {messages.map((message) => {
        const attempts = runs.filter((run) => run.triggerMessageId === message.id);
        return (
          <article className="message" key={message.id} data-message-sequence={message.sequence}>
            <strong>{message.author === 'employee' ? text.employee : text.assistant}</strong>
            {message.parts.map((part, index) => part.type === 'text'
              ? <p key={`${message.id}-text-${index}`}>{part.text}</p>
              : <p key={part.artifactVersionId}>{text.artifact} {part.artifactVersionId}</p>)}
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
                          onClick={() => commands.runAgain(message.id)}>
                          {recoveringRunMessageId === message.id ? text.continueAttempt : text.runAgain}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>
        );
      })}
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
