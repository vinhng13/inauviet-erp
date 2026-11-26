import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain-error';
import { cleanText } from '../common/utils/input';
import { Prisma, type WhWarehouse } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { WarehouseDto, WarehouseInputDto } from './warehouse.dto';
import { freeWarehouseCode } from './wh-common';

/**
 * Danh mục kho: một danh sách chung cho kho của Âu Việt và kho ngoài (xưởng bế, nơi làm khuôn…).
 * Kho nào cũng giữ được cả vật tư lẫn khuôn; không có thủ kho, phiếu có hiệu lực ngay khi lưu.
 */
@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  people(): Promise<Array<{ id: string; fullName: string }>> {
    return this.prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
  }

  async list(includeInactive = true): Promise<WarehouseDto[]> {
    const rows = await this.prisma.whWarehouse.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { _count: { select: { materials: true } } },
      orderBy: [{ ownership: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    const [low, dies] = await Promise.all([
      this.prisma.$queryRaw<Array<{ warehouseId: string; n: number }>>`
        SELECT s."warehouseId", COUNT(*)::int AS n FROM "WhStock" s
        JOIN "WhSpec" p ON p."id" = s."specId" JOIN "WhMaterial" m ON m."id" = p."materialId"
        WHERE s."isActive" AND p."isActive" AND m."isActive" AND s."minQty" IS NOT NULL AND s."qty" < s."minQty"
        GROUP BY s."warehouseId"`,
      this.prisma.whDie.groupBy({ by: ['warehouseId'], where: { status: { notIn: ['DISPOSED', 'TRANSIT', 'INCOMING'] } }, _count: { _all: true } }),
    ]);
    return rows.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      ownership: w.ownership,
      address: w.address,
      phone: w.phone,
      note: w.note,
      isActive: w.isActive,
      sortOrder: w.sortOrder,
      materials: w._count.materials,
      dies: dies.find((d) => d.warehouseId === w.id)?._count._all ?? 0,
      low: low.find((l) => l.warehouseId === w.id)?.n ?? 0,
    }));
  }

  async save(id: string | null, dto: WarehouseInputDto): Promise<void> {
    const name = dto.name.normalize('NFC').trim().replace(/\s+/g, ' ');
    const data = {
      name,
      ownership: dto.ownership ?? 'AU_VIET',
      address: cleanText(dto.address),
      phone: cleanText(dto.phone),
      note: cleanText(dto.note),
      isActive: dto.isActive ?? true,
      // không gửi thứ tự thì giữ thứ tự cũ (kho mới: cuối danh sách)
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const same = await tx.whWarehouse.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
        if (same) throw DomainError.conflict('WH_WAREHOUSE_EXISTS', 'A warehouse with this name exists');
        if (id) {
          const cur = await tx.whWarehouse.findUnique({ where: { id } });
          if (!cur) throw DomainError.notFound('WhWarehouse', id);
          const code = dto.code?.trim().toUpperCase() || cur.code;
          if (cur.code !== code && (await tx.whSlip.count({ where: { warehouseId: id } }))) {
            throw DomainError.conflict('WH_WAREHOUSE_CODE_USED', 'The code of a warehouse that has slips cannot change');
          }
          await tx.whWarehouse.update({ where: { id }, data: { ...data, code } });
        } else {
          const last = await tx.whWarehouse.aggregate({ _max: { sortOrder: true } });
          const code = dto.code?.trim() ? dto.code.trim().toUpperCase() : await freeWarehouseCode(tx, name);
          await tx.whWarehouse.create({ data: { sortOrder: (last._max.sortOrder ?? 0) + 10, ...data, code } });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw DomainError.conflict('WH_WAREHOUSE_EXISTS', 'A warehouse with this code exists');
      }
      throw e;
    }
  }

  /** Kho đang dùng (giữ được cả vật tư lẫn khuôn) */
  async stockWarehouse(tx: Tx | PrismaService, id: string): Promise<WhWarehouse> {
    const w = await tx.whWarehouse.findUnique({ where: { id } });
    if (!w) throw DomainError.notFound('WhWarehouse', id);
    if (!w.isActive) throw DomainError.badRequest('WH_WAREHOUSE_INACTIVE', 'This warehouse is not in use');
    return w;
  }

  /** Như stockWarehouse, dùng cho khuôn */
  dieWarehouse(tx: Tx | PrismaService, id: string): Promise<WhWarehouse> {
    return this.stockWarehouse(tx, id);
  }
}
