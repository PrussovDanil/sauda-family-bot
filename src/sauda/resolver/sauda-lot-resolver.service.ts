import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { LotAmbiguousError } from '../errors/lot-ambiguous.error';
import { LotNotFoundError } from '../errors/lot-not-found.error';
import { SaudaSearchParseError } from '../errors/sauda-search-parse.error';
import { SaudaUnavailableError } from '../errors/sauda-unavailable.error';
import type { LotReference } from '../models/lot-reference';

const SAUDA_ORIGIN = 'https://sauda.e-qazyna.kz';
const SEARCH_PATH = '/ru/list';
const SEARCH_RESULTS_SELECTOR = '.search-results';
const LIVE_SEARCH_ROOT_SELECTOR = '[id^="form-container-MnuAuctionList"]';
const EMPTY_RESULTS_SELECTOR = '[data-search-empty], .search-results-empty';
const LIVE_EMPTY_RESULTS_TEXT = 'По вашему запросу торгов не найдено';
const LOT_BADGE_PATTERN = /^№\s*(\d+)$/;
const PUBLICATION_PATH_PATTERN = /^\/ru\/list\/(\d+)$/;

@Injectable()
export class SaudaLotResolverService {
  async resolve(lotNumber: string): Promise<LotReference> {
    if (!/^\d+$/.test(lotNumber)) {
      throw new TypeError('Lot number must contain digits only');
    }

    const html = await this.loadSearchPage(lotNumber);
    const references = this.parseSearchResults(html).filter(
      (result) => result.lotNumber === lotNumber,
    );

    if (references.length === 0) {
      throw new LotNotFoundError(lotNumber);
    }
    if (references.length > 1) {
      throw new LotAmbiguousError(
        lotNumber,
        references.map((reference) => reference.publicationId),
      );
    }

    return references[0];
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
    const resultsContainer = this.findResultsContainer($);

    const references = new Map<string, LotReference>();
    const emptyMarkers = resultsContainer.find(EMPTY_RESULTS_SELECTOR).add(
      resultsContainer.find('*').filter((_, element) => {
        const ownText = $(element).clone().children().remove().end().text();
        return normalizeBadgeText(ownText) === LIVE_EMPTY_RESULTS_TEXT;
      }),
    );
    const badgeElements = resultsContainer
      .find('span')
      .toArray()
      .filter((element) =>
        normalizeBadgeText($(element).text()).startsWith('№'),
      );

    for (const badgeElement of badgeElements) {
      const badge = normalizeBadgeText($(badgeElement).text());
      const lotNumber = badge.match(LOT_BADGE_PATTERN)?.[1];
      if (!lotNumber) {
        throw new SaudaSearchParseError(
          'Sauda search result contains an invalid lot number badge',
        );
      }

      const anchor = $(badgeElement).closest('a');
      const publicationId = this.getPublicationId(anchor.attr('href'));
      if (!publicationId) {
        throw new SaudaSearchParseError(
          `Sauda search result for lot ${lotNumber} has an invalid publication link`,
        );
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
    }

    for (const anchor of resultsContainer.find('a[href]').toArray()) {
      const href = $(anchor).attr('href');
      if (!this.isPublicationLikeLink(href)) {
        continue;
      }

      const publicationId = this.getPublicationId(href);
      const hasParsedReference = [...references.values()].some(
        (reference) => reference.publicationId === publicationId,
      );
      if (!publicationId || !hasParsedReference) {
        throw new SaudaSearchParseError(
          'Sauda search result contains a publication link without a valid lot badge',
        );
      }
    }

    if (references.size > 0 && emptyMarkers.length > 0) {
      throw new SaudaSearchParseError(
        'Sauda search page contains both results and an empty-state marker',
      );
    }
    if (references.size === 0 && emptyMarkers.length !== 1) {
      throw new SaudaSearchParseError(
        'Sauda search page contains neither valid results nor a valid empty state',
      );
    }

    return [...references.values()];
  }

  private findResultsContainer($: cheerio.CheerioAPI) {
    const legacyContainer = $(SEARCH_RESULTS_SELECTOR);
    if (legacyContainer.length === 1) {
      return legacyContainer;
    }
    if (legacyContainer.length > 1) {
      throw new SaudaSearchParseError(
        'Sauda search results container is ambiguous',
      );
    }

    const liveRoots = $(LIVE_SEARCH_ROOT_SELECTOR).filter((_, element) => {
      const id = $(element).attr('id');
      return Boolean(id && !id.endsWith('-wrapper'));
    });
    if (liveRoots.length !== 1) {
      throw new SaudaSearchParseError(
        'Sauda search results container is missing or ambiguous',
      );
    }

    const forms = liveRoots.find('form[method="get"]');
    if (forms.length !== 1) {
      throw new SaudaSearchParseError(
        'Sauda search results form is missing or ambiguous',
      );
    }

    const candidateCards = forms.children('.card').filter((_, element) => {
      const card = $(element);
      const containsPublicationLink = card
        .find('a[href]')
        .toArray()
        .some((anchor) => this.isPublicationLikeLink($(anchor).attr('href')));
      const containsEmptyState = card
        .find('*')
        .toArray()
        .some((child) => {
          const ownText = $(child).clone().children().remove().end().text();
          return normalizeBadgeText(ownText) === LIVE_EMPTY_RESULTS_TEXT;
        });
      return containsPublicationLink || containsEmptyState;
    });

    if (candidateCards.length !== 1) {
      throw new SaudaSearchParseError(
        'Sauda search result card is missing or ambiguous',
      );
    }

    return candidateCards;
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

  private isPublicationLikeLink(href: string | undefined): boolean {
    if (!href) {
      return false;
    }

    try {
      const url = new URL(href, SAUDA_ORIGIN);
      return (
        url.origin === SAUDA_ORIGIN &&
        url.pathname.startsWith(`${SEARCH_PATH}/`)
      );
    } catch {
      return false;
    }
  }
}

function normalizeBadgeText(value: string): string {
  return value.replace(/[\s\u00a0]+/g, ' ').trim();
}
