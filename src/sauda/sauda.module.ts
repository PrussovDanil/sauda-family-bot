import { Module } from '@nestjs/common';
import { SaudaLotLoaderService } from './sauda-lot-loader.service';
import { SaudaLotParser } from './sauda-lot.parser';
import { SaudaLotResolverService } from './sauda-lot-resolver.service';
import { SaudaService } from './sauda.service';

@Module({
  providers: [
    SaudaLotResolverService,
    SaudaLotLoaderService,
    SaudaLotParser,
    SaudaService,
  ],
  exports: [SaudaLotResolverService, SaudaService],
})
export class SaudaModule {}
