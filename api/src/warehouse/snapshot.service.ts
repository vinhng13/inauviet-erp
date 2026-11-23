import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { addDays, formatDateOnly, todayInZone } from '../common/utils/dates';
import { dateField } from '../common/utils/input';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';

/** Ngày xa nhất được chụp bù khi bộ hẹn giờ chạy lần đầu */
const MAX_BACKFILL_DAYS = 370;

/**
 * Bản chụp tồn cuối ngày của từng kho. Sau khi hết một ngày, ghi tồn của mọi quy cách tính theo phiếu đã xác nhận
 * có ngày đến hết ngày đó. Bản chụp không đổi về sau, kể cả khi có phiếu bổ sung về ngày cũ.
 */
@Injectable()
export class WhSnapshotService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('WhSnapshot');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (!(this.env.WH_SNAPSHOT_TIMER ?? this.env.NODE_ENV !== 'test')) return;
    this.timer = setInterval(() => void this.run().catch((e) => this.log.error(e)), 60 * 60 * 1000);
    setTimeout(() => void this.run().catch((e) => this.log.error(e)), 15_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Chụp mọi ngày đã kết thúc mà chưa có bản chụp (đến hết hôm qua). Trả về số ngày và số dòng đã ghi. */
  async run(): Promise<{ days: number; rows: number }> {
    if (this.running) return { days: 0, rows: 0 };
    this.running = true;
    try {
      const yesterday = addDays(todayInZone(this.env.APP_TIMEZONE), -1);
      const warehouses = await this.prisma.whWarehouse.findMany();
      let days = 0;
      let rows = 0;
      for (const w of warehouses) {
        const stocks = await this.prisma.whStock.findMany({ where: { warehouseId: w.id }, select: { specId: true } });
        if (!stocks.length) continue;
        const last = await this.prisma.whDailyStock.findFirst({ where: { warehouseId: w.id }, orderBy: { date: 'desc' }, select: { date: true } });
        let start: string;
        if (last) start = addDays(formatDateOnly(last.date)!, 1);
        else {
          const first = await this.prisma.whSlip.findFirst({ where: { warehouseId: w.id }, orderBy: { date: 'asc' }, select: { date: true } });
          start = first ? formatDateOnly(first.date)! : todayInZone(this.env.APP_TIMEZONE, w.createdAt);
        }
        const floor = addDays(yesterday, -MAX_BACKFILL_DAYS);
        if (start < floor) start = floor;
        for (let d = start; d <= yesterday; d = addDays(d, 1)) {
          const qty = await this.stock.ledgerAsOf(this.prisma, w.id, d);
          const res = await this.prisma.whDailyStock.createMany({
            data: stocks.map((s) => ({ date: dateField(d, 'date'), warehouseId: w.id, specId: s.specId, qty: qty.get(s.specId) ?? 0 })),
            skipDuplicates: true,
          });
          days++;
          rows += res.count;
        }
      }
      if (days) this.log.log(`Saved end-of-day stock for ${days} day(s), ${rows} row(s)`);
      return { days, rows };
    } finally {
      this.running = false;
    }
  }
}
