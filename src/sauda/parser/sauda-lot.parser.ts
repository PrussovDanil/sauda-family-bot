import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import Decimal from 'decimal.js';
import { LotMismatchError } from '../errors/lot-mismatch.error';
import { LotPageParseError } from '../errors/lot-page-parse.error';
import type { LotReference } from '../models/lot-reference';
import type { LotDocument, Money, SaudaLot } from '../models/sauda-lot';

const SAUDA_ORIGIN = 'https://sauda.e-qazyna.kz';
const MAIN_LOT_CARD_SELECTOR = '.card.d-none.d-sm-block .card-body';
const LOT_NUMBER_PATTERN = /^№\s*(\d+)$/;

export function normalizeText(value: string): string {
  return value.replace(/[\s\u00a0]+/g, ' ').trim();
}

export function parseMoney(value: string | undefined): Money | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeText(value)
    .replace(/₸/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new LotPageParseError(`Invalid money value: ${value}`);
  }

  let decimal: Decimal;
  try {
    decimal = new Decimal(normalized);
  } catch {
    throw new LotPageParseError(`Invalid money value: ${value}`);
  }

  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new LotPageParseError(`Invalid money value: ${value}`);
  }

  const fractionDigits = normalized.split('.')[1]?.length ?? 0;
  return {
    amount: decimal.toFixed(fractionDigits),
    currency: 'KZT',
    sourceRaw: value,
  };
}

@Injectable()
export class SaudaLotParser {
  parse(html: string, reference: LotReference): SaudaLot {
    const $ = cheerio.load(html);
    this.assertPageStructure($);
    const lotNumber = this.extractLotNumber($);

    if (!lotNumber) {
      throw new LotPageParseError('Lot number is missing from the lot page');
    }
    if (lotNumber !== reference.lotNumber) {
      throw new LotMismatchError(reference.lotNumber, lotNumber);
    }

    const title = this.extractTitle($);
    if (!title) {
      throw new LotPageParseError('Lot title is missing from the lot page');
    }

    const status = this.extractStatus($);
    if (!status) {
      throw new LotPageParseError('Lot status is missing from the lot page');
    }

    const startingPrice = this.extractStartingPrice($);
    if (!startingPrice) {
      throw new LotPageParseError(
        'Lot starting price is missing from the lot page',
      );
    }

    const auctionStartsAtRaw = this.extractAuctionDate($);
    if (!auctionStartsAtRaw) {
      throw new LotPageParseError(
        'Lot auction date is missing from the lot page',
      );
    }

    return {
      lotNumber: reference.lotNumber,
      publicationId: reference.publicationId,
      url: reference.url,
      title,
      auctionType: this.extractAuctionType($),
      status,
      startingPrice,
      deposit: this.extractDeposit($),
      auctionStartsAtRaw,
      description: this.extractDescription($),
      address: this.extractAddress($),
      seller: this.extractSeller($),
      documents: this.extractDocuments($),
      parsedAt: new Date().toISOString(),
    };
  }

  extractTitle($: cheerio.CheerioAPI): string | undefined {
    return this.firstText(
      $,
      `${MAIN_LOT_CARD_SELECTOR} div.font-16.font-weight-900.text-dark`,
    );
  }

  extractLotNumber($: cheerio.CheerioAPI): string | undefined {
    return $(`${MAIN_LOT_CARD_SELECTOR} span`)
      .toArray()
      .map((element) => normalizeText($(element).text()))
      .map((text) => text.match(LOT_NUMBER_PATTERN)?.[1])
      .find((lotNumber): lotNumber is string => Boolean(lotNumber));
  }

  extractAuctionType($: cheerio.CheerioAPI): string | undefined {
    return $(`${MAIN_LOT_CARD_SELECTOR} span.font-weight-700`)
      .toArray()
      .map((element) => normalizeText($(element).text()))
      .find((text) => text.startsWith('Аукцион '));
  }

  extractStartingPrice($: cheerio.CheerioAPI): Money | undefined {
    return parseMoney(this.moneyValueInLabeledBlock($, 'Стартовая цена'));
  }

  extractDeposit($: cheerio.CheerioAPI): Money | undefined {
    return parseMoney(this.moneyValueInLabeledBlock($, 'Гарантийный взнос'));
  }

  extractAuctionDate($: cheerio.CheerioAPI): string | undefined {
    return this.valueInLabeledBlock($, 'Начало торгов');
  }

  extractDescription($: cheerio.CheerioAPI): string | undefined {
    return this.textAfterExactLabel($, 'Объект продажи');
  }

  extractAddress($: cheerio.CheerioAPI): string | undefined {
    return this.textAfterExactLabel($, 'Расположение объекта');
  }

  extractSeller($: cheerio.CheerioAPI): string | undefined {
    return this.textAfterExactLabel($, 'Продавец');
  }

  extractDocuments($: cheerio.CheerioAPI): LotDocument[] {
    const headings = $('p')
      .toArray()
      .filter(
        (element) =>
          normalizeText($(element).text()) === 'Электронные документы',
      );
    if (headings.length === 0) {
      return [];
    }
    if (headings.length !== 1) {
      throw new LotPageParseError(
        'Electronic documents section is ambiguous on the lot page',
      );
    }

    const documentSection = $(headings[0]).closest('.mt-3');
    if (documentSection.length !== 1) {
      throw new LotPageParseError(
        'Electronic documents section has an invalid structure',
      );
    }

    return documentSection
      .find('a')
      .toArray()
      .map((element) => {
        const title = normalizeText($(element).text());
        const href = $(element).attr('href');
        if (!title || !href) {
          throw new LotPageParseError(
            'Electronic document link is missing a title or URL',
          );
        }

        const extension = title.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase();
        return {
          title,
          url: this.toSafeDocumentUrl(href),
          ...(extension ? { extension } : {}),
        };
      });
  }

  private extractStatus($: cheerio.CheerioAPI): string | undefined {
    return this.valueAfterInlineLabel($, 'Статус торгов:');
  }

  private firstText(
    $: cheerio.CheerioAPI,
    selector: string,
  ): string | undefined {
    const text = $(selector)
      .toArray()
      .map((element) => normalizeText($(element).text()))
      .find(Boolean);
    return text || undefined;
  }

  private valueInLabeledBlock(
    $: cheerio.CheerioAPI,
    label: string,
  ): string | undefined {
    const labelElement = $(MAIN_LOT_CARD_SELECTOR)
      .find('p, div')
      .toArray()
      .find(
        (element) =>
          normalizeText($(element).clone().children().remove().end().text()) ===
          label,
      );
    if (!labelElement) {
      return undefined;
    }

    const ownBlockText = normalizeText($(labelElement).text());
    if (ownBlockText !== label) {
      return normalizeText(ownBlockText.slice(label.length)) || undefined;
    }

    const blockText = normalizeText($(labelElement).closest('.row').text());
    return normalizeText(blockText.slice(label.length)) || undefined;
  }

  private moneyValueInLabeledBlock(
    $: cheerio.CheerioAPI,
    label: string,
  ): string | undefined {
    const labelElement = $(MAIN_LOT_CARD_SELECTOR)
      .find('p, div')
      .toArray()
      .find(
        (element) =>
          normalizeText($(element).clone().children().remove().end().text()) ===
          label,
      );
    if (!labelElement) {
      return undefined;
    }

    const nestedValue = $(labelElement)
      .children()
      .toArray()
      .map((element) => $(element).text().trim())
      .find(Boolean);
    if (nestedValue) {
      return nestedValue;
    }

    return $(labelElement)
      .siblings()
      .toArray()
      .map((element) => $(element).text().trim())
      .find(Boolean);
  }

  private valueAfterInlineLabel(
    $: cheerio.CheerioAPI,
    label: string,
  ): string | undefined {
    const text = $(MAIN_LOT_CARD_SELECTOR)
      .find('div')
      .toArray()
      .map((element) => {
        const ownText = normalizeText(
          $(element).clone().children().remove().end().text(),
        );
        return ownText === label ? normalizeText($(element).text()) : undefined;
      })
      .find((value): value is string => Boolean(value));
    return text
      ? normalizeText(text.slice(label.length)) || undefined
      : undefined;
  }

  private textAfterExactLabel(
    $: cheerio.CheerioAPI,
    label: string,
  ): string | undefined {
    const labelElement = $('p')
      .toArray()
      .find((element) => normalizeText($(element).text()) === label);
    return labelElement
      ? normalizeText($(labelElement).next('p').text()) || undefined
      : undefined;
  }

  private assertPageStructure($: cheerio.CheerioAPI): void {
    if ($(MAIN_LOT_CARD_SELECTOR).length !== 1) {
      throw new LotPageParseError(
        'Primary lot details block is missing or ambiguous',
      );
    }
  }

  private toSafeDocumentUrl(href: string): string {
    let url: URL;
    try {
      url = new URL(href, SAUDA_ORIGIN);
    } catch {
      throw new LotPageParseError('Electronic document URL is invalid');
    }

    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      (hostname !== 'e-qazyna.kz' && !hostname.endsWith('.e-qazyna.kz'))
    ) {
      throw new LotPageParseError(
        'Electronic document URL points outside the allowed Sauda domain',
      );
    }

    return url.toString();
  }
}
