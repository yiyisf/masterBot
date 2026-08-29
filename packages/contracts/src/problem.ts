import { z } from 'zod';

export const problemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string(),
  detail: z.string(),
  instance: z.string(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
