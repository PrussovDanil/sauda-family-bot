export class SaudaUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Sauda search page is unavailable', { cause });
    this.name = SaudaUnavailableError.name;
  }
}
