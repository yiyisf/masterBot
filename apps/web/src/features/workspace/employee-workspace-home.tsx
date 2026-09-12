'use client';

import { createContractClient } from '@cmaster/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { resolveLocale, resolveTheme } from './preferences';
import { useWorkspacePreferences } from './workspace-providers';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '';
const client = createContractClient(apiUrl);

const copy = {
  'zh-CN': {
    eyebrow: '员工工作区', title: '继续最近的工作', description: 'Conversation 会保存完整消息和工作结果。',
    conversations: '最近的 Conversation', active: '进行中', pending: '待处理', emptyTitle: '还没有 Conversation',
    emptyBody: '首次发送消息时会创建一个 Conversation。', artifact: '包含一个工作产出', noMessages: '尚无消息',
    untitled: '未命名 Conversation', loadError: '暂时无法读取工作区。请稍后重试。', language: '语言', theme: '主题',
    newConversation: '新建 Conversation', system: '跟随系统', light: '浅色', dark: '深色',
    preferences: '工作区偏好', activity: '工作区活动', loading: '正在加载', statuses: { accepted: '已接受', queued: '排队中', running: '进行中', waiting: '等待处理', succeeded: '已完成', failed: '失败', cancelled: '已取消' },
  },
  'en-US': {
    eyebrow: 'Employee Workspace', title: 'Continue recent work', description: 'Conversations keep the complete message and work history.',
    conversations: 'Recent conversations', active: 'Active', pending: 'Pending', emptyTitle: 'No conversations yet',
    emptyBody: 'A conversation is created when you send your first message.', artifact: 'Contains a work output', noMessages: 'No messages yet',
    untitled: 'Untitled conversation', loadError: 'The workspace is unavailable right now. Try again shortly.', language: 'Language', theme: 'Theme',
    newConversation: 'New conversation', system: 'System', light: 'Light', dark: 'Dark',
    preferences: 'Workspace preferences', activity: 'Workspace activity', loading: 'Loading', statuses: { accepted: 'Accepted', queued: 'Queued', running: 'Active', waiting: 'Waiting', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled' },
  },
} as const;

export function EmployeeWorkspaceHome() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { locale, setLocale, theme, setTheme } = useWorkspacePreferences();
  const text = copy[locale];
  const numberFormatter = new Intl.NumberFormat(locale);
  const summary = useQuery({
    queryKey: ['workspace', 'summary'],
    queryFn: async () => {
      const result = await client.GET('/api/v1/workspace/summary');
      if (!result.data) throw new Error('workspace_summary_unavailable');
      return result.data;
    },
  });
  const conversations = useQuery({
    queryKey: ['workspace', 'conversations', 'recent'],
    queryFn: async () => {
      const result = await client.GET('/api/v1/workspace/conversations', {
        params: { query: { limit: 20 } },
      });
      if (!result.data) throw new Error('workspace_conversations_unavailable');
      return result.data;
    },
  });

  const failed = summary.isError || conversations.isError;
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1 ref={headingRef} tabIndex={-1}>{text.title}</h1>
          <p>{text.description}</p>
          <Link className="button" href="/workspace/conversations/new">{text.newConversation}</Link>
        </div>
        <div className="workspace-preferences" aria-label={text.preferences}>
          <label>{text.language}
            <select value={locale} onChange={(event) => setLocale(resolveLocale(event.target.value, 'en-US'))}>
              <option value="zh-CN">中文</option><option value="en-US">English</option>
            </select>
          </label>
          <label>{text.theme}
            <select value={theme} onChange={(event) => setTheme(resolveTheme(event.target.value))}>
              <option value="system">{text.system}</option><option value="light">{text.light}</option><option value="dark">{text.dark}</option>
            </select>
          </label>
        </div>
      </header>

      <main className="workspace-home">
        <section className="workspace-stat-grid" aria-label={text.activity}>
          <article><strong>{numberFormatter.format(summary.data?.activeRunCount ?? 0)}</strong><span>{text.active}</span></article>
          <article><strong>{numberFormatter.format(summary.data?.pendingActionCount ?? 0)}</strong>
            <Link href="/workspace/pending">{text.pending}</Link></article>
        </section>
        <section aria-labelledby="recent-conversations-title">
          <h2 id="recent-conversations-title">{text.conversations}</h2>
          {failed ? <p className="error" role="alert">{text.loadError}</p> : null}
          {!failed && conversations.isPending ? (
            <div className="workspace-loading" aria-label={text.loading} />
          ) : null}
          {!failed && conversations.data?.items.length === 0 ? (
            <div className="workspace-empty" role="status">
              <h3>{text.emptyTitle}</h3><p>{text.emptyBody}</p>
            </div>
          ) : null}
          <div className="conversation-list">
            {conversations.data?.items.map((conversation) => (
              <article className="conversation-summary" key={conversation.id}>
                <div>
                  <h3><Link href={`/workspace/conversations/${conversation.id}`}>{conversation.title ?? text.untitled}</Link></h3>
                  <p>{conversation.preview.kind === 'text' ? conversation.preview.text
                    : conversation.preview.kind === 'artifact' ? text.artifact : text.noMessages}</p>
                </div>
                <div className="conversation-meta">
                  <time dateTime={conversation.updatedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(conversation.updatedAt))}</time>
                  {conversation.activity.latestRunStatus ? <span className="status-pill">{text.statuses[conversation.activity.latestRunStatus]}</span> : null}
                  {conversation.activity.pendingActionCount > 0 ? (
                    <span>{text.pending}: {numberFormatter.format(
                      conversation.activity.pendingActionCount,
                    )}</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
