import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { cleanText } from '../common/utils/input';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  LocationDto,
  LocationInputDto,
  WhMaterialDto,
  WhMaterialInputDto,
  MonthLockDto,
  PartnerDto,
  PartnerInputDto,
  SymbolDto,
  SymbolInputDto,
} from './warehouse.dto';
import { StockService } from './stock.service';

const unique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Danh mục riêng của Kho: đối tác, vị trí, ký hiệu khuôn, vật tư và khổ, chốt tồn tháng. */
@Injectable()
export class WhCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  async partners(): Promise<PartnerDto[]> {
    const rows = await this.prisma.whPartner.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { diesHeld: true } } },
    });
    return rows.map((p) => ({ id: p.id, name: p.name, kind: p.kind, phone: p.phone, note: p.note, isActive: p.isActive, diesHeld: p._count.diesHeld }));
  }

  async savePartner(id: string | null, dto: PartnerInputDto): Promise<void> {
    const data = { name: dto.name.trim(), kind: dto.kind, phone: cleanText(dto.phone), note: cleanText(dto.note), isActive: dto.isActive ?? true };
    try {
      if (id) await this.prisma.whPartner.update({ where: { id }, data });
      else await this.prisma.whPartner.create({ data });
    } catch (e) {
      if (unique(e)) throw DomainError.conflict('WH_PARTNER_EXISTS', 'A partner with this name exists');
      throw e;
    }
  }

  async locations(): Promise<LocationDto[]> {
    const rows = await this.prisma.whLocation.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }], include: { _count: { select: { dies: true } } } });
    return rows.map((l) => ({ id: l.id, code: l.code, note: l.note, isActive: l.isActive, dies: l._count.dies }));
  }

  async saveLocation(id: string | null, dto: LocationInputDto): Promise<void> {
    const data = { code: dto.code.trim(), note: cleanText(dto.note), isActive: dto.isActive ?? true };
    try {
      if (id) await this.prisma.whLocation.update({ where: { id }, data });
      else await this.prisma.whLocation.create({ data });
    } catch (e) {
      if (unique(e)) throw DomainError.conflict('WH_LOCATION_EXISTS', 'This location code exists');
      throw e;
    }
  }

  async symbols(): Promise<SymbolDto[]> {
    const rows = await this.prisma.whDieSymbol.findMany({ orderBy: { code: 'asc' }, include: { _count: { select: { dies: true } } } });
    return rows.map((s) => ({ code: s.code, name: s.name, isActive: s.isActive, lastNo: s.lastNo, dies: s._count.dies }));
  }

  async saveSymbol(dto: SymbolInputDto): Promise<void> {
    await this.prisma.whDieSymbol.upsert({
      where: { code: dto.code },
      create: { code: dto.code, name: dto.name.trim(), isActive: dto.isActive ?? true },
      update: { name: dto.name.trim(), isActive: dto.isActive ?? true },
    });
  }

  async materials(): Promise<WhMaterialDto[]> {
    const [rows, items] = await Promise.all([
      this.prisma.whMaterial.findMany({ orderBy: [{ group: 'asc' }, { name: 'asc' }] }),
      this.stock.items(true),
    ]);
    return rows.map((m) => ({
      id: m.id,
      group: m.group,
      name: m.name,
      unit: m.unit,
      hasSizes: m.hasSizes,
      isActive: m.isActive,
      items: items.filter((i) => i.materialId === m.id),
    }));
  }

  /** Vật tư và danh sách khổ. "27x23" và "27 x 23" là một khổ: khổ lưu hai số, không tạo trùng. */
  async saveMaterial(id: string | null, dto: WhMaterialInputDto): Promise<void> {
    const sizes = dto.hasSizes ? dto.sizes : [{ widthCm: 0, lengthCm: 0, minQty: dto.sizes[0]?.minQty ?? null, id: dto.sizes[0]?.id }];
    if (dto.hasSizes && sizes.some((s) => !s.widthCm || !s.lengthCm)) {
      throw DomainError.badRequest('WH_SIZE_REQUIRED', 'Each size needs width and length');
    }
    const keys = sizes.map((s) => `${s.widthCm}x${s.lengthCm}`);
    if (new Set(keys).size !== keys.length) throw DomainError.badRequest('WH_SIZE_DUPLICATE', 'The same size is listed twice');
    try {
      await this.prisma.$transaction(async (tx) => {
        const data = { group: dto.group.trim(), name: dto.name.trim(), unit: dto.unit.trim(), hasSizes: dto.hasSizes, isActive: dto.isActive ?? true };
        const m = id ? await tx.whMaterial.update({ where: { id }, data }) : await tx.whMaterial.create({ data });
        for (const s of sizes) {
          const values = { widthCm: s.widthCm, lengthCm: s.lengthCm, minQty: s.minQty ?? null, isActive: s.isActive ?? true };
          if (s.id) {
            const cur = await tx.whStockItem.findFirst({ where: { id: s.id, materialId: m.id } });
            if (!cur) throw DomainError.notFound('WhStockItem', s.id);
            const sizeChanged = Number(cur.widthCm) !== s.widthCm || Number(cur.lengthCm) !== s.lengthCm;
            if (sizeChanged && (await tx.whSlipLine.count({ where: { stockItemId: s.id } }))) {
              throw DomainError.conflict('WH_SIZE_IN_USE', 'A size that already has slips cannot be changed; add a new size instead');
            }
            await tx.whStockItem.update({ where: { id: s.id }, data: values });
          } else {
            await tx.whStockItem.upsert({
              where: { materialId_widthCm_lengthCm: { materialId: m.id, widthCm: s.widthCm, lengthCm: s.lengthCm } },
              create: { materialId: m.id, ...values },
              update: values,
            });
          }
        }
      });
    } catch (e) {
      if (unique(e)) throw DomainError.conflict('WH_MATERIAL_EXISTS', 'This material already exists in the group');
      throw e;
    }
  }

  async monthLocks(): Promise<MonthLockDto[]> {
    const rows = await this.prisma.whMonthLock.findMany({ orderBy: { month: 'desc' }, include: { lockedBy: { select: { fullName: true } } } });
    return rows.map((r) => ({ month: r.month, lockedBy: r.lockedBy.fullName, lockedAt: r.lockedAt }));
  }

  async lockMonth(month: string, actor: AuthUser): Promise<void> {
    await this.prisma.whMonthLock.upsert({ where: { month }, create: { month, lockedById: actor.id }, update: {} });
  }

  async unlockMonth(month: string): Promise<void> {
    await this.prisma.whMonthLock.deleteMany({ where: { month } });
  }
}
