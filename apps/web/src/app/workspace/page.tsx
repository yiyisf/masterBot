'use client';

import { createContractClient } from '@cmaster/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? 'http://localhost:3100';

export default function WorkspacePage() {
  const router = useRouter();
  const [text, setText] = useState('Hello from the Employee Workspace');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    const client = createContractClient(apiUrl);
    try {
      const conversation = await client.POST('/api/v1/conversations', {
        headers: { 'idempotency-key': crypto.randomUUID() }, body: {},
      });
      if (!conversation.data) throw new Error('Conversation could not be created');
      const message = await client.POST('/api/v1/conversations/{conversationId}/messages', {
        params: { path: { conversationId: conversation.data.id } },
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: { parts: [{ type: 'text', text }] },
      });
      if (!message.data) throw new Error('Message could not be created');
      const run = await client.POST('/api/v1/runs', {
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: { trigger: { type: 'message', messageId: message.data.id } },
      });
      if (!run.data) throw new Error('Run could not be accepted');
      router.push(`/workspace/runs/${run.data.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start the Run');
      setSubmitting(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">Employee Workspace</p>
      <h1>Echo Run</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="message">Employee Message</label>
        <textarea id="message" value={text} maxLength={32 * 1024} required
          onChange={(event) => setText(event.target.value)} />
        <button className="button" disabled={submitting || !text.trim()} type="submit">
          {submitting ? '正在接受 Run…' : '运行 Echo'}
        </button>
      </form>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </main>
  );
}
