'use client';

import { PromptInput } from '../../components/ai-elements/prompt-input';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { createBrowserSubmissionApi, createSessionSubmissionStore } from './browser-submission';
import {
  ConversationSubmissionCoordinator,
  type ConversationSubmissionOperation,
} from './conversation-submission';
import { useWorkspacePreferences } from './workspace-providers';

const maximumMessageLength = 32 * 1024;
const copy = {
  'zh-CN': {
    eyebrow: '新建 Conversation', title: '开始一项工作', description: '首次发送时才会保存 Conversation。',
    placeholder: '说明要完成的工作', send: '发送', sending: '正在保存…', continue: '继续创建 Run',
    blank: '请输入内容后再发送。', overLimit: `内容不能超过 ${maximumMessageLength.toLocaleString('zh-CN')} 个字符。`,
    messageSaved: 'Message 已保存，但 Run 尚未创建。你可以继续创建同一个 Run。',
    conversationSaved: 'Conversation 已保存，Message 尚未保存。你可以继续完成发送。',
    failed: '暂时无法完成发送。已保存的进度和内容仍保留在当前标签页。',
    locked: '恢复期间内容保持不变，以便复用同一操作标识。', back: '返回工作区',
  },
  'en-US': {
    eyebrow: 'New conversation', title: 'Start a piece of work', description: 'The conversation is saved only when you first send.',
    placeholder: 'Describe the work to complete', send: 'Send', sending: 'Saving…', continue: 'Continue creating run',
    blank: 'Enter a message before sending.', overLimit: `The message cannot exceed ${maximumMessageLength.toLocaleString('en-US')} characters.`,
    messageSaved: 'The message was saved, but its run was not created. You can continue creating the same run.',
    conversationSaved: 'The conversation was saved, but its message was not. You can continue sending it.',
    failed: 'Sending could not be completed. Saved progress and content remain in this browser tab.',
    locked: 'Content stays unchanged during recovery so the same operation identities can be reused.', back: 'Back to workspace',
  },
} as const;

export function NewConversationComposer() {
  const router = useRouter();
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const [draft, setDraft] = useState('');
  const [operation, setOperation] = useState<ConversationSubmissionOperation>();
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const store = useMemo(() => (
    typeof window === 'undefined' ? undefined : createSessionSubmissionStore(window.sessionStorage)
  ), []);

  useEffect(() => {
    if (!store) return;
    // Browser-only per-tab state is restored after hydration and never enters Query Cache.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(store.loadDraft());
    const recoveredOperation = store.loadOperation();
    if (recoveredOperation?.conversationId && recoveredOperation.runId) {
      router.replace(
        `/workspace/conversations/${recoveredOperation.conversationId}?run=${recoveredOperation.runId}`,
      );
      store.clearOperation();
      return;
    }
    setOperation(recoveredOperation);
  }, [router, store]);

  const overLimit = draft.length > maximumMessageLength;
  const guidance = feedback ?? (operation ? text.locked : !draft.trim() ? text.blank : '');
  function changeDraft(value: string): void {
    if (operation) return;
    setDraft(value);
    setFeedback(value.length > maximumMessageLength ? text.overLimit : undefined);
    try {
      store?.saveDraft(value);
    } catch {
      setFeedback(text.failed);
    }
  }

  async function submit(): Promise<void> {
    if (!store || submitting) return;
    if (!draft.trim()) { setFeedback(text.blank); return; }
    if (overLimit) { setFeedback(text.overLimit); return; }
    setSubmitting(true);
    setFeedback(undefined);
    const coordinator = new ConversationSubmissionCoordinator(
      createBrowserSubmissionApi(
        process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '',
        globalThis.fetch,
      ),
      store,
      () => crypto.randomUUID(),
    );
    try {
      const completed = await coordinator.submit(draft);
      router.replace(`/workspace/conversations/${completed.conversationId}?run=${completed.runId}`);
      coordinator.acknowledgeNavigation();
    } catch {
      const saved = store.loadOperation();
      setOperation(saved);
      setFeedback(saved?.messageId ? text.messageSaved
        : saved?.conversationId ? text.conversationSaved : text.failed);
      setSubmitting(false);
    }
  }

  return (
    <main className="new-conversation">
      <Link href="/workspace" className="workspace-back">← {text.back}</Link>
      <p className="eyebrow">{text.eyebrow}</p>
      <h1>{text.title}</h1>
      <p>{text.description}</p>
      {operation?.messageId ? (
        <article className="message saved-message" aria-label={text.messageSaved}>
          <strong>Employee</strong>
          <p>{draft}</p>
          <small>{text.messageSaved}</small>
        </article>
      ) : null}
      <PromptInput
        viewModel={{
          value: draft,
          disabled: submitting,
          readOnly: Boolean(operation),
          submitting,
          overLimit,
          placeholder: text.placeholder,
          sendLabel: submitting ? text.sending : operation ? text.continue : text.send,
        }}
        commands={{ onChange: changeDraft, onSubmit: () => void submit() }}
      />
      <div id="composer-feedback" className={feedback ? 'composer-feedback' : 'composer-guidance'}
        role={feedback ? 'alert' : 'status'}>
        {guidance}
      </div>
    </main>
  );
}
