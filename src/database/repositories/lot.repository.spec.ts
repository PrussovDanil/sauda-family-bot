import type { SaudaLot } from '../../sauda/models/sauda-lot';
import { DatabaseService } from '../database.service';
import { MigrationRunnerService } from '../migrations/migration-runner.service';
import { LotRepository } from './lot.repository';

function createLot(overrides: Partial<SaudaLot> = {}): SaudaLot {
  return {
    lotNumber: '460260',
    publicationId: 'publication-460260',
    url: 'https://sauda.e-qazyna.kz/lot?Token=secret-token',
    title: 'Lot title',
    startingPrice: { amount: '1234567890.12', currency: 'KZT' },
    deposit: { amount: '100.50', currency: 'KZT' },
    documents: [],
    parsedAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('LotRepository', () => {
  let database: DatabaseService;
  let repository: LotRepository;

  beforeEach(() => {
    database = new DatabaseService(':memory:');
    database.onModuleInit();
    new MigrationRunnerService(database).onModuleInit();
    repository = new LotRepository(database);
  });

  afterEach(() => database.onModuleDestroy());

  it('applies migrations only once', () => {
    new MigrationRunnerService(database).onModuleInit();

    const migrations = database.connection
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number };
    expect(migrations.count).toBe(1);
  });

  it('stores money as strings and removes Token from the stored URL', () => {
    const stored = repository.upsertLot(createLot());
    const row = database.connection
      .prepare(
        'SELECT starting_price_amount, deposit_amount, url FROM lots WHERE id = ?',
      )
      .get(stored.id) as {
      starting_price_amount: string;
      deposit_amount: string;
      url: string;
    };

    expect(row.starting_price_amount).toBe('1234567890.12');
    expect(row.deposit_amount).toBe('100.50');
    expect(row.url).not.toContain('secret-token');
    expect(row.url).not.toContain('Token=');
  });

  it('updates an existing lot without changing its identity', () => {
    const first = repository.upsertLot(createLot());
    const updated = repository.upsertLot(createLot({ title: 'Updated lot title' }));

    expect(updated.id).toBe(first.id);
    expect(repository.findByPublicationId('publication-460260')).toMatchObject({
      id: first.id,
      title: 'Updated lot title',
    });
    expect(repository.findLatestByLotNumber('460260')?.id).toBe(first.id);
  });

  it('enforces a unique publicationId', () => {
    repository.upsertLot(createLot());

    expect(() =>
      database.connection
        .prepare('INSERT INTO lots (publication_id, lot_number, url, title, parsed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          'publication-460260',
          'another',
          'https://sauda.e-qazyna.kz/lot',
          'Duplicate',
          '2026-09-17T00:00:00.000Z',
          '2026-09-17T00:00:00.000Z',
          '2026-09-17T00:00:00.000Z',
        ),
    ).toThrow();
  });
});
