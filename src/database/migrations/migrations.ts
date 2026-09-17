import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  up(database: DatabaseSync): void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'create-lots-and-documents',
    up(database) {
      database.exec(`
        CREATE TABLE lots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          publication_id TEXT NOT NULL UNIQUE,
          lot_number TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT NOT NULL,
          auction_type TEXT,
          status TEXT,
          starting_price_amount TEXT,
          starting_price_currency TEXT,
          deposit_amount TEXT,
          deposit_currency TEXT,
          auction_starts_at_raw TEXT,
          description TEXT,
          address TEXT,
          seller TEXT,
          parsed_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX lots_lot_number_idx ON lots(lot_number);
        CREATE TABLE documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sha256 TEXT NOT NULL UNIQUE,
          content_type TEXT,
          size_bytes INTEGER,
          page_count INTEGER,
          extracted_text TEXT,
          extraction_status TEXT NOT NULL,
          extraction_quality TEXT,
          quality_score INTEGER,
          quality_reasons_json TEXT NOT NULL DEFAULT '[]',
          requires_cloud_recognition INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE lot_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lot_id INTEGER NOT NULL,
          document_id INTEGER NOT NULL,
          source_file_id TEXT NOT NULL,
          title TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE,
          FOREIGN KEY (document_id) REFERENCES documents(id),
          UNIQUE(lot_id, source_file_id)
        );
      `);
    },
  },
];
