import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LotAmbiguousError } from '../errors/lot-ambiguous.error';
import { LotNotFoundError } from '../errors/lot-not-found.error';
import { SaudaSearchParseError } from '../errors/sauda-search-parse.error';
import { SaudaLotResolverService } from './sauda-lot-resolver.service';

function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'test/fixtures', name), 'utf8');
}

describe('SaudaLotResolverService', () => {
  const service = new SaudaLotResolverService();

  afterEach(() => jest.restoreAllMocks());

  it('parses lot references from a saved search page and removes responsive duplicates', () => {
    const html = readFixture('sauda-search-results.html');

    expect(service.parseSearchResults(html)).toEqual([
      {
        lotNumber: '460051',
        publicationId: '336027172806000000',
        url: 'https://sauda.e-qazyna.kz/ru/list/336027172806000000',
      },
    ]);
  });

  it('parses the current dynamic Sauda search container', () => {
    expect(
      service.parseSearchResults(readFixture('sauda-search-current.html')),
    ).toEqual([
      {
        lotNumber: '463354',
        publicationId: '337517033658000000',
        url: 'https://sauda.e-qazyna.kz/ru/list/337517033658000000',
      },
    ]);
  });

  it('resolves one publication for an unambiguous lot number', async () => {
    jest
      .spyOn(service, 'loadSearchPage')
      .mockResolvedValue(readFixture('sauda-search-results.html'));

    await expect(service.resolve('460051')).resolves.toMatchObject({
      lotNumber: '460051',
      publicationId: '336027172806000000',
    });
  });

  it('throws a dedicated error when a lot number has multiple publications', async () => {
    jest
      .spyOn(service, 'loadSearchPage')
      .mockResolvedValue(readFixture('sauda-search-ambiguous.html'));

    await expect(service.resolve('460051')).rejects.toMatchObject({
      name: LotAmbiguousError.name,
      lotNumber: '460051',
      publicationIds: ['336027172806000000', '336027172806000001'],
    });
  });

  it('reports not found only for a valid empty search result', async () => {
    jest
      .spyOn(service, 'loadSearchPage')
      .mockResolvedValue(readFixture('sauda-search-empty.html'));

    await expect(service.resolve('460051')).rejects.toBeInstanceOf(
      LotNotFoundError,
    );
  });

  it('recognizes the current Sauda empty-state marker', async () => {
    jest
      .spyOn(service, 'loadSearchPage')
      .mockResolvedValue(readFixture('sauda-search-current-empty.html'));

    await expect(service.resolve('463354')).rejects.toBeInstanceOf(
      LotNotFoundError,
    );
  });

  it('rejects a malformed result card instead of silently skipping it', () => {
    expect(() =>
      service.parseSearchResults(readFixture('sauda-search-broken-card.html')),
    ).toThrow(SaudaSearchParseError);
  });

  it('rejects a partially malformed result set instead of returning valid cards only', () => {
    expect(() =>
      service.parseSearchResults(
        readFixture('sauda-search-partially-broken.html'),
      ),
    ).toThrow(SaudaSearchParseError);
  });

  it('distinguishes changed markup from an empty result', () => {
    expect(() =>
      service.parseSearchResults(readFixture('sauda-search-invalid-page.html')),
    ).toThrow(SaudaSearchParseError);
  });
});
