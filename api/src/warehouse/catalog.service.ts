import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { cleanText } from '../common/utils/input';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { n, specLabel } from './wh-common';
import type {
  LocationDto,
  LocationInputDto,
  WhMaterialDto,
  WhMaterialInputDto,
  PartnerDto,
  PartnerInputDto,
  SymbolDto,
  SymbolInputDto,
} from './warehouse.dto';

const unique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Danh mục riêng của Kho: đối tác, vị trí, ký hiệu khuôn, vật tư và khổ, chốt tồn tháng. */
@Injectable()
export class WhCatalogService {
  constructor(private readonly prisma: PrismaService) {}

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
    const rows = await this.prisma.whLocation.findMany({
      orderBy: [{ isActive: 'desc' }, { warehouse: { sortOrder: 'asc' } }, { code: 'asc' }],
      include: { warehouse: { select: { name: true } }, _count: { select: { dies: { where: { holderId: null, status: { not: 'DISPOSED' } } } } } },
    });
    return rows.map((l) => ({ id: l.id, warehouseId: l.warehouseId, warehouseName: l.warehouse.name, code: l.code, note: l.note, isActive: l.isActive, dies: l._count.dies }));
  }

  async saveLocation(id: string | null, dto: LocationInputDto): Promise<void> {
    const w = await this.prisma.whWarehouse.findUnique({ where: { id: dto.warehouseId } });
    if (!w || w.kind !== 'DIE') throw DomainError.badRequest('WH_WAREHOUSE_NOT_DIE', 'Shelves belong to a die warehouse');
    const data = { warehouseId: w.id, code: dto.code.trim(), note: cleanText(dto.note), isActive: dto.isActive ?? true };
    try {
      if (id) {
        const cur = await this.prisma.whLocation.findUnique({ where: { id }, include: { _count: { select: { dies: true } } } });
        if (!cur) throw DomainError.notFound('WhLocation', id);
        if (cur.warehouseId !== w.id && cur._count.dies) throw DomainError.conflict('WH_LOCATION_HAS_DIES', 'Move the dies off this shelf before moving it to another warehouse');
        await this.prisma.whLocation.update({ where: { id }, data });
      }
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
    const [rows, totals] = await Promise.all([
      this.prisma.whMaterial.findMany({
        orderBy: [{ group: 'asc' }, { name: 'asc' }],
        include: {
          specs: { orderBy: [{ widthCm: 'asc' }, { lengthCm: 'asc' }] },
          units: { include: { spec: true }, orderBy: { createdAt: 'asc' } },
          warehouses: true,
        },
      }),
      this.prisma.$queryRaw<Array<{ materialId: string; warehouseId: string; code: string; qty: number }>>`
        SELECT p."materialId", w."id" AS "warehouseId", w."code", SUM(s."qty")::float8 AS qty
        FROM "WhStock" s JOIN "WhSpec" p ON p."id" = s."specId" JOIN "WhWarehouse" w ON w."id" = s."warehouseId"
        GROUP BY p."materialId", w."id", w."code", w."sortOrder" ORDER BY w."sortOrder"`,
    ]);
    return rows.map((m) => ({
      id: m.id,
      code: m.code,
      group: m.group,
      name: m.name,
      unit: m.unit,
      hasSizes: m.hasSizes,
      isActive: m.isActive,
      specs: m.specs.map((p) => ({ id: p.id, widthCm: n(p.widthCm), lengthCm: n(p.lengthCm), label: specLabel(p), isActive: p.isActive })),
      units: m.units.map((u) => ({ id: u.id, name: u.name, factor: n(u.factor), specId: u.specId, specLabel: u.spec ? specLabel(u.spec) : null })),
      warehouseIds: m.warehouses.map((w) => w.warehouseId),
      stocks: totals.filter((t) => t.materialId === m.id).map((t) => ({ warehouseId: t.warehouseId, warehouseCode: t.code, qty: t.qty })),
    }));
  }

  /**
   * Vật tư, quy cách, đơn vị tính và kho có vật tư, lưu một lần.
   * "27x23" và "27 x 23" là một quy cách. Mỗi kho có vật tư được tạo sẵn dòng tồn cho mọi quy cách.
   */
  async saveMaterial(id: string | null, dto: WhMaterialInputDto): Promise<void> {
    const specs = dto.hasSizes ? dto.specs : [{ id: undefined, widthCm: 0, lengthCm: 0, isActive: true }];
    if (dto.hasSizes && !specs.length) throw DomainError.badRequest('WH_SIZE_REQUIRED', 'Add at least one size');
    if (dto.hasSizes && specs.some((s) => !s.widthCm)) throw DomainError.badRequest('WH_SIZE_REQUIRED', 'Each size needs a width');
    const key = (w: number, l: number) => `${Number(w)}x${Number(l)}`;
    const keys = specs.map((s) => key(s.widthCm, s.lengthCm));
    if (new Set(keys).size !== keys.length) throw DomainError.badRequest('WH_SIZE_DUPLICATE', 'The same size is listed twice');
    const unitKeys = dto.units.map((u) => `${u.name.trim().toLowerCase()}|${u.widthCm ?? ''}|${u.lengthCm ?? ''}`);
    if (new Set(unitKeys).size !== unitKeys.length) throw DomainError.badRequest('WH_UNIT_DUPLICATE', 'The same unit is listed twice for one size');
    if (dto.units.some((u) => u.name.trim().toLowerCase() === dto.unit.trim().toLowerCase())) {
      throw DomainError.badRequest('WH_UNIT_IS_BASE', 'The base unit is already 1; do not add it again');
    }
    const warehouseIds = [...new Set(dto.warehouseIds)];
    try {
      await this.prisma.$transaction(async (tx) => {
        if (warehouseIds.length) {
          const ok = await tx.whWarehouse.count({ where: { id: { in: warehouseIds }, kind: 'STOCK' } });
          if (ok !== warehouseIds.length) throw DomainError.badRequest('WH_WAREHOUSE_NOT_STOCK', 'Materials go to stock warehouses only');
        }
        const data = {
          code: cleanText(dto.code),
          group: dto.group.trim(),
          name: dto.name.trim(),
          unit: dto.unit.trim(),
          hasSizes: dto.hasSizes,
          isActive: dto.isActive ?? true,
        };
        if (id) {
          const cur = await tx.whMaterial.findUnique({ where: { id } });
          if (!cur) throw DomainError.notFound('WhMaterial', id);
          if (cur.unit !== data.unit && (await tx.whSlipLine.count({ where: { spec: { materialId: id } } }))) {
            throw DomainError.conflict('WH_UNIT_IN_USE', 'The base unit of a material that has slips cannot change');
          }
        }
        const m = id ? await tx.whMaterial.update({ where: { id }, data }) : await tx.whMaterial.create({ data });

        // Quy cách
        const specIds: string[] = [];
        for (const s of specs) {
          const values = { widthCm: s.widthCm, lengthCm: s.lengthCm, isActive: s.isActive ?? true };
          if (s.id) {
            const cur = await tx.whSpec.findFirst({ where: { id: s.id, materialId: m.id } });
            if (!cur) throw DomainError.notFound('WhSpec', s.id);
            const sizeChanged = n(cur.widthCm) !== s.widthCm || n(cur.lengthCm) !== s.lengthCm;
            if (sizeChanged && (await tx.whSlipLine.count({ where: { specId: s.id } }))) {
              throw DomainError.conflict('WH_SIZE_IN_USE', 'A size that already has slips cannot be changed; add a new size instead');
            }
            await tx.whSpec.update({ where: { id: s.id }, data: values });
            specIds.push(s.id);
          } else {
            const p = await tx.whSpec.upsert({
              where: { materialId_widthCm_lengthCm: { materialId: m.id, widthCm: s.widthCm, lengthCm: s.lengthCm } },
              create: { materialId: m.id, ...values },
              update: values,
            });
            specIds.push(p.id);
          }
        }
        const allSpecs = await tx.whSpec.findMany({ where: { materialId: m.id } });

        // Đơn vị tính: thay cả danh sách (phiếu cũ giữ tên đơn vị và hệ số lúc lập nên không bị ảnh hưởng)
        await tx.whUnit.deleteMany({ where: { materialId: m.id, id: { notIn: dto.units.filter((u) => u.id).map((u) => u.id!) } } });
        for (const u of dto.units) {
          let specId: string | null = null;
          if (u.widthCm != null) {
            const p = allSpecs.find((x) => n(x.widthCm) === u.widthCm && n(x.lengthCm) === (u.lengthCm ?? 0));
            if (!p) throw DomainError.badRequest('WH_UNIT_SPEC_UNKNOWN', `Unit ${u.name}: size not found`);
            specId = p.id;
          }
          const values = { name: u.name.trim(), factor: u.factor, specId };
          if (u.id) await tx.whUnit.updateMany({ where: { id: u.id, materialId: m.id }, data: values });
          else await tx.whUnit.create({ data: { materialId: m.id, ...values } });
        }

        // Kho – vật tư: thêm kho mới; bỏ kho chỉ khi tồn ở kho đó bằng 0
        const linked = (await tx.whWarehouseMaterial.findMany({ where: { materialId: m.id } })).map((l) => l.warehouseId);
        for (const w of linked.filter((w) => !warehouseIds.includes(w))) {
          const left = await tx.whStock.findFirst({ where: { warehouseId: w, spec: { materialId: m.id }, qty: { not: 0 } } });
          if (left) throw DomainError.conflict('WH_MATERIAL_HAS_STOCK', 'A warehouse still holds this material; issue or transfer it first');
          await tx.whWarehouseMaterial.delete({ where: { warehouseId_materialId: { warehouseId: w, materialId: m.id } } });
          await tx.whStock.updateMany({ where: { warehouseId: w, spec: { materialId: m.id } }, data: { isActive: false } });
        }
        for (const w of warehouseIds) {
          await tx.whWarehouseMaterial.upsert({
            where: { warehouseId_materialId: { warehouseId: w, materialId: m.id } },
            create: { warehouseId: w, materialId: m.id },
            update: {},
          });
          for (const p of allSpecs) {
            await tx.whStock.upsert({ where: { warehouseId_specId: { warehouseId: w, specId: p.id } }, create: { warehouseId: w, specId: p.id }, update: { isActive: true } });
          }
        }
      });
    } catch (e) {
      if (unique(e)) throw DomainError.conflict('WH_MATERIAL_EXISTS', 'This material (or its code) already exists');
      throw e;
    }
  }
}
