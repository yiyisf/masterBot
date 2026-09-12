'use client';

import { type MessageContract } from '@cmaster/contracts';
import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArtifactCard } from '../artifacts/artifact-card';
import { createConversationBrowserApi } from './conversation-browser-api';
import { GovernedInterruptCard, type GovernedInterruptViewModel } from './governed-interrupt-card';
import {
  PendingResolutionCoordinator,
  createSessionPendingOperationStore,
  type PendingResponse,
} from './pending-resolution';
import { RunActivity } from './run-activity';
import { RunCancelControl } from './run-cancel-control';
import { createRunUiBrowserApi } from './run-ui-browser-api';
import { RunUiProjectionController } from './run-ui-transport';
import type { RunProjection } from '../../lib/run-projection';
import { useWorkspacePreferences } from './workspace-providers';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '';
type DisplayMessage = MessageContract;

const MessageHistory = memo(function MessageHistory({
  messages,
  heading,
  locale,
}: Readonly<{
  messages: readonly DisplayMessage[];
  heading: string;
  locale: 'zh-CN' | 'en-US';
}>) {
  return (
    <section>
      <h2>{heading}</h2>
      {messages.map((message) => (
        <article className="message" key={message.id}>
          <strong>{message.author}</strong>
          {message.parts.map((part, index) => part.type === 'text'
            ? <p key={`text-${index}`}>{part.text}</p>
            : (
              <ArtifactCard key={part.artifactVersionId} apiUrl={apiUrl}
                artifactId={part.artifactId} artifactVersionId={part.artifactVersionId}
                locale={locale} />
            ))}
        </article>
      ))}
    </section>
  );
});

const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
const copy = {
  'zh-CN': {
    back: '返回 Conversation', loading: '正在加载…', connection: '连接', connecting: '连接中', connected: '已连接', reconnecting: '正在重连', closed: '已关闭',
    messages: 'Messages', notFound: '无法读取这个 Run。', synchronized: '活动类型已更新，安全视图已重新同步。',
  },
  'en-US': {
    back: 'Back to conversation', loading: 'Loading…', connection: 'Connection', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', closed: 'Closed',
    messages: 'Messages', notFound: 'This run could not be loaded.', synchronized: 'The activity type changed, and the safe view was synchronized again.',
  },
} as const;

export function RunDetail({
  conversationId,
  runId,
}: Readonly<{ conversationId: string; runId: string }>) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const controllerRef = useRef<RunUiProjectionController | undefined>(undefined);
  const cancelCommandIdRef = useRef<string | undefined>(undefined);
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const projectionApi = useMemo(() => createRunUiBrowserApi(apiUrl), []);
  const conversationApi = useMemo(() => createConversationBrowserApi(apiUrl), []);
  const [projection, setProjection] = useState<RunProjection>();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [olderTimeline, setOlderTimeline] = useState<RunProjection['timeline']>([]);
  const [timelineCursor, setTimelineCursor] = useState<number | null>();
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting' | 'closed'>('connecting');
  const [unknownActivity, setUnknownActivity] = useState(false);
  const [error, setError] = useState<string>();
  const pendingOperations = useMemo(() => createSessionPendingOperationStore(), []);

  const loadMessages = useCallback(async (triggerMessageId: string) => {
    let beforeSequence: number | undefined;
    let loaded: DisplayMessage[] = [];
    do {
      const page = await conversationApi.getMessages(conversationId, beforeSequence);
      loaded = [...page.items, ...loaded];
      beforeSequence = page.beforeSequence;
    } while (beforeSequence !== undefined
      && !loaded.some((message) => message.id === triggerMessageId));
    setMessages(loaded);
  }, [conversationApi, conversationId]);

  useEffect(() => {
    const controller = new RunUiProjectionController({
      loadSnapshot: async (selectedRunId) => {
        const snapshot = await projectionApi.loadSnapshot(selectedRunId);
        if (snapshot.conversationId !== conversationId) throw new Error('run_conversation_mismatch');
        return snapshot;
      },
      openStream: (selectedRunId, afterSequence, stream) => {
        setConnection('connected');
        return projectionApi.openStream(selectedRunId, afterSequence, {
          onEvent: stream.onEvent,
          onError: () => {
            setConnection('reconnecting');
            stream.onError();
          },
        });
      },
      onState: (state) => {
        setProjection(state);
        if (terminalStatuses.has(state.status)) setConnection('closed');
      },
      onUnknown: () => setUnknownActivity(true),
    });
    controllerRef.current = controller;
    void controller.start(runId).catch(() => setError(text.notFound));
    return () => {
      controller.stop();
      controllerRef.current = undefined;
    };
  }, [conversationId, projectionApi, runId, text.notFound]);

  const triggerMessageId = projection?.triggerMessageId;
  const assistantMessageId = projection?.assistantMessageId;
  const projectionRunId = projection?.runId;
  useEffect(() => {
    if (!triggerMessageId) return;
    // 只在权威 Projection 表明 Message 可能变化时刷新持久历史。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMessages(triggerMessageId).catch(() => setError(text.notFound));
  }, [assistantMessageId, loadMessages, text.notFound, triggerMessageId]);

  useEffect(() => {
    if (projectionRunId) headingRef.current?.focus();
  }, [projectionRunId]);

  const projectionTimelineCursor = projection?.timelineBeforeSequence;
  const loadOlderTimeline = useCallback(async (): Promise<void> => {
    const beforeSequence = timelineCursor === undefined
      ? projectionTimelineCursor : timelineCursor ?? undefined;
    if (beforeSequence === undefined) return;
    try {
      const page = await projectionApi.loadTimeline(runId, beforeSequence);
      setOlderTimeline((current) => [...page.items, ...current]);
      setTimelineCursor(page.beforeSequence ?? null);
    } catch {
      setError(text.notFound);
    }
  }, [projectionApi, projectionTimelineCursor, runId, text.notFound, timelineCursor]);

  const refreshPendingAuthority = useCallback(async (item: { readonly interruptId: string }) => {
    const state = await controllerRef.current?.refresh();
    return { active: state?.activeInterrupt?.id === item.interruptId };
  }, []);
  const governedInterrupt = useMemo<GovernedInterruptViewModel | undefined>(() => {
    const interrupt = projection?.activeInterrupt;
    if (!interrupt) return undefined;
    const common = { conversationId, runId, interruptId: interrupt.id };
    return interrupt.kind === 'tool_confirmation'
      ? {
          ...common,
          kind: 'employee_confirmation',
          allowedResponses: interrupt.allowedResponses.filter(
            (response): response is 'confirm' | 'reject' => (
              response === 'confirm' || response === 'reject'
            ),
          ),
          approvalSubject: { title: interrupt.title, details: interrupt.details },
        }
      : {
          ...common,
          kind: 'uncertain_tool_outcome_review',
          allowedResponses: interrupt.allowedResponses.filter(
            (response): response is 'continue_with_uncertainty' => (
              response === 'continue_with_uncertainty'
            ),
          ),
          subject: { title: interrupt.title, details: interrupt.details },
        };
  }, [conversationId, projection?.activeInterrupt, runId]);

  const resolveGovernedInterrupt = useCallback(async (response: PendingResponse) => {
    if (!governedInterrupt) return { kind: 'handled' as const };
    const coordinator = new PendingResolutionCoordinator({
      api: projectionApi,
      operations: pendingOperations,
      createCommandId: crypto.randomUUID,
      refresh: refreshPendingAuthority,
    });
    const result = await coordinator.resolve(governedInterrupt, response);
    if (result.kind === 'handled') setTimeout(() => headingRef.current?.focus(), 0);
    return result;
  }, [governedInterrupt, pendingOperations, projectionApi, refreshPendingAuthority]);

  const cancel = useCallback(async () => {
    cancelCommandIdRef.current ??= crypto.randomUUID();
    const result = await projectionApi.cancel(runId, cancelCommandIdRef.current);
    cancelCommandIdRef.current = undefined;
    return result;
  }, [projectionApi, runId]);

  const refreshProjection = useCallback(async () => {
    await controllerRef.current?.refresh();
  }, []);

  const effectiveTimelineCursor = timelineCursor === undefined
    ? projection?.timelineBeforeSequence : timelineCursor ?? undefined;
  const projectedTimeline = projection?.timeline;
  const displayTimeline = useMemo(() => (
    projectedTimeline ? [...olderTimeline, ...projectedTimeline] : []
  ), [olderTimeline, projectedTimeline]);
  const displayProjection = projection ? {
    ...projection,
    timeline: displayTimeline,
    hasEarlierTimeline: effectiveTimelineCursor !== undefined,
  } : undefined;
  const runActivityCommands = useMemo(() => ({
    loadOlder: () => void loadOlderTimeline(),
  }), [loadOlderTimeline]);

  return (
    <main>
      <Link href={`/workspace/conversations/${conversationId}`} className="workspace-back">
        ← {text.back}
      </Link>
      <p className="eyebrow">Run {runId}</p>
      <h1 ref={headingRef} tabIndex={-1}>{projection?.status ?? text.loading}</h1>
      <p>{text.connection}: {text[connection]}</p>
      {projection ? (
        <RunCancelControl locale={locale} cancellable={projection.cancellable}
          cancel={cancel} refresh={refreshProjection} />
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {governedInterrupt ? (
        <GovernedInterruptCard item={governedInterrupt} locale={locale}
          resolve={resolveGovernedInterrupt} />
      ) : null}
      {displayProjection ? (
        <RunActivity projection={displayProjection} locale={locale}
          unknownActivity={unknownActivity} commands={runActivityCommands} />
      ) : null}
      <MessageHistory messages={messages} heading={text.messages} locale={locale} />
      {unknownActivity ? <p className="sr-only" role="status">{text.synchronized}</p> : null}
    </main>
  );
}
