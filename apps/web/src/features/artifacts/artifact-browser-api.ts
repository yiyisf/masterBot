import {
  createContractClient,
  readArtifactVersionContent,
  type ArtifactPageContract,
  type ArtifactVersionContract,
  type ArtifactVersionPageContract,
} from '@cmaster/contracts';

export interface ArtifactBrowserApi {
  list(cursor: string | undefined, limit: number): Promise<ArtifactPageContract>;
  listVersions(
    artifactId: string,
    beforeVersionNumber: number | undefined,
    limit: number,
  ): Promise<ArtifactVersionPageContract>;
  getVersion(artifactId: string, artifactVersionId: string): Promise<ArtifactVersionContract>;
  readContent(artifactId: string, artifactVersionId: string): Promise<string>;
}

export function createArtifactBrowserApi(
  baseUrl: string,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): ArtifactBrowserApi {
  const client = createContractClient(baseUrl, fetchImplementation);
  return {
    async list(cursor, limit) {
      const result = await client.GET('/api/v1/artifacts', {
        params: { query: { ...(cursor ? { cursor } : {}), limit } },
      });
      if (!result.data) throw new Error('artifact_library_unavailable');
      return result.data;
    },
    async listVersions(artifactId, beforeVersionNumber, limit) {
      const result = await client.GET('/api/v1/artifacts/{artifactId}/versions', {
        params: {
          path: { artifactId },
          query: { ...(beforeVersionNumber === undefined ? {} : { beforeVersionNumber }), limit },
        },
      });
      if (!result.data) throw new Error('artifact_versions_unavailable');
      return result.data;
    },
    async getVersion(artifactId, artifactVersionId) {
      const result = await client.GET(
        '/api/v1/artifacts/{artifactId}/versions/{artifactVersionId}',
        { params: { path: { artifactId, artifactVersionId } } },
      );
      if (!result.data) throw new Error('artifact_version_unavailable');
      return result.data;
    },
    readContent(artifactId, artifactVersionId) {
      return readArtifactVersionContent(
        baseUrl, { artifactId, artifactVersionId }, fetchImplementation,
      );
    },
  };
}
