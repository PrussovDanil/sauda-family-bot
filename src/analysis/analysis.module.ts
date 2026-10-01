import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AnalysisRepository } from './analysis.repository';
import { AnalysisService } from './analysis.service';

@Module({
  imports: [DatabaseModule],
  providers: [AnalysisRepository, AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
