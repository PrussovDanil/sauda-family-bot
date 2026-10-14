import { z } from 'zod';
import { DEFAULT_DATABASE_PATH } from '../database/database.constants';

const configuredValue = z
  .string()
  .trim()
  .min(1, 'is required')
  .refine((value) => !value.startsWith('replace-with-'), 'must be replaced');

const commaSeparatedTelegramIds = z
  .string()
  .refine(
    (value) =>
      value.trim() === '' ||
      value.split(',').every((id) => /^\d+$/.test(id.trim())),
    'must be empty or contain comma-separated numeric Telegram user IDs',
  );

const environmentSchema = z
  .looseObject({
    TELEGRAM_BOT_TOKEN: configuredValue,
    TELEGRAM_ALLOWED_USER_IDS: commaSeparatedTelegramIds.default(''),
    SQLITE_DATABASE_PATH: z
      .string()
      .trim()
      .min(1, 'must not be empty')
      .default(DEFAULT_DATABASE_PATH),
    OPENAI_ANALYSIS_ENABLED: z.enum(['true', 'false']).default('false'),
    OPENAI_AUTH_MODE: z.enum(['api_key', 'chatgpt']).default('api_key'),
    OPENAI_API_KEY: z.string().trim().optional(),
    OPENAI_MODEL: z.string().trim().optional(),
    OPENAI_CHATGPT_CREDENTIAL_KEY: z.string().trim().optional(),
    OPENAI_CHATGPT_CREDENTIAL_PATH: z
      .string()
      .trim()
      .min(1, 'must not be empty')
      .default('./data/openai-chatgpt.enc.json'),
  })
  .superRefine((environment, context) => {
    if (environment.OPENAI_ANALYSIS_ENABLED !== 'true') {
      return;
    }
    if (
      environment.OPENAI_AUTH_MODE === 'api_key' &&
      (!environment.OPENAI_API_KEY ||
        environment.OPENAI_API_KEY.startsWith('replace-with-'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'is required when OPENAI_ANALYSIS_ENABLED=true',
      });
    }
    if (environment.OPENAI_AUTH_MODE === 'chatgpt') {
      const encoded = environment.OPENAI_CHATGPT_CREDENTIAL_KEY;
      const validKey =
        encoded &&
        !encoded.startsWith('replace-with-') &&
        Buffer.from(encoded, 'base64').length === 32;
      if (!validKey) {
        context.addIssue({
          code: 'custom',
          path: ['OPENAI_CHATGPT_CREDENTIAL_KEY'],
          message: 'must be a base64-encoded 32-byte key in chatgpt mode',
        });
      }
    }
    if (
      !environment.OPENAI_MODEL ||
      environment.OPENAI_MODEL.startsWith('replace-with-')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['OPENAI_MODEL'],
        message: 'is required when OPENAI_ANALYSIS_ENABLED=true',
      });
    }
  });

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const result = environmentSchema.safeParse(environment);
  if (result.success) {
    return result.data;
  }

  const invalidFields = Array.from(
    new Set(result.error.issues.map((issue) => String(issue.path[0]))),
  ).join(', ');
  throw new Error(`Invalid environment configuration: ${invalidFields}`);
}
