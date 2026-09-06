import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './conversations.js';

export const artifactMediaTypeSchema = z.string().min(1).max(200);
export const artifactVersionSchema = z.object({
  id: uuidSchema,
  artifactId: uuidSchema,
  versionNumber: z.number().int().positive(),
  mediaType: artifactMediaTypeSchema,
  sizeBytes: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
});
export const artifactSchema = z.object({
  id: uuidSchema,
  title: z.string().min(1).max(200),
  kind: z.string().min(1).max(100),
  currentVersionNumber: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
});
export const artifactViewSchema = z.object({
  artifact: artifactSchema,
  versions: z.array(artifactVersionSchema).min(1),
});
export const artifactContentHeadersSchema = z.object({
  'accept-ranges': z.literal('bytes'),
  'content-length': z.string().regex(/^\d+$/),
  'content-type': artifactMediaTypeSchema,
  'content-range': z.string().regex(/^bytes \d+-\d+\/\d+$/).optional(),
});

export type ArtifactContract = z.infer<typeof artifactSchema>;
export type ArtifactVersionContract = z.infer<typeof artifactVersionSchema>;
export type ArtifactViewContract = z.infer<typeof artifactViewSchema>;
