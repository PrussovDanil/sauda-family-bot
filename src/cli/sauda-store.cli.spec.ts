import type { LotAnalysisSaveResult } from '../database/persistence.service';
import { createStoreOutput, getStoreExitCode } from './sauda-store-output';

function createResult(
  overrides: Partial<LotAnalysisSaveResult> = {},
): LotAnalysisSaveResult {
  return {
    lotId: 1,
    documentsFound: 2,
    processedDocuments: 2,
    uniqueDocuments: 2,
    newDocuments: 2,
    reusedDocuments: 0,
    duplicateDocuments: 0,
    unsupportedDocuments: 0,
    failedDocuments: 0,
    unchangedDocuments: 0,
    updatedDocuments: 0,
    isPartial: false,
    ...overrides,
  };
}

describe('sauda:store output', () => {
  it('includes the full structured persistence result', () => {
    const result = createResult({
      duplicateDocuments: 1,
      unsupportedDocuments: 1,
      failedDocuments: 1,
      isPartial: true,
    });

    expect(
      createStoreOutput(
        { lotNumber: '460260', publicationId: 'publication-460260' },
        result,
      ),
    ).toEqual({
      lotNumber: '460260',
      publicationId: 'publication-460260',
      ...result,
    });
  });

  it('returns a non-zero exit code for a partial result', () => {
    expect(getStoreExitCode(createResult({ isPartial: true }))).toBe(1);
    expect(getStoreExitCode(createResult())).toBe(0);
  });
});
