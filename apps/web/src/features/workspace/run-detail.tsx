'use client';

import {
  createContractClient,
  runEventEnvelopeSchema,
  type MessageContract,
  type RunSnapshotContract,
} from '@cmaster/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArtifactCard } from '../artifacts/artifact-card';
import { applyRunEvent, projectionFromSnapshot, type RunProjection } from '../../lib/run-projection';
import { useWorkspacePreferences } from './workspace-providers';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '';

type DisplayMessage = MessageContract;
const copy = {
  'zh-CN': {
    back: '返回 Conversation', loading: '正在加载…', stream: '连接', connecting: '连接中', connected: '已连接', reconnecting: '正在重连', closed: '已关闭',
    cancel: '取消 Run', cancelLate: '结果已经生成，无法取消。', confirmFailed: '无法保存 Tool 确认结果。', reviewFailed: '无法保存不确定结果处理决定。',
    confirm: '确认执行', reject: '拒绝', uncertain: '外部副作用是否发生无法确定。继续不会重试原 ToolCall。', continue: '带着不确定性继续',
    model: 'Model', messages: 'Messages', timeline: 'Timeline', notFound: '无法读取这个 Run。',
  },
  'en-US': {
    back: 'Back to conversation', loading: 'Loading…', stream: 'Connection', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', closed: 'Closed',
    cancel: 'Cancel run', cancelLate: 'The result has already been generated, so this run cannot be cancelled.', confirmFailed: 'The tool confirmation could not be saved.', reviewFailed: 'The uncertain-outcome decision could not be saved.',
    confirm: 'Confirm', reject: 'Reject', uncertain: 'Whether the external effect occurred is unknown. Continuing will not retry the original ToolCall.', continue: 'Continue with uncertainty',
    model: 'Model', messages: 'Messages', timeline: 'Timeline', notFound: 'This run could not be loaded.',
  },
} as const;

export function RunDetail({
  conversationId,
  runId,
}: Readonly<{ conversationId: string; runId: string }>) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const [snapshot, setSnapshot] = useState<RunSnapshotContract>();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [projection, dispatch] = useReducer(
    (state: RunProjection | undefined, action: RunProjection | Parameters<typeof applyRunEvent>[1]) => {
      if ('events' in action) return action;
      return state ? applyRunEvent(state, action) : state;
    },
    undefined,
  );
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting' | 'closed'>('connecting');
  const [error, setError] = useState<string>();
  const [resolvingInterrupt, setResolvingInterrupt] = useState(false);

  const loadMessages = useCallback(async (
    conversationId: string,
    triggerMessageId: string,
  ) => {
    const client = createContractClient(apiUrl);
    let beforeSequence: number | undefined;
    let loaded: DisplayMessage[] = [];
    do {
      const result = await client.GET('/api/v1/conversations/{conversationId}/messages', {
        params: {
          path: { conversationId },
          query: { limit: 50, ...(beforeSequence === undefined ? {} : { beforeSequence }) },
        },
      });
      if (!result.data) return;
      loaded = [...result.data.items, ...loaded];
      beforeSequence = result.data.beforeSequence;
    } while (beforeSequence !== undefined
      && !loaded.some((message) => message.id === triggerMessageId));
    setMessages(loaded);
  }, []);

  const loadSnapshot = useCallback(async (resetProjection = true) => {
    const client = createContractClient(apiUrl);
    const result = await client.GET('/api/v1/runs/{runId}', { params: { path: { runId } } });
    if (!result.data || result.data.conversationId !== conversationId) {
      throw new Error('Run was not found');
    }
    setSnapshot(result.data);
    if (resetProjection) dispatch(projectionFromSnapshot(result.data));
    await loadMessages(result.data.conversationId, result.data.trigger.messageId);
    return result.data;
  }, [conversationId, loadMessages, runId]);

  useEffect(() => {
    let source: EventSource | undefined;
    let disposed = false;
    // Snapshot loading is the external subscription bootstrap for this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSnapshot().then((initial) => {
      if (disposed || ['succeeded', 'failed', 'cancelled'].includes(initial.status)) return;
      source = new EventSource(
        `${apiUrl}/api/v1/runs/${runId}/events?afterSequence=${initial.lastSequence}`,
        { withCredentials: true },
      );
      source.onopen = () => setConnection('connected');
      source.onerror = () => setConnection('reconnecting');
      source.addEventListener('run-event', (raw) => {
        let payload: unknown;
        try {
          payload = JSON.parse((raw as MessageEvent).data);
        } catch {
          source?.close();
          void loadSnapshot();
          return;
        }
        const parsed = runEventEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
          source?.close();
          void loadSnapshot();
          return;
        }
        dispatch(parsed.data);
        if (parsed.data.type === 'assistant_message.appended') {
          void loadMessages(initial.conversationId, initial.trigger.messageId);
        }
        if (parsed.data.type === 'interrupt.requested'
          || parsed.data.type === 'interrupt.resolved') {
          void loadSnapshot(false);
        }
        if (['run.succeeded', 'run.failed', 'run.cancelled'].includes(parsed.data.type)) {
          source?.close();
          setConnection('closed');
          void loadSnapshot(false);
        }
      });
    }).catch(() => setError(text.notFound));
    return () => {
      disposed = true;
      source?.close();
    };
  }, [loadMessages, loadSnapshot, runId, text.notFound]);

  useEffect(() => {
    // A detected transport gap requires replacing the projection from Server State.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (projection?.hasGap) void loadSnapshot();
  }, [loadSnapshot, projection?.hasGap]);

  async function cancel(): Promise<void> {
    const client = createContractClient(apiUrl);
    const result = await client.POST('/api/v1/runs/{runId}/commands/cancel', {
      params: {
        path: { runId },
        header: { 'idempotency-key': crypto.randomUUID() },
      },
    });
    if (result.error) setError(text.cancelLate);
    await loadSnapshot();
  }

  async function resolveConfirmation(response: 'confirm' | 'reject'): Promise<void> {
    const interrupt = snapshot?.activeInterrupt;
    if (!interrupt || interrupt.kind !== 'tool_confirmation') return;
    setResolvingInterrupt(true);
    setError(undefined);
    const client = createContractClient(apiUrl);
    const result = await client.POST('/api/v1/runs/{runId}/tool-confirmations/{interruptId}/resolve', {
      params: {
        path: { runId, interruptId: interrupt.id },
        header: { 'idempotency-key': crypto.randomUUID() },
      },
      body: { response },
    });
    if (result.error) setError(text.confirmFailed);
    await loadSnapshot();
    setResolvingInterrupt(false);
  }

  async function continueWithUncertainty(): Promise<void> {
    const interrupt = snapshot?.activeInterrupt;
    if (!interrupt || interrupt.kind !== 'tool_outcome_review') return;
    setResolvingInterrupt(true);
    setError(undefined);
    const client = createContractClient(apiUrl);
    const result = await client.POST('/api/v1/runs/{runId}/interrupts/{interruptId}/resolve', {
      params: {
        path: { runId, interruptId: interrupt.id },
        header: { 'idempotency-key': crypto.randomUUID() },
      },
      body: { response: 'continue_with_uncertainty' },
    });
    if (result.error) setError(text.reviewFailed);
    await loadSnapshot();
    setResolvingInterrupt(false);
  }

  const status = projection?.status ?? snapshot?.status;
  useEffect(() => {
    if (status) headingRef.current?.focus();
  }, [status]);
  return (
    <main>
      <Link href={`/workspace/conversations/${conversationId}`} className="workspace-back">
        ← {text.back}
      </Link>
      <p className="eyebrow">Run {runId}</p>
      <h1 ref={headingRef} tabIndex={-1}>{status ?? text.loading}</h1>
      <p>{text.stream}: {text[connection]}</p>
      {projection?.cancellable ? <button className="button" onClick={() => void cancel()}>{text.cancel}</button> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {snapshot?.activeInterrupt ? (
        <section aria-labelledby="tool-interrupt-title">
          <h2 id="tool-interrupt-title">{snapshot.activeInterrupt.safeSubjectSummary.title}</h2>
          <dl>
            {Object.entries(snapshot.activeInterrupt.safeSubjectSummary.details).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          {snapshot.activeInterrupt.kind === 'tool_confirmation' ? (
            <p>
              <button
                className="button"
                disabled={resolvingInterrupt}
                onClick={() => void resolveConfirmation('confirm')}
              >{text.confirm}</button>{' '}
              <button
                className="button"
                disabled={resolvingInterrupt}
                onClick={() => void resolveConfirmation('reject')}
              >{text.reject}</button>
            </p>
          ) : (
            <div>
              <p role="alert">{text.uncertain}</p>
              <button
                className="button"
                disabled={resolvingInterrupt}
                onClick={() => void continueWithUncertainty()}
              >{text.continue}</button>
            </div>
          )}
        </section>
      ) : null}
      {snapshot?.failure ? (
        <p className="error" role="alert">{snapshot.failure.message}</p>
      ) : null}
      {snapshot?.model ? (
        <section>
          <h2>{text.model}</h2>
          <p>{snapshot.model.displayName}{snapshot.model.fallbackUsed ? '（已降级）' : ''}</p>
          {snapshot.usage ? (
            <p>Tokens: {snapshot.usage.inputTokens} in / {snapshot.usage.outputTokens} out / {snapshot.usage.totalTokens} total</p>
          ) : null}
        </section>
      ) : null}
      <section>
        <h2>{text.messages}</h2>
        {messages.map((message) => (
          <article className="message" key={message.id}>
            <strong>{message.author}</strong>
            {message.parts.map((part, index) => part.type === 'text'
              ? <p key={`text-${index}`}>{part.text}</p>
              : (
                <ArtifactCard
                  key={part.artifactVersionId}
                  apiUrl={apiUrl}
                  artifactId={part.artifactId}
                  artifactVersionId={part.artifactVersionId}
                />
              ))}
          </article>
        ))}
      </section>
      <section>
        <h2>{text.timeline}</h2>
        <ol>{projection?.events.map((event) => <li key={event.eventId}>{event.sequence}: {event.type}</li>)}</ol>
      </section>
    </main>
  );
}
