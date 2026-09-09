import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LotMismatchError } from './lot-mismatch.error';
import type { LotReference } from './lot-reference';
import { parseMoney, SaudaLotParser } from './sauda-lot.parser';

const reference: LotReference = {
  lotNumber: '460051',
  publicationId: '336027172806000000',
  url: 'https://sauda.e-qazyna.kz/ru/list/336027172806000000',
};

const fixture = readFileSync(
  join(process.cwd(), 'test/fixtures/sauda-lot-460051.html'),
  'utf8',
);

describe('SaudaLotParser', () => {
  const parser = new SaudaLotParser();

  it('parses lot 460051 from a saved lot page', () => {
    const lot = parser.parse(fixture, reference);

    expect(lot).toMatchObject({
      ...reference,
      title: 'Нежилое помещение, г. Кентау, ул. Абылайхана №20/1.',
      auctionType: 'Аукцион на понижение цены (с 17.01.2021 года)',
      status: 'Прием заявок',
      startingPrice: { amount: '30229644.00', currency: 'KZT' },
      deposit: { amount: '1511483.00', currency: 'KZT' },
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
    expect(parseMoney(input)).toEqual({ amount, currency: 'KZT' });
  });

  it('allows an absent optional field', () => {
    const htmlWithoutDeposit = fixture.replace(
      /<div class="row">\s*<div>Гарантийный взнос[\s\S]*?<\/div>\s*<\/div>/,
      '',
    );

    expect(parser.parse(htmlWithoutDeposit, reference).deposit).toBeUndefined();
  });

  it('throws when the lot number differs from the reference', () => {
    expect(() =>
      parser.parse(fixture.replace('№ 460051', '№ 460052'), reference),
    ).toThrow(LotMismatchError);
  });
});
