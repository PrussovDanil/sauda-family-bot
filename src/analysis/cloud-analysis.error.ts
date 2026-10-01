export class CloudAnalysisError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = CloudAnalysisError.name;
  }
}
