const SAFE_ERROR_CODES = new Set([
  'EACCES',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOENT',
  'ETIMEDOUT',
]);

export function formatStartupError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'UnknownError';
  }
  const name =
    'name' in error && typeof error.name === 'string'
      ? error.name
      : 'UnknownError';
  const rawCode =
    'error_code' in error && typeof error.error_code === 'number'
      ? String(error.error_code)
      : 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
  const code =
    rawCode && (SAFE_ERROR_CODES.has(rawCode) || /^\d{3}$/.test(rawCode))
      ? rawCode
      : undefined;
  return code ? `${name} (${code})` : name;
}
