'use client';

import { createContractClient } from '@cmaster/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useWorkspacePreferences } from './workspace-providers';

const client = createContractClient(process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '');
const activeStatuses = new Set(['accepted', 'queued', 'running', 'waiting']);
const copy = {
  'zh-CN': {
    back: '返回工作区', untitled: '未命名 Conversation', loading: '正在读取 Conversation…', failed: '无法读取这个 Conversation。',
    messages: 'Messages', runs: 'Run 尝试', noRuns: '这个 Message 尚未运行。',
    composerBlocked: '当前有 Run 正在处理。完成或取消后才能继续发送。', composerLater: '继续 Conversation 将在下一步开放。',
    statuses: { accepted: '已接受', queued: '排队中', running: '进行中', waiting: '等待处理', succeeded: '已完成', failed: '失败', cancelled: '已取消' },
  },
  'en-US': {
    back: 'Back to workspace', untitled: 'Untitled conversation', loading: 'Loading conversation…', failed: 'This conversation could not be loaded.',
    messages: 'Messages', runs: 'Run attempts', noRuns: 'This message has not been run yet.',
    composerBlocked: 'A run is active. Wait for it to finish or cancel it before sending another message.', composerLater: 'Continuing this conversation will be available in the next step.',
    statuses: { accepted: 'Accepted', queued: 'Queued', running: 'Active', waiting: 'Waiting', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled' },
  },
} as const;

export function ConversationOverview({ conversationId }: Readonly<{ conversationId: string }>) {
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const search = useSearchParams();
  const selectedRunId = search.get('run');
  const conversation = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const result = await client.GET('/api/v1/conversations/{conversationId}', {
        params: { path: { conversationId } },
      });
      if (!result.data) throw new Error('conversation_unavailable');
      return result.data;
    },
  });
  const messages = useQuery({
    queryKey: ['conversation', conversationId, 'messages'],
    queryFn: async () => {
      const result = await client.GET('/api/v1/conversations/{conversationId}/messages', {
        params: { path: { conversationId }, query: { afterSequence: 0, limit: 200 } },
      });
      if (!result.data) throw new Error('messages_unavailable');
      return result.data;
    },
  });
  const runs = useQuery({
    queryKey: ['conversation', conversationId, 'runs'],
    queryFn: async () => {
      const result = await client.GET('/api/v1/conversations/{conversationId}/runs', {
        params: { path: { conversationId } },
      });
      if (!result.data) throw new Error('runs_unavailable');
      return result.data;
    },
    refetchInterval: (query) => query.state.data?.items.some((run) => activeStatuses.has(run.status))
      ? 2_000 : false,
  });
  const failed = conversation.isError || messages.isError || runs.isError;
  const hasActiveRun = runs.data?.items.some((run) => activeStatuses.has(run.status)) ?? false;

  return (
    <main className="conversation-overview">
      <Link href="/workspace" className="workspace-back">← {text.back}</Link>
      {failed ? <p className="error" role="alert">{text.failed}</p> : null}
      {!failed && conversation.isPending ? <p role="status">{text.loading}</p> : null}
      {conversation.data ? <h1>{conversation.data.title ?? text.untitled}</h1> : null}
      <section aria-labelledby="conversation-messages-title">
        <h2 id="conversation-messages-title">{text.messages}</h2>
        {messages.data?.items.map((message) => (
          <article className="message" key={message.id}>
            <strong>{message.author === 'employee' ? 'Employee' : 'CMaster'}</strong>
            {message.parts.map((part, index) => part.type === 'text'
              ? <p key={`${message.id}-text-${index}`}>{part.text}</p>
              : <p key={part.artifactVersionId}>Artifact {part.artifactVersionId}</p>)}
          </article>
        ))}
      </section>
      <section aria-labelledby="conversation-runs-title">
        <h2 id="conversation-runs-title">{text.runs}</h2>
        {runs.data?.items.length === 0 ? <p>{text.noRuns}</p> : null}
        <ol className="run-attempt-list">
          {runs.data?.items.map((run) => (
            <li className={run.id === selectedRunId ? 'selected' : ''} key={run.id}>
              <span>{text.statuses[run.status]}</span>
              <time dateTime={run.createdAt}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(run.createdAt))}</time>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="Composer">
        <textarea disabled aria-describedby="conversation-composer-reason" />
        <p id="conversation-composer-reason">{hasActiveRun ? text.composerBlocked : text.composerLater}</p>
      </section>
    </main>
  );
}
