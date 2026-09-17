import { Injectable } from '@nestjs/common';
import type { SaudaLot } from '../../sauda/models/sauda-lot';
import { DatabaseService } from '../database.service';
import type { StoredLot } from '../models/stored-lot';

interface LotRow {
  id: number;
  publication_id: string;
  lot_number: string;
  url: string;
  title: string;
  parsed_at: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class LotRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  upsertLot(lot: SaudaLot): StoredLot {
    const now = new Date().toISOString();
    this.databaseService.connection
      .prepare(`
        INSERT INTO lots (
          publication_id, lot_number, url, title, auction_type, status,
          starting_price_amount, starting_price_currency, deposit_amount,
          deposit_currency, auction_starts_at_raw, description, address, seller,
          parsed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(publication_id) DO UPDATE SET
          lot_number = excluded.lot_number,
          url = excluded.url,
          title = excluded.title,
          auction_type = excluded.auction_type,
          status = excluded.status,
          starting_price_amount = excluded.starting_price_amount,
          starting_price_currency = excluded.starting_price_currency,
          deposit_amount = excluded.deposit_amount,
          deposit_currency = excluded.deposit_currency,
          auction_starts_at_raw = excluded.auction_starts_at_raw,
          description = excluded.description,
          address = excluded.address,
          seller = excluded.seller,
          parsed_at = excluded.parsed_at,
          updated_at = excluded.updated_at
      `)
      .run(
        lot.publicationId,
        lot.lotNumber,
        this.removeToken(lot.url),
        lot.title,
        lot.auctionType ?? null,
        lot.status ?? null,
        lot.startingPrice?.amount ?? null,
        lot.startingPrice?.currency ?? null,
        lot.deposit?.amount ?? null,
        lot.deposit?.currency ?? null,
        lot.auctionStartsAtRaw ?? null,
        lot.description ?? null,
        lot.address ?? null,
        lot.seller ?? null,
        lot.parsedAt,
        now,
        now,
      );

    return this.findByPublicationId(lot.publicationId)!;
  }

  findByPublicationId(publicationId: string): StoredLot | undefined {
    const row = this.databaseService.connection
      .prepare('SELECT * FROM lots WHERE publication_id = ?')
      .get(publicationId) as LotRow | undefined;
    return row ? this.toStoredLot(row) : undefined;
  }

  findLatestByLotNumber(lotNumber: string): StoredLot | undefined {
    const row = this.databaseService.connection
      .prepare(
        'SELECT * FROM lots WHERE lot_number = ? ORDER BY parsed_at DESC, id DESC LIMIT 1',
      )
      .get(lotNumber) as LotRow | undefined;
    return row ? this.toStoredLot(row) : undefined;
  }

  private toStoredLot(row: LotRow): StoredLot {
    return {
      id: row.id,
      publicationId: row.publication_id,
      lotNumber: row.lot_number,
      url: row.url,
      title: row.title,
      parsedAt: row.parsed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private removeToken(value: string): string {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (key.toLowerCase() === 'token') {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  }
}
