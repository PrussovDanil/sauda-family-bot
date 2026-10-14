import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AnalysisRepository } from './analysis.repository';
import { AnalysisService } from './analysis.service';
import { ChatGptAuthService } from './chatgpt-auth.service';

@Module({
  imports: [DatabaseModule],
  providers: [AnalysisRepository, AnalysisService, ChatGptAuthService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
