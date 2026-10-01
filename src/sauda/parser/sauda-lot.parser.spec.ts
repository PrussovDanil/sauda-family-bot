import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LotMismatchError } from '../errors/lot-mismatch.error';
import { LotPageParseError } from '../errors/lot-page-parse.error';
import type { LotReference } from '../models/lot-reference';
import { parseMoney, SaudaLotParser } from './sauda-lot.parser';

const reference: LotReference = {
  lotNumber: '460051',
  publicationId: '336027172806000000',
  url: 'https://sauda.e-qazyna.kz/ru/list/336027172806000000',
};

function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'test/fixtures', name), 'utf8');
}

const fixture = readFixture('sauda-lot-460051.html');

describe('SaudaLotParser', () => {
  const parser = new SaudaLotParser();

  it('parses lot 460051 from a saved lot page', () => {
    const lot = parser.parse(fixture, reference);

    expect(lot).toMatchObject({
      ...reference,
      title: 'Нежилое помещение, г. Кентау, ул. Абылайхана №20/1.',
      auctionType: 'Аукцион на понижение цены (с 17.01.2021 года)',
      status: 'Прием заявок',
      startingPrice: {
        amount: '30229644.00',
        currency: 'KZT',
        sourceRaw: '₸ 30 229 644,00',
      },
      deposit: {
        amount: '1511483.00',
        currency: 'KZT',
        sourceRaw: '1 511 483,00 ₸',
      },
      auctionStartsAtRaw: '10.09.2026 10:00',
      description: 'Нежилое помещение площадью 58,3 кв. м.',
      address: 'Туркестанская область, г. Кентау, ул. Абылайхана 20/1',
      seller: 'ГУ «Отдел экономики и финансов города Кентау»',
      documents: [
        {
          title: 'Отчет об оценке.PDF',
          extension: '.pdf',
          url: 'https://sauda.e-qazyna.kz/ru/MnuFileStoreFileDownload?FileId=fixture-document',
        },
      ],
    });
    expect(lot.parsedAt).toEqual(expect.any(String));
  });

  it.each([
    ['₸ 30 229 644,00', '30229644.00'],
    ['1 511 483,00 ₸', '1511483.00'],
    ['500 ₸', '500'],
  ])('normalizes %s without JavaScript number conversion', (input, amount) => {
    expect(parseMoney(input)).toEqual({
      amount,
      currency: 'KZT',
      sourceRaw: input,
    });
  });

  it('preserves source whitespace and normalizes a very large fractional value exactly', () => {
    const input = '  ₸ 123 456 789 012 345 678 901 234 567 890,123400  ';

    expect(parseMoney(input)).toEqual({
      amount: '123456789012345678901234567890.123400',
      currency: 'KZT',
      sourceRaw: input,
    });
  });

  it.each(['-1 ₸', 'не определена', '1,2,3 ₸'])(
    'rejects invalid or negative money value %s',
    (input) => {
      expect(() => parseMoney(input)).toThrow(LotPageParseError);
    },
  );

  it('allows optional fields and the document section to be absent', () => {
    expect(
      parser.parse(readFixture('sauda-lot-optional-missing.html'), reference),
    ).toMatchObject({
      deposit: undefined,
      description: undefined,
      documents: [],
    });
  });

  it('throws when the lot number differs from the reference', () => {
    expect(() =>
      parser.parse(fixture.replace('№ 460051', '№ 460052'), reference),
    ).toThrow(LotMismatchError);
  });

  it('rejects a page without the primary lot details block', () => {
    expect(() =>
      parser.parse(readFixture('sauda-lot-invalid-page.html'), reference),
    ).toThrow('Primary lot details block is missing or ambiguous');
  });

  it('rejects a lot when a required field is missing', () => {
    expect(() =>
      parser.parse(readFixture('sauda-lot-missing-required.html'), reference),
    ).toThrow('Lot status is missing from the lot page');
  });

  it('rejects an invalid required money value', () => {
    expect(() =>
      parser.parse(readFixture('sauda-lot-invalid-money.html'), reference),
    ).toThrow(LotPageParseError);
  });

  it('rejects document URLs outside the Sauda domain allowlist', () => {
    expect(() =>
      parser.parse(readFixture('sauda-lot-external-document.html'), reference),
    ).toThrow(
      'Electronic document URL points outside the allowed Sauda domain',
    );
  });
});
