import { Injectable } from '@nestjs/common';
import type { SaudaLot } from './sauda-lot';
import { SaudaLotLoaderService } from './sauda-lot-loader.service';
import { SaudaLotParser } from './sauda-lot.parser';
import { SaudaLotResolverService } from './sauda-lot-resolver.service';

@Injectable()
export class SaudaService {
  constructor(
    private readonly resolver: SaudaLotResolverService,
    private readonly loader: SaudaLotLoaderService,
    private readonly parser: SaudaLotParser,
  ) {}

  async getLot(lotNumber: string): Promise<SaudaLot> {
    const reference = await this.resolver.resolve(lotNumber);
    const html = await this.loader.loadLotPage(reference.url);
    return this.parser.parse(html, reference);
  }
}
