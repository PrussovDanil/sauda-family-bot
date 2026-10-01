import { DatabaseService } from '../database.service';
import { MigrationRunnerService } from './migration-runner.service';
import { migrations } from './migrations';

function createDatabaseAtVersion(version: 1 | 2 | 3): DatabaseService {
  const database = new DatabaseService(':memory:');
  database.onModuleInit();
  database.connection.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of migrations.slice(0, version)) {
    migration.up(database.connection);
    database.connection
      .prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      )
      .run(migration.version, migration.name, '2026-10-01T00:00:00.000Z');
  }

  return database;
}

function insertLegacyRows(database: DatabaseService): void {
  database.connection
    .prepare(
      `
      INSERT INTO lots (
        publication_id, lot_number, url, title,
        starting_price_amount, starting_price_currency,
        deposit_amount, deposit_currency,
        parsed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      'legacy-publication',
      '460260',
      'https://sauda.e-qazyna.kz/lot',
      'Legacy lot',
      '1234567890.12',
      'KZT',
      '100.50',
      'KZT',
      'now',
      'now',
      'now',
    );
  database.connection
    .prepare(
      `
      INSERT INTO documents (
        sha256, extraction_status, quality_reasons_json,
        requires_cloud_recognition, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    )
    .run('a'.repeat(64), 'success', '[]', 0, 'now', 'now');
}

function readMoneyColumns(database: DatabaseService): string[] {
  return (
    database.connection
      .prepare('PRAGMA table_info(lots)')
      .all() as unknown as Array<{ name: string }>
  ).map((column) => column.name);
}

describe('MigrationRunnerService', () => {
  it.each([1, 2, 3] as const)(
    'upgrades an existing version %s database without losing old rows',
    (version) => {
      const database = createDatabaseAtVersion(version);
      insertLegacyRows(database);

      new MigrationRunnerService(database).onModuleInit();

      expect(readMoneyColumns(database)).toEqual(
        expect.arrayContaining(['starting_price_raw', 'deposit_raw']),
      );
      expect(
        database.connection
          .prepare(
            `
            SELECT starting_price_amount, starting_price_raw,
                   deposit_amount, deposit_raw
            FROM lots WHERE publication_id = ?
          `,
          )
          .get('legacy-publication'),
      ).toEqual({
        starting_price_amount: '1234567890.12',
        starting_price_raw: null,
        deposit_amount: '100.50',
        deposit_raw: null,
      });
      expect(
        database.connection
          .prepare('SELECT COUNT(*) AS count FROM documents')
          .get(),
      ).toEqual({ count: 1 });
      expect(
        database.connection
          .prepare('SELECT version FROM schema_migrations ORDER BY version')
          .all(),
      ).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
      ]);
      expect(
        database.connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cloud_analysis_cache'",
          )
          .get(),
      ).toEqual({ name: 'cloud_analysis_cache' });
      database.onModuleDestroy();
    },
  );

  it('rolls back all statements when the version 3 migration fails', () => {
    const database = createDatabaseAtVersion(2);
    database.connection.exec('ALTER TABLE lots ADD COLUMN deposit_raw TEXT;');

    expect(() => new MigrationRunnerService(database).onModuleInit()).toThrow(
      'Could not apply migration 3',
    );

    expect(readMoneyColumns(database)).not.toContain('starting_price_raw');
    expect(readMoneyColumns(database)).toContain('deposit_raw');
    expect(
      database.connection
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all(),
    ).toEqual([{ version: 1 }, { version: 2 }]);
    database.onModuleDestroy();
  });
});
