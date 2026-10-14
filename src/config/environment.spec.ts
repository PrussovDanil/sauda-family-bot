import { validateEnvironment } from './environment';

const validEnvironment = {
  TELEGRAM_BOT_TOKEN: 'telegram-token',
  TELEGRAM_ALLOWED_USER_IDS: '42, 314',
  SQLITE_DATABASE_PATH: './data/test.sqlite',
  OPENAI_ANALYSIS_ENABLED: 'false',
};

describe('validateEnvironment', () => {
  it('accepts cloud analysis disabled without OpenAI credentials', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject(
      validEnvironment,
    );
  });

  it('requires OpenAI credentials when cloud analysis is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        OPENAI_ANALYSIS_ENABLED: 'true',
      }),
    ).toThrow(
      'Invalid environment configuration: OPENAI_API_KEY, OPENAI_MODEL',
    );
  });

  it('rejects an invalid allowlist without exposing its value', () => {
    const invalidAllowlist = '42,not-a-user-id';

    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        TELEGRAM_ALLOWED_USER_IDS: invalidAllowlist,
      }),
    ).toThrow('Invalid environment configuration: TELEGRAM_ALLOWED_USER_IDS');

    try {
      validateEnvironment({
        ...validEnvironment,
        TELEGRAM_ALLOWED_USER_IDS: invalidAllowlist,
      });
    } catch (error) {
      expect(String(error)).not.toContain(invalidAllowlist);
    }
  });

  it.each([
    ['TELEGRAM_BOT_TOKEN', ''],
    ['TELEGRAM_BOT_TOKEN', 'replace-with-telegram-bot-token'],
    ['SQLITE_DATABASE_PATH', ''],
    ['OPENAI_ANALYSIS_ENABLED', 'yes'],
  ])('rejects invalid %s', (field, value) => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, [field]: value }),
    ).toThrow(`Invalid environment configuration: ${field}`);
  });

  it('rejects placeholder OpenAI credentials when analysis is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        OPENAI_ANALYSIS_ENABLED: 'true',
        OPENAI_API_KEY: 'replace-with-openai-api-key',
        OPENAI_MODEL: 'replace-with-model',
      }),
    ).toThrow(
      'Invalid environment configuration: OPENAI_API_KEY, OPENAI_MODEL',
    );
  });
});
