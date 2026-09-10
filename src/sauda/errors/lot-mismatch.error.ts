export class LotMismatchError extends Error {
  constructor(expectedLotNumber: string, actualLotNumber: string) {
    super(
      `Lot number mismatch: expected ${expectedLotNumber}, received ${actualLotNumber}`,
    );
    this.name = LotMismatchError.name;
  }
}
