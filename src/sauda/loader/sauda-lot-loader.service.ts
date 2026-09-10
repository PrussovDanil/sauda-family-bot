import { Injectable } from '@nestjs/common';
import { LotPageUnavailableError } from '../errors/lot-page-unavailable.error';

@Injectable()
export class SaudaLotLoaderService {
  async loadLotPage(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new LotPageUnavailableError();
      }

      return await response.text();
    } catch (error) {
      if (error instanceof LotPageUnavailableError) {
        throw error;
      }

      throw new LotPageUnavailableError(error);
    }
  }
}
