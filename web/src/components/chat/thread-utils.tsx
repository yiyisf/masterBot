"use client";

import { useRef, useEffect, useMemo } from "react";
import { useThreadRuntime } from "@assistant-ui/react";
import { nanoid } from "nanoid";
import { fetchApi } from "@/lib/api";

/** 历史消息水合时每条消息的最大显示字符数，超出部分折叠提示 */
const HYDRATION_MAX_CHARS = 20_000;

/** Syncs session message history into the thread on mount */
export function ThreadHydrator({
    sessionId,
    onLoaded,
}: {
    sessionId: string;
    onLoaded: () => void;
}) {
    const thread = useThreadRuntime();
    const isHydrated = useRef(false);

    useEffect(() => {
        if (isHydrated.current) return;

        console.log(`[Hydrator] Syncing history for session ${sessionId}`);

        fetchApi<{ messages: any[] }>(`/api/sessions/${sessionId}/messages`)
            .then((data) => {
                if (isHydrated.current) return;

                if (data.messages && data.messages.length > 0) {
                    const threadMessages = data.messages.map((m) => {
                        let text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
                        if (text.length > HYDRATION_MAX_CHARS) {
                            text = text.slice(0, HYDRATION_MAX_CHARS) + `\n\n… [历史内容已折叠，共 ${text.length} 字符]`;
                        }
                        const id = m.id ? String(m.id) : nanoid();
                        const createdAt = m.createdAt ? new Date(m.createdAt) : new Date();
                        const content = [{ type: "text" as const, text }];

                        if (m.role === "assistant") {
                            return {
                                id,
                                role: "assistant" as const,
                                content,
                                status: { type: "complete" as const, reason: "stop" as const },
                                createdAt,
                                metadata: {
                                    unstable_state: null,
                                    unstable_annotations: [] as readonly never[],
                                    unstable_data: [] as readonly never[],
                                    steps: [] as readonly never[],
                                    custom: (m.metadata?.custom ?? {}) as Record<string, unknown>,
                                },
                            };
                        }
                        return {
                            id,
                            role: "user" as const,
                            content,
                            createdAt,
                            attachments: [] as readonly never[],
                            metadata: { custom: {} as Record<string, unknown> },
                        };
                    });

                    setTimeout(() => {
                        try {
                            if (typeof (thread as any).import === 'function') {
                                console.log("[Hydrator] Executing thread.import with ID-safe messages");
                                (thread as any).import({
                                    messages: threadMessages.map((msg, idx) => ({
                                        message: msg,
                                        parentId: idx === 0 ? null : threadMessages[idx - 1].id,
                                    })),
                                });
                                isHydrated.current = true;
                                console.log("[Hydrator] Sync complete");
                            } else {
                                console.warn("[Hydrator] thread.import not available");
                            }
                        } catch (err) {
                            console.error("[Hydrator] Sync failed:", err);
                        } finally {
                            onLoaded();
                        }
                    }, 800);
                } else {
                    onLoaded();
                }
            })
            .catch((err) => {
                console.error("[Hydrator] Fetch failed:", err);
                onLoaded();
            });
    }, [sessionId, thread, onLoaded]);

    return null;
}

/**
 * Reads ?prompt= from URL and auto-sends it once the thread is ready.
 * Must be rendered inside AssistantRuntimeProvider.
 */
export function PromptAutoSender({
    initPrompt,
    historyLoaded,
}: {
    initPrompt: string | null;
    historyLoaded: boolean;
}) {
    const thread = useThreadRuntime();
    const sent = useRef(false);

    useEffect(() => {
        if (!initPrompt || sent.current || !historyLoaded) return;
        sent.current = true;
        setTimeout(() => {
            try {
                thread.append({ role: "user", content: [{ type: "text", text: decodeURIComponent(initPrompt) }] });
            } catch (err) {
                console.error("[PromptAutoSender] Failed:", err);
            }
        }, 200);
    }, [initPrompt, historyLoaded, thread]);

    return null;
}
