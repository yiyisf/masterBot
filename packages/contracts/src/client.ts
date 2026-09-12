import createClient from 'openapi-fetch';
import type { paths } from './generated/openapi.js';

export type ContractClient = ReturnType<typeof createClient<paths>>;

export function createContractClient(
  baseUrl: string,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): ContractClient {
  return createClient<paths>({
    baseUrl,
    credentials: 'include',
    fetch: fetchImplementation,
  });
}

export async function readArtifactVersionContent(
  baseUrl: string,
  reference: { artifactId: string; artifactVersionId: string },
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  const client = createContractClient(baseUrl, fetchImplementation);
  const result = await client.GET(
    '/api/v1/artifacts/{artifactId}/versions/{artifactVersionId}/content',
    {
      params: { path: reference, query: { disposition: 'inline' }, header: {} },
      parseAs: 'text',
    },
  );
  if (result.data === undefined) throw new Error('Artifact content could not be read');
  return result.data;
}
