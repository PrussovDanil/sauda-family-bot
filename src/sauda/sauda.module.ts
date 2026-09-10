import { Module } from '@nestjs/common';
import { SaudaLotLoaderService } from './loader/sauda-lot-loader.service';
import { SaudaLotParser } from './parser/sauda-lot.parser';
import { SaudaLotResolverService } from './resolver/sauda-lot-resolver.service';
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
