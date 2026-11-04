import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PricingMode } from '../generated/prisma/enums';
import type { Product } from '../generated/prisma/client';
import { ActivityService } from '../activity/activity.service';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { cleanText } from '../common/utils/input';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProductDto, ProductDto, ProductQueryDto, UpdateProductDto } from './products.dto';

export function toProductDto(p: Product): ProductDto {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    pricingMode: p.pricingMode,
    unit: p.unit,
    unitPriceVnd: Number(p.unitPriceVnd),
    isActive: p.isActive,
    note: p.note,
    sortOrder: p.sortOrder,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async list(query: ProductQueryDto): Promise<ProductDto[]> {
    const rows = await this.prisma.product.findMany({
      where: {
        ...(query.active ? { isActive: true } : {}),
        ...(query.q?.trim() ? { name: { contains: query.q.trim(), mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toProductDto);
  }

  async create(dto: CreateProductDto, actor: AuthUser): Promise<ProductDto> {
    const data = this.data(dto, dto.pricingMode);
    try {
      const p = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({ data: { ...data, name: dto.name.trim(), category: dto.category.trim(), pricingMode: dto.pricingMode, unit: data.unit!, unitPriceVnd: BigInt(dto.unitPriceVnd) } });
        await this.activity.log(tx, { entityType: 'PRODUCT', entityId: created.id, action: 'PRODUCT_CREATED', toValue: created.name, userId: actor.id });
        return created;
      });
      return toProductDto(p);
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  async update(id: string, dto: UpdateProductDto, actor: AuthUser): Promise<ProductDto> {
    const current = await this.prisma.product.findUnique({ where: { id } });
    if (!current) throw DomainError.notFound('Product', id);
    const mode = dto.pricingMode ?? current.pricingMode;
    const data = this.data(dto, mode, current.unit);
    try {
      const p = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.product.update({
          where: { id },
          data: {
            ...data,
            name: dto.name?.trim(),
            category: dto.category?.trim(),
            pricingMode: dto.pricingMode,
            unitPriceVnd: dto.unitPriceVnd === undefined ? undefined : BigInt(dto.unitPriceVnd),
          },
        });
        await this.activity.log(tx, { entityType: 'PRODUCT', entityId: id, action: 'PRODUCT_UPDATED', data: { ...dto }, userId: actor.id });
        return updated;
      });
      return toProductDto(p);
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  private data(dto: UpdateProductDto, mode: PricingMode, currentUnit?: string) {
    const unit = mode === PricingMode.AREA ? 'm²' : (dto.unit?.trim() || (currentUnit && currentUnit !== 'm²' ? currentUnit : undefined));
    if (!unit) throw DomainError.badRequest('PRODUCT_UNIT_REQUIRED', 'Products priced per unit need a unit (cái, bộ, hộp…)');
    return {
      unit,
      isActive: dto.isActive,
      note: dto.note === undefined ? undefined : cleanText(dto.note),
      sortOrder: dto.sortOrder,
    };
  }

  private mapUnique(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return DomainError.conflict('PRODUCT_NAME_TAKEN', 'Another product already has this name');
    }
    return e;
  }
}
