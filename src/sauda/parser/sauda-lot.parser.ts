import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import Decimal from 'decimal.js';
import { LotMismatchError } from '../errors/lot-mismatch.error';
import { LotPageParseError } from '../errors/lot-page-parse.error';
import type { LotReference } from '../models/lot-reference';
import type { LotDocument, Money, SaudaLot } from '../models/sauda-lot';

const SAUDA_ORIGIN = 'https://sauda.e-qazyna.kz';
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
  return { amount: decimal.toFixed(fractionDigits), currency: 'KZT' };
}

@Injectable()
export class SaudaLotParser {
  parse(html: string, reference: LotReference): SaudaLot {
    const $ = cheerio.load(html);
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

    return {
      lotNumber: reference.lotNumber,
      publicationId: reference.publicationId,
      url: reference.url,
      title,
      auctionType: this.extractAuctionType($),
      status: this.extractStatus($),
      startingPrice: this.extractStartingPrice($),
      deposit: this.extractDeposit($),
      auctionStartsAtRaw: this.extractAuctionDate($),
      description: this.extractDescription($),
      address: this.extractAddress($),
      seller: this.extractSeller($),
      documents: this.extractDocuments($),
      parsedAt: new Date().toISOString(),
    };
  }

  extractTitle($: cheerio.CheerioAPI): string | undefined {
    return this.firstText($, 'div.font-16.font-weight-900.text-dark');
  }

  extractLotNumber($: cheerio.CheerioAPI): string | undefined {
    return $('span')
      .toArray()
      .map((element) => normalizeText($(element).text()))
      .map((text) => text.match(LOT_NUMBER_PATTERN)?.[1])
      .find((lotNumber): lotNumber is string => Boolean(lotNumber));
  }

  extractAuctionType($: cheerio.CheerioAPI): string | undefined {
    return $('span.font-weight-700')
      .toArray()
      .map((element) => normalizeText($(element).text()))
      .find((text) => text.startsWith('Аукцион '));
  }

  extractStartingPrice($: cheerio.CheerioAPI): Money | undefined {
    return parseMoney(this.valueInLabeledBlock($, 'Стартовая цена'));
  }

  extractDeposit($: cheerio.CheerioAPI): Money | undefined {
    return parseMoney(this.valueInLabeledBlock($, 'Гарантийный взнос'));
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
    const heading = $('p')
      .toArray()
      .find(
        (element) =>
          normalizeText($(element).text()) === 'Электронные документы',
      );
    if (!heading) {
      return [];
    }

    const documentSection = $(heading).closest('.mt-3');
    return documentSection
      .find('a[href]')
      .toArray()
      .map((element) => {
        const title = normalizeText($(element).text());
        const href = $(element).attr('href');
        if (!title || !href) {
          return undefined;
        }

        const extension = title.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase();
        return {
          title,
          url: new URL(href, SAUDA_ORIGIN).toString(),
          ...(extension ? { extension } : {}),
        };
      })
      .filter((document): document is LotDocument => Boolean(document));
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
    const labelElement = $('p, div')
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

  private valueAfterInlineLabel(
    $: cheerio.CheerioAPI,
    label: string,
  ): string | undefined {
    const text = $('div')
      .toArray()
      .map((element) => normalizeText($(element).text()))
      .find((value) => value.startsWith(label));
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
}
