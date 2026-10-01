import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DocumentsModule } from '../documents/documents.module';
import { SaudaModule } from '../sauda/sauda.module';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [SaudaModule, DocumentsModule, DatabaseModule],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
