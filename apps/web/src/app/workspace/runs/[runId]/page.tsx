'use client';

import {
  createContractClient,
  runEventEnvelopeSchema,
  type MessageContract,
  type RunSnapshotContract,
} from '@cmaster/contracts';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { applyRunEvent, projectionFromSnapshot, type RunProjection } from '../../../../lib/run-projection';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? 'http://localhost:3100';

export default function RunPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const [snapshot, setSnapshot] = useState<RunSnapshotContract>();
  const [messages, setMessages] = useState<MessageContract[]>([]);
  const [projection, dispatch] = useReducer(
    (state: RunProjection | undefined, action: RunProjection | Parameters<typeof applyRunEvent>[1]) => {
      if ('events' in action) return action;
      return state ? applyRunEvent(state, action) : state;
    },
    undefined,
  );
  const [connection, setConnection] = useState('connecting');
  const [error, setError] = useState<string>();
  const [resolvingInterrupt, setResolvingInterrupt] = useState(false);

  const loadMessages = useCallback(async (conversationId: string) => {
    const client = createContractClient(apiUrl);
    const result = await client.GET('/api/v1/conversations/{conversationId}/messages', {
      params: { path: { conversationId }, query: { afterSequence: 0, limit: 200 } },
    });
    if (result.data) setMessages(result.data.items);
  }, []);

  const loadSnapshot = useCallback(async (resetProjection = true) => {
    const client = createContractClient(apiUrl);
    const result = await client.GET('/api/v1/runs/{runId}', { params: { path: { runId } } });
    if (!result.data) throw new Error('Run was not found');
    setSnapshot(result.data);
    if (resetProjection) dispatch(projectionFromSnapshot(result.data));
    await loadMessages(result.data.conversationId);
    return result.data;
  }, [loadMessages, runId]);

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
          void loadMessages(initial.conversationId);
        }
        if (parsed.data.type === 'interrupt.requested') {
          void loadSnapshot(false);
        }
        if (['run.succeeded', 'run.failed', 'run.cancelled'].includes(parsed.data.type)) {
          source?.close();
          setConnection('closed');
          void loadSnapshot(false);
        }
      });
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load Run'));
    return () => {
      disposed = true;
      source?.close();
    };
  }, [loadMessages, loadSnapshot, runId]);

  useEffect(() => {
    // A detected transport gap requires replacing the projection from Server State.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (projection?.hasGap) void loadSnapshot();
  }, [loadSnapshot, projection?.hasGap]);

  async function cancel(): Promise<void> {
    const client = createContractClient(apiUrl);
    const result = await client.POST('/api/v1/runs/{runId}/commands/cancel', {
      params: { path: { runId } }, headers: { 'idempotency-key': crypto.randomUUID() },
    });
    if (result.error) setError('结果已经生成，无法取消。');
    await loadSnapshot();
  }

  async function resolveConfirmation(response: 'confirm' | 'reject'): Promise<void> {
    const interrupt = snapshot?.activeInterrupt;
    if (!interrupt || interrupt.kind !== 'tool_confirmation') return;
    setResolvingInterrupt(true);
    setError(undefined);
    const client = createContractClient(apiUrl);
    const result = await client.POST('/api/v1/runs/{runId}/tool-confirmations/{interruptId}/resolve', {
      params: { path: { runId, interruptId: interrupt.id } },
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: { response },
    });
    if (result.error) setError('无法保存 Tool 确认结果。');
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
      params: { path: { runId, interruptId: interrupt.id } },
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: { response: 'continue_with_uncertainty' },
    });
    if (result.error) setError('无法保存不确定结果处理决定。');
    await loadSnapshot();
    setResolvingInterrupt(false);
  }

  const status = projection?.status ?? snapshot?.status;
  return (
    <main>
      <p className="eyebrow">Run {runId}</p>
      <h1>{status ?? '正在加载…'}</h1>
      <p>SSE: {connection}</p>
      {projection?.cancellable ? <button className="button" onClick={() => void cancel()}>取消 Run</button> : null}
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
              >确认执行</button>{' '}
              <button
                className="button"
                disabled={resolvingInterrupt}
                onClick={() => void resolveConfirmation('reject')}
              >拒绝</button>
            </p>
          ) : (
            <div>
              <p role="alert">外部副作用是否发生无法确定。继续不会重试原 ToolCall。</p>
              <button
                className="button"
                disabled={resolvingInterrupt}
                onClick={() => void continueWithUncertainty()}
              >带着不确定性继续</button>
            </div>
          )}
        </section>
      ) : null}
      {snapshot?.failure ? (
        <p className="error" role="alert">{snapshot.failure.message}</p>
      ) : null}
      {snapshot?.model ? (
        <section>
          <h2>Model</h2>
          <p>{snapshot.model.displayName}{snapshot.model.fallbackUsed ? '（已降级）' : ''}</p>
          {snapshot.usage ? (
            <p>Tokens: {snapshot.usage.inputTokens} in / {snapshot.usage.outputTokens} out / {snapshot.usage.totalTokens} total</p>
          ) : null}
        </section>
      ) : null}
      <section>
        <h2>Messages</h2>
        {messages.map((message) => (
          <article className="message" key={message.id}>
            <strong>{message.author}</strong>
            <p>{message.parts[0].text}</p>
          </article>
        ))}
      </section>
      <section>
        <h2>Timeline</h2>
        <ol>{projection?.events.map((event) => <li key={event.eventId}>{event.sequence}: {event.type}</li>)}</ol>
      </section>
    </main>
  );
}
