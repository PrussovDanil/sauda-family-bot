import { z } from 'zod';

export const cloudAnalysisSchema = z
  .object({
    summary: z.string().min(1).max(2000),
    risks: z
      .array(
        z
          .object({
            severity: z.enum(['high', 'medium', 'low']),
            title: z.string().min(1).max(300),
            evidence: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .max(12),
    missingInformation: z.array(z.string().min(1).max(500)).max(12),
    recommendedChecks: z.array(z.string().min(1).max(500)).max(12),
    disclaimer: z.string().min(1).max(1000),
  })
  .strict();

export type CloudAnalysis = z.infer<typeof cloudAnalysisSchema>;

export const cloudAnalysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['severity', 'title', 'evidence'],
      },
    },
    missingInformation: { type: 'array', items: { type: 'string' } },
    recommendedChecks: { type: 'array', items: { type: 'string' } },
    disclaimer: { type: 'string' },
  },
  required: [
    'summary',
    'risks',
    'missingInformation',
    'recommendedChecks',
    'disclaimer',
  ],
} as const;
