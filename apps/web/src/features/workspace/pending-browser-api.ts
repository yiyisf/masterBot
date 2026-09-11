import {
  createContractClient,
  type PendingInterruptPageContract,
} from '@cmaster/contracts';

export interface PendingBrowserApi {
  list(cursor: string | undefined, limit: number): Promise<PendingInterruptPageContract>;
}

export function createPendingBrowserApi(
  baseUrl: string,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): PendingBrowserApi {
  const client = createContractClient(baseUrl, fetchImplementation);
  return {
    async list(cursor, limit) {
      const result = await client.GET('/api/v1/workspace/interrupts', {
        params: { query: { ...(cursor ? { cursor } : {}), limit } },
      });
      if (!result.data) throw new Error('pending_interactions_unavailable');
      return result.data;
    },
  };
}
