import { Test } from '@nestjs/testing';
import { SQLITE_DATABASE_PATH } from '../database/database.constants';
import { IngestionModule } from './ingestion.module';

describe('IngestionModule', () => {
  it('composes Sauda, documents, and database providers without a module cycle', async () => {
    const module = await Test.createTestingModule({
      imports: [IngestionModule],
    })
      .overrideProvider(SQLITE_DATABASE_PATH)
      .useValue(':memory:')
      .compile();

    await module.init();
    await module.close();
  });
});
