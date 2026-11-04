import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { periodInZone } from '../common/utils/dates';
import type { Tx } from '../prisma/prisma.service';

export type DocumentPrefix = 'KH' | 'BG' | 'DH' | 'LSX' | 'GH';

/**
 * Human-readable document codes staff can say over the phone.
 *   KH-0001        customers (one running sequence)
 *   BG-2610-0012   quotes     (restarts each month, YYMM)
 *   DH-2610-0042   orders     (restarts each month, YYMM)
 *   LSX-2610-0014  work orders (restarts each month, YYMM)
 *   GH-2610-0011   deliveries (restarts each month, YYMM)
 * Uses one atomic upsert, so two people saving at the same moment never get the same number.
 */
@Injectable()
export class NumberingService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async next(tx: Tx, prefix: DocumentPrefix, now: Date = new Date()): Promise<string> {
    const period = prefix === 'KH' ? '' : periodInZone(this.env.APP_TIMEZONE, now);
    const rows = await tx.$queryRaw<Array<{ lastNo: number }>>`
      INSERT INTO "DocumentSequence" ("prefix", "period", "lastNo")
      VALUES (${prefix}, ${period}, 1)
      ON CONFLICT ("prefix", "period") DO UPDATE SET "lastNo" = "DocumentSequence"."lastNo" + 1
      RETURNING "lastNo"`;
    const no = String(rows[0].lastNo).padStart(4, '0');
    return period ? `${prefix}-${period}-${no}` : `${prefix}-${no}`;
  }
}
