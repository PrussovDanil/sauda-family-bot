export class SaudaSearchParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = SaudaSearchParseError.name;
  }
}
