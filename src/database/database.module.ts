import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { SaudaModule } from '../sauda/sauda.module';
import { DatabaseService } from './database.service';
import { SQLITE_DATABASE_PATH } from './database.constants';
import { MigrationRunnerService } from './migrations/migration-runner.service';
import { PersistenceService } from './persistence.service';
import { DocumentRepository } from './repositories/document.repository';
import { LotRepository } from './repositories/lot.repository';

@Module({
  imports: [DocumentsModule, SaudaModule],
  providers: [
    {
      provide: SQLITE_DATABASE_PATH,
      useFactory: () => process.env.SQLITE_DATABASE_PATH,
    },
    DatabaseService,
    MigrationRunnerService,
    LotRepository,
    DocumentRepository,
    PersistenceService,
  ],
  exports: [
    DatabaseService,
    LotRepository,
    DocumentRepository,
    PersistenceService,
  ],
})
export class DatabaseModule {}
