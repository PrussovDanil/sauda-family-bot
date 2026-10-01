import { formatStartupError } from './startup-error';

describe('formatStartupError', () => {
  it('keeps a safe error type and status code', () => {
    expect(formatStartupError({ name: 'GrammyError', error_code: 409 })).toBe(
      'GrammyError (409)',
    );
  });

  it('does not include messages or unknown codes', () => {
    expect(
      formatStartupError({
        name: 'Error',
        code: 'TOKEN_SECRET',
        message: 'secret-token',
      }),
    ).toBe('Error');
  });
});
