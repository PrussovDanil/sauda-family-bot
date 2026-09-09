import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SaudaLotResolverService } from './sauda-lot-resolver.service';

describe('SaudaLotResolverService', () => {
  const service = new SaudaLotResolverService();

  it('parses lot references from a saved search page and removes responsive duplicates', () => {
    const html = readFileSync(
      join(process.cwd(), 'test/fixtures/sauda-search-results.html'),
      'utf8',
    );

    expect(service.parseSearchResults(html)).toEqual([
      {
        lotNumber: '460051',
        publicationId: '336027172806000000',
        url: 'https://sauda.e-qazyna.kz/ru/list/336027172806000000',
      },
    ]);
  });
});
