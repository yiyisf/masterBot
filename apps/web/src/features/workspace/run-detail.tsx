'use client';

import { type MessageContract } from '@cmaster/contracts';
import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArtifactCard } from '../artifacts/artifact-card';
import { createConversationBrowserApi } from './conversation-browser-api';
import { RunActivity } from './run-activity';
import { createRunUiBrowserApi } from './run-ui-browser-api';
import { RunUiProjectionController } from './run-ui-transport';
import type { RunProjection } from '../../lib/run-projection';
import { useWorkspacePreferences } from './workspace-providers';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '';
type DisplayMessage = MessageContract;

const MessageHistory = memo(function MessageHistory({
  messages,
  heading,
}: Readonly<{ messages: readonly DisplayMessage[]; heading: string }>) {
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
                artifactId={part.artifactId} artifactVersionId={part.artifactVersionId} />
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
    cancel: '取消 Run', cancelLate: '结果已经生成，无法取消。', confirmFailed: '无法保存 Tool 确认结果。', reviewFailed: '无法保存不确定结果处理决定。',
    confirm: '确认执行', reject: '拒绝', uncertain: '外部副作用是否发生无法确定。继续不会重试原 ToolCall。', continue: '带着不确定性继续',
    messages: 'Messages', notFound: '无法读取这个 Run。', synchronized: '活动类型已更新，安全视图已重新同步。',
  },
  'en-US': {
    back: 'Back to conversation', loading: 'Loading…', connection: 'Connection', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', closed: 'Closed',
    cancel: 'Cancel run', cancelLate: 'The result has already been generated, so this run cannot be cancelled.', confirmFailed: 'The tool confirmation could not be saved.', reviewFailed: 'The uncertain-outcome decision could not be saved.',
    confirm: 'Confirm', reject: 'Reject', uncertain: 'Whether the external effect occurred is unknown. Continuing will not retry the original ToolCall.', continue: 'Continue with uncertainty',
    messages: 'Messages', notFound: 'This run could not be loaded.', synchronized: 'The activity type changed, and the safe view was synchronized again.',
  },
} as const;

export function RunDetail({
  conversationId,
  runId,
}: Readonly<{ conversationId: string; runId: string }>) {
  const headingRef = useRef<HTMLHeadingElement>(null);
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
  const [resolvingInterrupt, setResolvingInterrupt] = useState(false);

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
    void controller.start(runId).catch(() => setError(text.notFound));
    return () => controller.stop();
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

  async function cancel(): Promise<void> {
    try {
      await projectionApi.cancel(runId, crypto.randomUUID());
    } catch {
      setError(text.cancelLate);
    }
  }

  async function resolveConfirmation(response: 'confirm' | 'reject'): Promise<void> {
    const interrupt = projection?.activeInterrupt;
    if (!interrupt || interrupt.kind !== 'tool_confirmation') return;
    setResolvingInterrupt(true);
    setError(undefined);
    try {
      await projectionApi.resolveConfirmation(
        runId, interrupt.id, crypto.randomUUID(), response,
      );
    } catch {
      setError(text.confirmFailed);
    } finally {
      setResolvingInterrupt(false);
    }
  }

  async function continueWithUncertainty(): Promise<void> {
    const interrupt = projection?.activeInterrupt;
    if (!interrupt || interrupt.kind !== 'tool_outcome_review') return;
    setResolvingInterrupt(true);
    setError(undefined);
    try {
      await projectionApi.continueWithUncertainty(runId, interrupt.id, crypto.randomUUID());
    } catch {
      setError(text.reviewFailed);
    } finally {
      setResolvingInterrupt(false);
    }
  }

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
      {projection?.cancellable ? (
        <button className="button" onClick={() => void cancel()}>{text.cancel}</button>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {projection?.activeInterrupt ? (
        <section aria-labelledby="tool-interrupt-title">
          <h2 id="tool-interrupt-title">{projection.activeInterrupt.title}</h2>
          <dl>
            {Object.entries(projection.activeInterrupt.details).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          {projection.activeInterrupt.kind === 'tool_confirmation' ? (
            <p>
              <button className="button" disabled={resolvingInterrupt}
                onClick={() => void resolveConfirmation('confirm')}>{text.confirm}</button>{' '}
              <button className="button" disabled={resolvingInterrupt}
                onClick={() => void resolveConfirmation('reject')}>{text.reject}</button>
            </p>
          ) : (
            <div>
              <p role="alert">{text.uncertain}</p>
              <button className="button" disabled={resolvingInterrupt}
                onClick={() => void continueWithUncertainty()}>{text.continue}</button>
            </div>
          )}
        </section>
      ) : null}
      {displayProjection ? (
        <RunActivity projection={displayProjection} locale={locale}
          unknownActivity={unknownActivity} commands={runActivityCommands} />
      ) : null}
      <MessageHistory messages={messages} heading={text.messages} />
      {unknownActivity ? <p className="sr-only" role="status">{text.synchronized}</p> : null}
    </main>
  );
}
