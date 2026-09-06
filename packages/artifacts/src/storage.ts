import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, link, mkdir, open, readdir, readFile, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OrganizationId } from '@cmaster/identity';
import type { ArtifactVersion } from './types.js';
import { ArtifactInputInvalidError } from './types.js';

export interface StoreArtifactContent {
  readonly organizationId: OrganizationId;
  readonly invocationId: string;
  readonly content: string;
  readonly mediaType: ArtifactVersion['mediaType'];
}

export interface StoredArtifactContent {
  readonly storageAdapter: 'local-content-addressed-v1';
  readonly storageRef: string;
  readonly contentHash: string;
  readonly mediaType: ArtifactVersion['mediaType'];
  readonly sizeBytes: number;
}

/** Content storage seam; references are opaque outside the owning Artifacts adapter. */
export interface ArtifactContentStore {
  write(input: StoreArtifactContent): Promise<StoredArtifactContent>;
  read(storageRef: string): AsyncIterable<Uint8Array>;
  cleanupStaging(olderThan: Date): Promise<number>;
}

function validateBytes(content: string, bytes: Buffer): void {
  if (bytes.toString('utf8') !== content) {
    throw new ArtifactInputInvalidError('Artifact content must be valid UTF-8');
  }
  if (bytes.byteLength > 48 * 1024) {
    throw new ArtifactInputInvalidError('Artifact content exceeds 48 KiB');
  }
}

/** Local content-addressed adapter with exclusive staging and atomic immutable promotion. */
export class LocalArtifactContentStore implements ArtifactContentStore {
  constructor(private readonly root: string) {}

  async write(input: StoreArtifactContent): Promise<StoredArtifactContent> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.invocationId)) {
      throw new ArtifactInputInvalidError('Artifact Invocation ID is invalid');
    }
    const stagingDirectory = join(this.root, 'staging', input.invocationId);
    await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
    const stagingPath = join(stagingDirectory, randomUUID());
    const handle = await open(stagingPath, 'wx', 0o600);
    const bytes = Buffer.from(input.content, 'utf8');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      if (input.mediaType !== 'text/plain; charset=utf-8'
        && input.mediaType !== 'text/markdown; charset=utf-8') {
        throw new ArtifactInputInvalidError('Artifact media type is unsupported');
      }
      validateBytes(input.content, bytes);
    } finally {
      await handle.close();
    }

    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const storageRef = `blobs/sha256/${contentHash.slice(0, 2)}/${contentHash.slice(2, 4)}/${contentHash}`;
    const blobPath = join(this.root, storageRef);
    await mkdir(dirname(blobPath), { recursive: true, mode: 0o700 });
    try {
      await link(stagingPath, blobPath);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    await unlink(stagingPath);
    await access(blobPath, constants.R_OK);
    return {
      storageAdapter: 'local-content-addressed-v1',
      storageRef,
      contentHash,
      mediaType: input.mediaType,
      sizeBytes: bytes.byteLength,
    };
  }

  async *read(storageRef: string): AsyncIterable<Uint8Array> {
    if (!/^blobs\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(storageRef)) {
      throw new Error('Stored Artifact reference is invalid');
    }
    const bytes = await readFile(join(this.root, storageRef));
    const expectedHash = storageRef.slice(storageRef.lastIndexOf('/') + 1);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash) throw new Error('Stored Artifact content failed integrity validation');
    yield bytes;
  }

  async cleanupStaging(olderThan: Date): Promise<number> {
    const root = join(this.root, 'staging');
    let removed = 0;
    let invocationDirectories;
    try {
      invocationDirectories = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return 0;
      throw error;
    }
    for (const directory of invocationDirectories) {
      if (!directory.isDirectory()) continue;
      const directoryPath = join(root, directory.name);
      for (const file of await readdir(directoryPath, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        const path = join(directoryPath, file.name);
        if ((await stat(path)).mtime < olderThan) {
          await rm(path, { force: true });
          removed += 1;
        }
      }
    }
    return removed;
  }
}
