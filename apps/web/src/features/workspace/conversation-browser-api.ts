import {
  createContractClient,
  type ConversationContract,
  type ConversationRunPageContract,
  type MessagePageContract,
} from '@cmaster/contracts';

export interface ConversationBrowserApi {
  getConversation(conversationId: string): Promise<ConversationContract>;
  getMessages(conversationId: string, beforeSequence?: number): Promise<MessagePageContract>;
  getRuns(conversationId: string, cursor?: string): Promise<ConversationRunPageContract>;
  findRename(conversationId: string, commandId: string): Promise<ConversationContract | undefined>;
  rename(conversationId: string, commandId: string, title: string): Promise<ConversationContract>;
}

function requireData<Value>(value: Value | undefined, code: string): Value {
  if (value === undefined) throw new Error(code);
  return value;
}

export function createConversationBrowserApi(
  baseUrl: string,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): ConversationBrowserApi {
  const client = createContractClient(baseUrl, fetchImplementation);
  return {
    async getConversation(conversationId) {
      const result = await client.GET('/api/v1/conversations/{conversationId}', {
        params: { path: { conversationId } },
      });
      return requireData(result.data, 'conversation_unavailable');
    },
    async getMessages(conversationId, beforeSequence) {
      const result = await client.GET('/api/v1/conversations/{conversationId}/messages', {
        params: {
          path: { conversationId },
          query: { limit: 50, ...(beforeSequence === undefined ? {} : { beforeSequence }) },
        },
      });
      return requireData(result.data, 'messages_unavailable');
    },
    async getRuns(conversationId, cursor) {
      const result = await client.GET('/api/v1/conversations/{conversationId}/runs', {
        params: {
          path: { conversationId },
          query: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
        },
      });
      return requireData(result.data, 'runs_unavailable');
    },
    async findRename(conversationId, commandId) {
      const result = await client.GET(
        '/api/v1/conversations/{conversationId}/rename-commands/{commandId}',
        { params: { path: { conversationId, commandId } } },
      );
      if (result.data) return result.data;
      if (result.response.status === 404) return undefined;
      throw new Error('rename_reconciliation_failed');
    },
    async rename(conversationId, commandId, title) {
      const result = await client.PATCH('/api/v1/conversations/{conversationId}', {
        params: {
          path: { conversationId },
          header: { 'idempotency-key': commandId },
        },
        body: { title },
      });
      return requireData(result.data, 'rename_failed');
    },
  };
}
