import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { Tx } from '../prisma/prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ActivityEntryDto } from './activity.dto';

export type EntityType = 'ORDER' | 'QUOTE' | 'DELIVERY' | 'PAYMENT' | 'CUSTOMER' | 'USER' | 'ROLE' | 'PRODUCT' | 'PERIOD' | 'ACCOUNTING';

export interface ActivityInput {
  orderId?: string | null;
  entityType: EntityType;
  entityId: string;
  action: string;
  fromValue?: string | null;
  toValue?: string | null;
  data?: Record<string, unknown>;
  userId?: string | null;
}

/** Append-only history: who changed what, and when. Written inside the same transaction as the change. */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async log(tx: Tx, entry: ActivityInput): Promise<void> {
    await tx.activityLog.create({
      data: {
        orderId: entry.orderId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        fromValue: entry.fromValue ?? null,
        toValue: entry.toValue ?? null,
        data: (entry.data as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        userId: entry.userId ?? null,
      },
    });
  }

  async forOrder(orderId: string): Promise<ActivityEntryDto[]> {
    return this.find({ orderId });
  }

  async forEntity(entityType: EntityType, entityId: string): Promise<ActivityEntryDto[]> {
    return this.find({ entityType, entityId });
  }

  private async find(where: Prisma.ActivityLogWhereInput): Promise<ActivityEntryDto[]> {
    const rows = await this.prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      fromValue: r.fromValue,
      toValue: r.toValue,
      data: (r.data as Record<string, unknown> | null) ?? null,
      userName: r.user?.fullName ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
