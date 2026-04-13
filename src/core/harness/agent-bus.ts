/**
 * AgentBus — 跨 Agent 实例事件总线
 * Phase 23: Managed Agents Harness
 *
 * 基于 EventEmitter 的 pub/sub + request-reply 机制，
 * 允许 Agent 实例间异步通信，无需共享内存。
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';

export type BusPayload = unknown;

export interface BusMessage {
    id: string;
    topic: string;
    payload: BusPayload;
    from: string;     // instanceId 或 'system'
    ts: Date;
    /** request-reply 模式：响应应发到这个 topic */
    replyTo?: string;
}

export class AgentBus extends EventEmitter {
    private static instance: AgentBus;

    static getInstance(): AgentBus {
        if (!AgentBus.instance) AgentBus.instance = new AgentBus();
        return AgentBus.instance;
    }

    /** 广播事件到 topic */
    publish(topic: string, payload: BusPayload, from: string, replyTo?: string): void {
        const msg: BusMessage = { id: nanoid(), topic, payload, from, ts: new Date(), replyTo };
        this.emit(`topic:${topic}`, msg);
        this.emit('*', msg);  // 全量监听
    }

    /** 订阅 topic，返回取消订阅函数 */
    subscribe(
        topic: string,
        handler: (msg: BusMessage) => void,
        subscriberId: string
    ): () => void {
        const eventName = `topic:${topic}`;
        const wrapped = (msg: BusMessage) => {
            if (msg.from !== subscriberId) handler(msg);  // 不接收自己发的
        };
        this.on(eventName, wrapped);
        return () => this.off(eventName, wrapped);
    }

    /**
     * Request-Reply 模式
     * 发送消息并等待第一个匹配 `${topic}.reply.${msgId}` 的响应。
     * 超时返回 null。
     */
    async request<T = BusPayload>(
        topic: string,
        payload: BusPayload,
        from: string,
        timeoutMs = 30_000
    ): Promise<T | null> {
        return new Promise((resolve) => {
            const msgId = nanoid();
            const replyTopic = `${topic}.reply.${msgId}`;

            const timer = setTimeout(() => {
                this.removeAllListeners(`topic:${replyTopic}`);
                resolve(null);
            }, timeoutMs);

            this.once(`topic:${replyTopic}`, (msg: BusMessage) => {
                clearTimeout(timer);
                resolve(msg.payload as T);
            });

            // 将 replyTo 放在消息顶层字段，handler 可直接读取
            this.publish(topic, payload, from, replyTopic);
        });
    }

    /** 回复 request 请求 */
    reply(replyTopic: string, payload: BusPayload, from: string): void {
        this.publish(replyTopic, payload, from);
    }
}

export const agentBus = AgentBus.getInstance();
