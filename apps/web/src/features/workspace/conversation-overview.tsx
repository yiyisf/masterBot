'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { PromptInput } from '../../components/ai-elements/prompt-input';
import { createBrowserSubmissionApi } from './browser-submission';
import { createConversationBrowserApi } from './conversation-browser-api';
import { ConversationRenameCoordinator, createRenameOperationStore } from './conversation-rename';
import { ConversationThread } from './conversation-thread';
import {
  contentArrivalAction,
  preservePrependAnchor,
  resolveScrollRestoration,
  selectDefaultRun,
} from './conversation-view-state';
import { createContinuingSubmissionStore } from './continuing-browser';
import {
  ContinuingSubmissionCoordinator,
  type ContinuingSubmissionOperation,
} from './continuing-submission';
import { useWorkspacePreferences } from './workspace-providers';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '';
const activeStatuses = new Set(['accepted', 'queued', 'running', 'waiting']);
const maximumMessageLength = 32 * 1024;
const copy = {
  'zh-CN': {
    back: '返回工作区', untitled: '未命名 Conversation', loading: '正在读取 Conversation…', failed: '无法读取这个 Conversation。',
    rename: '重命名', saveTitle: '保存标题', cancelRename: '取消', titleLabel: 'Conversation 标题', renamed: '标题已保存。', renameFailed: '标题尚未保存。进度保留在当前标签页，可重试。',
    activeRuns: (count: number) => `${count.toLocaleString('zh-CN')} 个 Run 正在处理`,
    composerBlocked: '当前有 Run 正在处理。完成或取消后才能继续发送。',
    placeholder: '继续说明要完成的工作', send: '发送', sending: '正在保存…', continue: '继续创建 Run',
    blank: '请输入内容后再发送。', overLimit: `内容不能超过 ${maximumMessageLength.toLocaleString('zh-CN')} 个字符。`,
    messageSaved: 'Message 已保存，但 Run 尚未创建。你可以继续创建同一个 Run。',
    submissionFailed: '暂时无法完成发送。已保存的进度和内容仍保留在当前标签页。',
    runAgainFailed: '新的 Run 尝试尚未创建。原 Run 保持不变，你可以重试。',
    composer: 'Message 编辑器', selectedRun: '当前 Run', employee: 'Employee',
    thread: 'Conversation 线程',
  },
  'en-US': {
    back: 'Back to workspace', untitled: 'Untitled conversation', loading: 'Loading conversation…', failed: 'This conversation could not be loaded.',
    rename: 'Rename', saveTitle: 'Save title', cancelRename: 'Cancel', titleLabel: 'Conversation title', renamed: 'Title saved.', renameFailed: 'The title was not saved. Progress remains in this tab so you can retry.',
    activeRuns: (count: number) => `${count.toLocaleString('en-US')} runs are active`,
    composerBlocked: 'A run is active. Wait for it to finish or cancel it before sending another message.',
    placeholder: 'Continue describing the work', send: 'Send', sending: 'Saving…', continue: 'Continue creating run',
    blank: 'Enter a message before sending.', overLimit: `The message cannot exceed ${maximumMessageLength.toLocaleString('en-US')} characters.`,
    messageSaved: 'The message was saved, but its run was not created. You can continue creating the same run.',
    submissionFailed: 'Sending could not be completed. Saved progress and content remain in this browser tab.',
    runAgainFailed: 'The new run attempt was not created. The original run is unchanged, and you can retry.',
    composer: 'Message composer', selectedRun: 'Selected Run', employee: 'Employee',
    thread: 'Conversation Thread',
  },
} as const;

export function ConversationOverview({
  conversationId,
  embedded = false,
}: Readonly<{ conversationId: string; embedded?: boolean }>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const api = useMemo(() => createConversationBrowserApi(apiUrl), []);
  const submissionApi = useMemo(() => createBrowserSubmissionApi(apiUrl), []);
  const submissionStore = useMemo(() => typeof window === 'undefined'
    ? undefined
    : createContinuingSubmissionStore(window.sessionStorage, conversationId), [conversationId]);
  const renameStore = useMemo(() => typeof window === 'undefined'
    ? undefined
    : createRenameOperationStore(window.sessionStorage, conversationId), [conversationId]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const conversationHeadingRef = useRef<HTMLHeadingElement>(null);
  const prependAnchor = useRef<{ scrollTop: number; scrollHeightBefore: number } | undefined>(undefined);
  const nearBottom = useRef(true);
  const previousNewestSequence = useRef(0);
  const [hasNewContent, setHasNewContent] = useState(false);
  const restoreSequence = useRef<number | undefined>(undefined);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [renameFeedback, setRenameFeedback] = useState<string>();
  const [draft, setDraft] = useState('');
  const [operation, setOperation] = useState<ContinuingSubmissionOperation>();
  const [submitting, setSubmitting] = useState(false);
  const [composerFeedback, setComposerFeedback] = useState<string>();

  const conversation = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.getConversation(conversationId),
  });
  const runs = useInfiniteQuery({
    queryKey: ['conversation', conversationId, 'runs'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.getRuns(conversationId, pageParam),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) => query.state.data?.pages
      .some((page) => page.items.some((run) => activeStatuses.has(run.status))) ? 2_000 : false,
  });
  const runItems = useMemo(() => (
    runs.data?.pages.flatMap((page) => page.items) ?? []
  ), [runs.data]);
  const messages = useInfiniteQuery({
    queryKey: ['conversation', conversationId, 'messages'],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.getMessages(conversationId, pageParam),
    getNextPageParam: (page) => page.beforeSequence,
    refetchInterval: runItems.some((run) => activeStatuses.has(run.status)) ? 2_000 : false,
  });
  const orderedMessages = useMemo(() => messages.data
    ? [...messages.data.pages].reverse().flatMap((page) => page.items)
    : [], [messages.data]);
  const newestSequence = orderedMessages.at(-1)?.sequence ?? 0;
  const activeRunCount = runItems.filter((run) => activeStatuses.has(run.status)).length;
  const loadedConversationId = conversation.data?.id;

  useEffect(() => {
    if (!embedded && loadedConversationId) conversationHeadingRef.current?.focus();
  }, [embedded, loadedConversationId]);
  const runControlsUnavailable = runs.isPending || runs.isError || activeRunCount > 0;
  const defaultRunId = selectDefaultRun(runItems);
  const runVersion = runItems.map((run) => `${run.id}:${run.status}`).join('|');

  useEffect(() => {
    if (runVersion) {
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId, 'messages'] });
    }
  }, [conversationId, queryClient, runVersion]);

  useEffect(() => {
    if (!submissionStore) return;
    // Browser-only per-Conversation state is restored after hydration and never enters Query Cache.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(submissionStore.loadDraft());
    try {
      const savedSequence = Number.parseInt(
        window.sessionStorage.getItem(`cmaster.workspace.conversation.${conversationId}.scroll-sequence.v1`) ?? '',
        10,
      );
      if (Number.isInteger(savedSequence) && savedSequence > 0) {
        restoreSequence.current = savedSequence;
      }
    } catch {
      // Scroll context is optional and never changes business behavior.
    }
    const recovered = submissionStore.loadOperation();
    if (recovered?.runId) {
      router.replace(`/workspace/conversations/${conversationId}/runs/${recovered.runId}`);
      submissionStore.clearOperation();
      return;
    }
    setOperation(recovered);
  }, [conversationId, router, submissionStore]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (restoreSequence.current !== undefined && orderedMessages.length > 0) {
      const action = resolveScrollRestoration({
        savedSequence: restoreSequence.current,
        loadedSequences: orderedMessages.map((message) => message.sequence),
        hasOlder: messages.hasNextPage,
      });
      if (action.kind === 'restore') {
        const anchor = viewport.querySelector<HTMLElement>(
          `[data-message-sequence="${action.sequence}"]`,
        );
        if (anchor) viewport.scrollTop = anchor.offsetTop;
        restoreSequence.current = undefined;
      } else if (action.kind === 'load-older' && !messages.isFetchingNextPage) {
        void messages.fetchNextPage();
      } else if (action.kind === 'discard') {
        restoreSequence.current = undefined;
      }
      return;
    }
    if (prependAnchor.current) {
      viewport.scrollTop = preservePrependAnchor({
        scrollTop: prependAnchor.current.scrollTop,
        scrollHeightBefore: prependAnchor.current.scrollHeightBefore,
        scrollHeightAfter: viewport.scrollHeight,
      });
      prependAnchor.current = undefined;
    } else if (previousNewestSequence.current === 0 && newestSequence > 0) {
      viewport.scrollTop = viewport.scrollHeight;
    } else if (previousNewestSequence.current > 0
      && newestSequence > previousNewestSequence.current) {
      if (nearBottom.current) viewport.scrollTop = viewport.scrollHeight;
      else setHasNewContent(true);
    }
    previousNewestSequence.current = newestSequence;
  }, [messages, newestSequence, orderedMessages]);

  async function loadOlder(): Promise<void> {
    const viewport = viewportRef.current;
    if (viewport) {
      prependAnchor.current = {
        scrollTop: viewport.scrollTop,
        scrollHeightBefore: viewport.scrollHeight,
      };
    }
    await messages.fetchNextPage();
  }

  function handleScroll(): void {
    const viewport = viewportRef.current;
    if (!viewport) return;
    nearBottom.current = contentArrivalAction(viewport) === 'follow';
    if (nearBottom.current) setHasNewContent(false);
    const visible = [...viewport.querySelectorAll<HTMLElement>('[data-message-sequence]')]
      .findLast((message) => message.offsetTop <= viewport.scrollTop + 1);
    if (visible?.dataset.messageSequence) {
      try {
        window.sessionStorage.setItem(
          `cmaster.workspace.conversation.${conversationId}.scroll-sequence.v1`,
          visible.dataset.messageSequence,
        );
      } catch {
        // Scroll context persistence is best effort and contains no Message content.
      }
    }
  }

  function showNewContent(): void {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    nearBottom.current = true;
    setHasNewContent(false);
  }

  async function rename(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!renameStore) return;
    const title = titleInput.trim();
    if (!title || title.length > 200) return;
    setRenameFeedback(undefined);
    try {
      const coordinator = new ConversationRenameCoordinator(api, renameStore, () => crypto.randomUUID());
      const renamed = await coordinator.rename(conversationId, title);
      queryClient.setQueryData(['conversation', conversationId], renamed);
      await queryClient.invalidateQueries({ queryKey: ['workspace', 'conversations'] });
      setEditingTitle(false);
      setRenameFeedback(text.renamed);
    } catch {
      setRenameFeedback(text.renameFailed);
    }
  }

  function changeDraft(value: string): void {
    if (operation) return;
    setDraft(value);
    setComposerFeedback(value.length > maximumMessageLength ? text.overLimit : undefined);
    try {
      submissionStore?.saveDraft(value);
    } catch {
      setComposerFeedback(text.submissionFailed);
    }
  }

  async function submit(): Promise<void> {
    if (!submissionStore || submitting || runControlsUnavailable) return;
    if (!draft.trim()) { setComposerFeedback(text.blank); return; }
    if (draft.length > maximumMessageLength) { setComposerFeedback(text.overLimit); return; }
    setSubmitting(true);
    setComposerFeedback(undefined);
    const coordinator = new ContinuingSubmissionCoordinator(
      submissionApi, submissionStore, () => crypto.randomUUID(),
    );
    try {
      const completed = await coordinator.submit(conversationId, draft);
      router.push(`/workspace/conversations/${conversationId}/runs/${completed.runId}`);
      coordinator.acknowledge();
    } catch {
      const saved = submissionStore.loadOperation();
      setOperation(saved);
      setComposerFeedback(saved?.kind === 'continue' && saved.messageId
        ? text.messageSaved : text.submissionFailed);
      setSubmitting(false);
    }
  }

  const runAgain = useCallback(async (messageId: string): Promise<void> => {
    if (!submissionStore || runControlsUnavailable
      || (operation && (operation.kind !== 'run-again' || operation.messageId !== messageId))) return;
    const coordinator = new ContinuingSubmissionCoordinator(
      submissionApi, submissionStore, () => crypto.randomUUID(),
    );
    try {
      const completed = await coordinator.runAgain(conversationId, messageId);
      router.push(`/workspace/conversations/${conversationId}/runs/${completed.runId}`);
      coordinator.acknowledge();
    } catch {
      setOperation(submissionStore.loadOperation());
      setComposerFeedback(text.runAgainFailed);
    }
  }, [
    conversationId, operation, router, runControlsUnavailable, submissionApi,
    submissionStore, text.runAgainFailed,
  ]);

  const failed = conversation.isError || messages.isError || runs.isError;
  const composerGuidance = composerFeedback
    ?? (activeRunCount > 0 ? text.composerBlocked : !draft.trim() ? text.blank : '');

  const Root = embedded ? 'section' : 'main';
  return (
    <Root className="conversation-overview"
      {...(embedded ? { 'aria-label': text.thread } : {})}>
      <Link href="/workspace" className="workspace-back">← {text.back}</Link>
      {failed ? <p className="error" role="alert">{text.failed}</p> : null}
      {!failed && conversation.isPending ? <p role="status">{text.loading}</p> : null}
      {conversation.data ? (
        <header>
          {editingTitle ? (
            <form onSubmit={(event) => void rename(event)}>
              <label htmlFor="conversation-title">{text.titleLabel}</label>
              <input id="conversation-title" value={titleInput} maxLength={200}
                onChange={(event) => setTitleInput(event.target.value)} autoFocus />
              <button className="button" type="submit">{text.saveTitle}</button>
              <button className="button secondary" type="button"
                onClick={() => setEditingTitle(false)}>{text.cancelRename}</button>
            </form>
          ) : (
            <>
              <h1 ref={conversationHeadingRef} tabIndex={-1}>
                {conversation.data.title ?? text.untitled}
              </h1>
              <button className="button secondary" type="button" onClick={() => {
                setTitleInput(renameStore?.load()?.title ?? conversation.data?.title ?? '');
                setEditingTitle(true);
              }}>{text.rename}</button>
            </>
          )}
          {renameFeedback ? <p role="status">{renameFeedback}</p> : null}
          {activeRunCount > 1 ? <p role="status">{text.activeRuns(activeRunCount)}</p> : null}
          {defaultRunId ? (
            <span className="sr-only">{text.selectedRun}: {defaultRunId}</span>
          ) : null}
        </header>
      ) : null}
      <div className="conversation-thread-scroll" ref={viewportRef} onScroll={handleScroll}>
        <ConversationThread
          conversationId={conversationId}
          locale={locale}
          messages={orderedMessages}
          runs={runItems}
          canLoadOlder={messages.hasNextPage}
          canLoadOlderRuns={runs.hasNextPage}
          hasNewContent={hasNewContent}
          canRunAgain={!runControlsUnavailable && operation?.kind !== 'continue'}
          {...(defaultRunId ? { selectedRunId: defaultRunId } : {})}
          {...(operation?.kind === 'run-again'
            ? { recoveringRunMessageId: operation.messageId } : {})}
          commands={{
            loadOlder: () => void loadOlder(),
            loadOlderRuns: () => void runs.fetchNextPage(),
            showNewContent,
            runAgain: (messageId) => void runAgain(messageId),
          }}
        />
      </div>
      <section aria-label={text.composer}>
        {operation?.kind === 'continue' && operation.messageId ? (
          <article className="message saved-message" aria-label={text.messageSaved}>
            <strong>{text.employee}</strong>
            <p>{draft}</p>
            <small>{text.messageSaved}</small>
          </article>
        ) : null}
        <PromptInput viewModel={{
          value: draft,
          disabled: submitting || runControlsUnavailable || operation?.kind === 'run-again',
          readOnly: operation?.kind === 'continue',
          submitting,
          overLimit: draft.length > maximumMessageLength,
          placeholder: text.placeholder,
          sendLabel: submitting ? text.sending : operation ? text.continue : text.send,
        }} commands={{ onChange: changeDraft, onSubmit: () => void submit() }} />
        <p id="composer-feedback" role={composerFeedback ? 'alert' : 'status'}>
          {composerGuidance}
        </p>
      </section>
    </Root>
  );
}
