import type { LotAnalysisSaveResult } from '../database/persistence.service';
import type { SaudaLot } from '../sauda/models/sauda-lot';

export function createStoreOutput(
  lot: Pick<SaudaLot, 'lotNumber' | 'publicationId'>,
  result: LotAnalysisSaveResult,
): Record<string, boolean | number | string> {
  return {
    lotNumber: lot.lotNumber,
    publicationId: lot.publicationId,
    ...result,
  };
}

export function getStoreExitCode(result: LotAnalysisSaveResult): 0 | 1 {
  return result.isPartial ? 1 : 0;
}
