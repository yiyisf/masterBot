import createClient from 'openapi-fetch';
import type { paths } from './generated/openapi.js';

export type ContractClient = ReturnType<typeof createClient<paths>>;

export function createContractClient(baseUrl: string): ContractClient {
  return createClient<paths>({ baseUrl, credentials: 'include' });
}

export async function readArtifactVersionContent(
  baseUrl: string,
  reference: { artifactId: string; artifactVersionId: string },
): Promise<string> {
  const client = createContractClient(baseUrl);
  const result = await client.GET(
    '/api/v1/artifacts/{artifactId}/versions/{artifactVersionId}/content',
    { params: { path: reference, header: {} } },
  );
  if (result.data === undefined) throw new Error('Artifact content could not be read');
  return result.data;
}
