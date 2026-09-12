'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GovernedInterruptCard } from './governed-interrupt-card';
import { createPendingBrowserApi } from './pending-browser-api';
import {
  PendingResolutionCoordinator,
  createSessionPendingOperationStore,
  type PendingResponse,
  type ResolvableInterrupt,
} from './pending-resolution';
import { createRunUiBrowserApi } from './run-ui-browser-api';
import { useWorkspacePreferences } from './workspace-providers';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '';
const copy = {
  'zh-CN': {
    back: '返回 Workspace', eyebrow: '待处理', title: '需要你的处理',
    description: '这里只汇总当前由你发起且仍在等待的 Run。',
    empty: '当前没有待处理事项。', loadMore: '加载更早的待处理事项',
    loading: '正在加载待处理事项…', unavailable: '暂时无法读取待处理事项。请稍后重试。',
    handled: '这个事项已经处理。这里显示的是 Server 当前状态。',
  },
  'en-US': {
    back: 'Back to workspace', eyebrow: 'Pending', title: 'Work waiting for you',
    description: 'This view contains only active Interrupts from runs you initiated.',
    empty: 'There is no pending work right now.', loadMore: 'Load older pending work',
    loading: 'Loading pending work…', unavailable: 'Pending work is unavailable right now. Try again shortly.',
    handled: 'This item was already handled. Current server state is shown.',
  },
} as const;

export function PendingWorkspace() {
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [feedback, setFeedback] = useState<string>();
  const queryClient = useQueryClient();
  const pendingApi = useMemo(() => createPendingBrowserApi(apiUrl), []);
  const commandApi = useMemo(() => createRunUiBrowserApi(apiUrl), []);
  const operations = useMemo(() => createSessionPendingOperationStore(), []);
  const pending = useInfiniteQuery({
    queryKey: ['workspace', 'interrupts'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => pendingApi.list(pageParam, 20),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = pending.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { if (feedback) statusRef.current?.focus(); }, [feedback]);

  const refresh = useCallback(async (item: ResolvableInterrupt) => {
    const refreshed = await pending.refetch();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workspace', 'summary'] }),
      queryClient.invalidateQueries({ queryKey: ['workspace', 'conversations'] }),
    ]);
    return {
      active: refreshed.data?.pages.some((page) => page.items
        .some((candidate) => candidate.interruptId === item.interruptId)) ?? false,
    };
  }, [pending, queryClient]);

  const coordinator = useMemo(() => new PendingResolutionCoordinator({
    api: commandApi,
    refresh,
    operations,
    createCommandId: () => crypto.randomUUID(),
  }), [commandApi, operations, refresh]);

  const resolve = useCallback(async (
    item: (typeof items)[number],
    response: PendingResponse,
  ) => {
    const result = await coordinator.resolve(item, response);
    if (result.kind === 'handled') setFeedback(text.handled);
    return result;
  }, [coordinator, text.handled]);

  return (
    <main>
      <Link className="workspace-back" href="/workspace">← {text.back}</Link>
      <p className="eyebrow">{text.eyebrow}</p>
      <h1 ref={headingRef} tabIndex={-1}>{text.title}</h1>
      <p>{text.description}</p>
      {feedback ? <p ref={statusRef} role="status" tabIndex={-1}>{feedback}</p> : null}
      {pending.isPending ? <p role="status">{text.loading}</p> : null}
      {pending.isError ? <p className="error" role="alert">{text.unavailable}</p> : null}
      {!pending.isPending && !pending.isError && items.length === 0
        ? <p className="workspace-empty" role="status">{text.empty}</p> : null}
      <div className="pending-list">
        {items.map((item) => (
          <GovernedInterruptCard key={item.interruptId} item={item} locale={locale}
            resolve={(response) => resolve(item, response)} />
        ))}
      </div>
      {pending.hasNextPage ? (
        <button className="button secondary" disabled={pending.isFetchingNextPage}
          onClick={() => void pending.fetchNextPage()}>{text.loadMore}</button>
      ) : null}
    </main>
  );
}
