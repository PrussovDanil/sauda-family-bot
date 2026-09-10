import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { LotNotFoundError } from '../errors/lot-not-found.error';
import type { LotReference } from '../models/lot-reference';
import { SaudaUnavailableError } from '../errors/sauda-unavailable.error';

const SAUDA_ORIGIN = 'https://sauda.e-qazyna.kz';
const SEARCH_PATH = '/ru/list';
const LOT_BADGE_PATTERN = /^№(\d+)$/;
const PUBLICATION_PATH_PATTERN = /^\/ru\/list\/(\d+)$/;

@Injectable()
export class SaudaLotResolverService {
  async resolve(lotNumber: string): Promise<LotReference> {
    if (!/^\d+$/.test(lotNumber)) {
      throw new TypeError('Lot number must contain digits only');
    }

    const html = await this.loadSearchPage(lotNumber);
    const reference = this.parseSearchResults(html).find(
      (result) => result.lotNumber === lotNumber,
    );

    if (!reference) {
      throw new LotNotFoundError(lotNumber);
    }

    return reference;
  }

  async loadSearchPage(lotNumber: string): Promise<string> {
    const searchUrl = new URL(SEARCH_PATH, SAUDA_ORIGIN);
    searchUrl.searchParams.set('auctionNumber', lotNumber);

    try {
      const response = await fetch(searchUrl, {
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new SaudaUnavailableError();
      }

      return await response.text();
    } catch (error) {
      if (error instanceof SaudaUnavailableError) {
        throw error;
      }

      throw new SaudaUnavailableError(error);
    }
  }

  parseSearchResults(html: string): LotReference[] {
    const $ = cheerio.load(html);
    const references = new Map<string, LotReference>();

    $('a[href]').each((_, anchor) => {
      const badge = $(anchor)
        .find('span')
        .toArray()
        .map((element) => $(element).text().trim())
        .find((text) => LOT_BADGE_PATTERN.test(text));

      if (!badge) {
        return;
      }

      const publicationId = this.getPublicationId($(anchor).attr('href'));
      if (!publicationId) {
        return;
      }

      const lotNumber = badge.match(LOT_BADGE_PATTERN)?.[1];
      if (!lotNumber) {
        return;
      }

      const reference: LotReference = {
        lotNumber,
        publicationId,
        url: new URL(
          `${SEARCH_PATH}/${publicationId}`,
          SAUDA_ORIGIN,
        ).toString(),
      };
      references.set(`${lotNumber}:${publicationId}`, reference);
    });

    return [...references.values()];
  }

  private getPublicationId(href: string | undefined): string | undefined {
    if (!href) {
      return undefined;
    }

    try {
      const url = new URL(href, SAUDA_ORIGIN);
      if (url.origin !== SAUDA_ORIGIN) {
        return undefined;
      }

      return url.pathname.match(PUBLICATION_PATH_PATTERN)?.[1];
    } catch {
      return undefined;
    }
  }
}
