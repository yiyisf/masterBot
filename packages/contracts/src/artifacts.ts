import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '#internal/conversations';

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
export const artifactSummarySchema = z.object({
  artifact: artifactSchema,
  currentVersion: artifactVersionSchema,
}).superRefine((value, context) => {
  if (value.currentVersion.artifactId !== value.artifact.id
    || value.currentVersion.versionNumber !== value.artifact.currentVersionNumber) {
    context.addIssue({
      code: 'custom', path: ['currentVersion'],
      message: 'Current Version must be pinned to this Artifact',
    });
  }
});
export const artifactPageSchema = z.object({
  items: z.array(artifactSummarySchema).max(50),
  nextCursor: z.string().min(1).nullable(),
});
export const artifactVersionPageSchema = z.object({
  artifact: artifactSchema,
  items: z.array(artifactVersionSchema).max(50),
  beforeVersionNumber: z.number().int().positive().nullable(),
}).superRefine((value, context) => {
  if (value.items.some((version) => version.artifactId !== value.artifact.id)) {
    context.addIssue({
      code: 'custom', path: ['items'],
      message: 'Every Version must belong to this Artifact',
    });
  }
});
export const artifactContentHeadersSchema = z.object({
  'accept-ranges': z.literal('bytes'),
  'content-length': z.string().regex(/^\d+$/),
  'content-type': artifactMediaTypeSchema,
  'content-range': z.string().regex(/^bytes \d+-\d+\/\d+$/).optional(),
  'content-disposition': z.string().min(1).max(500)
    .refine((value) => !/[\r\n]/u.test(value), 'Invalid Content-Disposition').optional(),
  'x-content-type-options': z.literal('nosniff'),
});

export type ArtifactContract = z.infer<typeof artifactSchema>;
export type ArtifactVersionContract = z.infer<typeof artifactVersionSchema>;
export type ArtifactViewContract = z.infer<typeof artifactViewSchema>;
export type ArtifactSummaryContract = z.infer<typeof artifactSummarySchema>;
export type ArtifactPageContract = z.infer<typeof artifactPageSchema>;
export type ArtifactVersionPageContract = z.infer<typeof artifactVersionPageSchema>;
