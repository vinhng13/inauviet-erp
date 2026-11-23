import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { cleanText } from '../common/utils/input';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { KeeperDto, WarehouseDto, WarehouseInputDto } from './warehouse.dto';
import { canConfirmIn } from './wh-common';

const include = {
  members: { include: { user: { select: { id: true, fullName: true } } } },
  _count: { select: { materials: true } },
} satisfies Prisma.WhWarehouseInclude;

export type WarehouseWithKeepers = Prisma.WhWarehouseGetPayload<{ include: { members: true } }>;

/** Danh mục kho: tạo, sửa, thủ kho. Kho do người dùng tạo, không cố định trong code. */
@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser, includeInactive = true): Promise<WarehouseDto[]> {
    const rows = await this.prisma.whWarehouse.findMany({
      where: includeInactive ? {} : { isActive: true },
      include,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const [pending, low, dies] = await Promise.all([
      this.prisma.whSlip.groupBy({ by: ['warehouseId'], where: { status: 'PENDING' }, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ warehouseId: string; n: number }>>`
        SELECT s."warehouseId", COUNT(*)::int AS n FROM "WhStock" s
        JOIN "WhSpec" p ON p."id" = s."specId" JOIN "WhMaterial" m ON m."id" = p."materialId"
        WHERE s."isActive" AND p."isActive" AND m."isActive" AND s."minQty" IS NOT NULL AND s."qty" < s."minQty"
        GROUP BY s."warehouseId"`,
      this.prisma.whDie.groupBy({ by: ['warehouseId'], where: { holderId: null, status: { notIn: ['DISPOSED', 'TRANSIT', 'INCOMING'] } }, _count: { _all: true } }),
    ]);
    return rows.map((w) => {
      const keeperIds = w.members.map((m) => m.userId);
      return {
        id: w.id,
        code: w.code,
        name: w.name,
        address: w.address,
        kind: w.kind,
        note: w.note,
        isActive: w.isActive,
        sortOrder: w.sortOrder,
        keepers: w.members.map((m) => ({ id: m.user.id, fullName: m.user.fullName })),
        materials: w._count.materials,
        dies: dies.find((d) => d.warehouseId === w.id)?._count._all ?? 0,
        canConfirm: canConfirmIn(actor, keeperIds),
        pending: pending.find((p) => p.warehouseId === w.id)?._count._all ?? 0,
        low: low.find((l) => l.warehouseId === w.id)?.n ?? 0,
      };
    });
  }

  async save(id: string | null, dto: WarehouseInputDto): Promise<void> {
    const keeperIds = [...new Set(dto.keeperIds)];
    if (keeperIds.length) {
      const found = await this.prisma.user.count({ where: { id: { in: keeperIds }, isActive: true } });
      if (found !== keeperIds.length) throw DomainError.badRequest('WH_KEEPER_INVALID', 'A storekeeper is not an active user');
    }
    const data = {
      code: dto.code,
      name: dto.name.trim(),
      address: cleanText(dto.address),
      note: cleanText(dto.note),
      isActive: dto.isActive ?? true,
      // không gửi thứ tự thì giữ thứ tự cũ (kho mới: cuối danh sách)
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        let warehouseId = id;
        if (id) {
          const cur = await tx.whWarehouse.findUnique({ where: { id } });
          if (!cur) throw DomainError.notFound('WhWarehouse', id);
          if (cur.code !== dto.code && (await tx.whSlip.count({ where: { warehouseId: id } }))) {
            throw DomainError.conflict('WH_WAREHOUSE_CODE_USED', 'The code of a warehouse that has slips cannot change');
          }
          await tx.whWarehouse.update({ where: { id }, data });
        } else {
          const last = await tx.whWarehouse.aggregate({ _max: { sortOrder: true } });
          warehouseId = (await tx.whWarehouse.create({ data: { sortOrder: (last._max.sortOrder ?? 0) + 10, ...data, kind: dto.kind ?? 'STOCK' } })).id;
        }
        await tx.whWarehouseMember.deleteMany({ where: { warehouseId: warehouseId! } });
        if (keeperIds.length) await tx.whWarehouseMember.createMany({ data: keeperIds.map((userId) => ({ warehouseId: warehouseId!, userId })) });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw DomainError.conflict('WH_WAREHOUSE_EXISTS', 'A warehouse with this code exists');
      }
      throw e;
    }
  }

  /** Người dùng đang hoạt động, để chọn thủ kho */
  async people(): Promise<KeeperDto[]> {
    return this.prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
  }

  /** Kho đang dùng (mọi kho giữ được vật tư lẫn khuôn); kèm danh sách thủ kho */
  async stockWarehouse(tx: Tx | PrismaService, id: string): Promise<WarehouseWithKeepers> {
    const w = await tx.whWarehouse.findUnique({ where: { id }, include: { members: true } });
    if (!w) throw DomainError.notFound('WhWarehouse', id);
    if (!w.isActive) throw DomainError.badRequest('WH_WAREHOUSE_INACTIVE', 'This warehouse is not in use');
    return w;
  }

  /** Kho đang dùng, kèm thủ kho (dùng cho khuôn) */
  async dieWarehouse(tx: Tx | PrismaService, id: string): Promise<WarehouseWithKeepers> {
    const w = await tx.whWarehouse.findUnique({ where: { id }, include: { members: true } });
    if (!w) throw DomainError.notFound('WhWarehouse', id);
    if (!w.isActive) throw DomainError.badRequest('WH_WAREHOUSE_INACTIVE', 'This warehouse is not in use');
    return w;
  }

  canConfirm(actor: AuthUser, w: { members: Array<{ userId: string }> }): boolean {
    return canConfirmIn(actor, w.members.map((m) => m.userId));
  }
}
