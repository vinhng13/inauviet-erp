import { Injectable } from '@nestjs/common';
import type { Customer } from '../generated/prisma/client';
import { OrderStatus } from '../generated/prisma/enums';
import { ActivityService } from '../activity/activity.service';
import type { AuthUser } from '../auth/auth.types';
import { pageArgs } from '../common/dto/pagination.dto';
import { DomainError } from '../common/errors/domain-error';
import { normalizePhone } from '../common/utils/phone';
import { toSearchText } from '../common/utils/vn-text';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateCustomerDto,
  CustomerDto,
  CustomerListDto,
  CustomerQueryDto,
  CustomerSummaryDto,
  UpdateCustomerDto,
} from './customers.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
  ) {}

  async list(query: CustomerQueryDto): Promise<CustomerListDto> {
    const q = query.q ? toSearchText(query.q) : '';
    const phoneQ = query.q ? query.q.replace(/\D/g, '') : '';
    const where = {
      archivedAt: null,
      ...(q
        ? {
            OR: [
              { searchText: { contains: q } },
              ...(phoneQ.length >= 3 ? [{ phone: { contains: phoneQ } }] : []),
              { code: { contains: query.q!.trim().toUpperCase() } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(query) }),
      this.prisma.customer.count({ where }),
    ]);
    return { items: items.map(toCustomerDto), total };
  }

  /** Exact match on a normalized phone number, for the quick check when creating an order. */
  async lookupByPhone(phone: string): Promise<CustomerDto> {
    const normalized = normalizePhone(phone);
    if (!normalized) throw DomainError.badRequest('INVALID_PHONE', `Not a valid phone number: ${phone}`);
    const c = await this.prisma.customer.findUnique({ where: { phone: normalized } });
    if (!c) throw DomainError.notFound('Customer');
    return toCustomerDto(c);
  }

  async get(id: string): Promise<CustomerSummaryDto> {
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c) throw DomainError.notFound('Customer', id);
    const orders = await this.prisma.order.findMany({
      where: { customerId: id },
      select: { status: true, totalVnd: true, paidVnd: true },
    });
    let totalVnd = 0n;
    let paidVnd = 0n;
    let open = 0;
    for (const o of orders) {
      if (o.status === OrderStatus.CANCELLED) continue;
      if (o.status !== OrderStatus.COMPLETED) open++;
      if (o.totalVnd !== null) totalVnd += o.totalVnd;
      paidVnd += o.paidVnd;
    }
    return {
      ...toCustomerDto(c),
      orderCount: orders.length,
      openOrderCount: open,
      totalVnd: Number(totalVnd),
      paidVnd: Number(paidVnd),
      balanceVnd: Number(totalVnd - paidVnd),
    };
  }

  async create(dto: CreateCustomerDto, actor: AuthUser): Promise<CustomerDto> {
    const phone = this.requirePhone(dto.phone);
    await this.assertPhoneFree(phone);
    return this.prisma.$transaction(async (tx) => {
      const code = await this.numbering.next(tx, 'KH');
      const c = await tx.customer.create({
        data: {
          code,
          name: dto.name.trim(),
          phone,
          companyName: clean(dto.companyName),
          taxCode: clean(dto.taxCode),
          address: clean(dto.address),
          note: clean(dto.note),
          searchText: toSearchText(dto.name, dto.companyName, phone),
        },
      });
      await this.activity.log(tx, { entityType: 'CUSTOMER', entityId: c.id, action: 'CUSTOMER_CREATED', toValue: code, userId: actor.id });
      return toCustomerDto(c);
    });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerDto> {
    const current = await this.prisma.customer.findUnique({ where: { id } });
    if (!current) throw DomainError.notFound('Customer', id);
    let phone: string | undefined;
    if (dto.phone !== undefined) {
      phone = this.requirePhone(dto.phone);
      if (phone !== current.phone) await this.assertPhoneFree(phone);
    }
    const next = {
      name: dto.name?.trim() ?? current.name,
      companyName: dto.companyName === undefined ? current.companyName : clean(dto.companyName),
      phone: phone ?? current.phone,
    };
    const c = await this.prisma.customer.update({
      where: { id },
      data: {
        name: next.name,
        phone: next.phone,
        companyName: next.companyName,
        taxCode: dto.taxCode === undefined ? undefined : clean(dto.taxCode),
        address: dto.address === undefined ? undefined : clean(dto.address),
        note: dto.note === undefined ? undefined : clean(dto.note),
        searchText: toSearchText(next.name, next.companyName, next.phone),
      },
    });
    return toCustomerDto(c);
  }

  private requirePhone(input: string): string {
    const phone = normalizePhone(input);
    if (!phone) throw DomainError.badRequest('INVALID_PHONE', `Not a valid phone number: ${input}`);
    return phone;
  }

  private async assertPhoneFree(phone: string): Promise<void> {
    const existing = await this.prisma.customer.findUnique({ where: { phone } });
    if (existing) {
      throw DomainError.conflict('PHONE_EXISTS', `Phone ${phone} already belongs to ${existing.code} ${existing.name}`, {
        customer: toCustomerDto(existing),
      });
    }
  }
}

function clean(value: string | undefined | null): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function toCustomerDto(c: Customer): CustomerDto {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    phone: c.phone,
    companyName: c.companyName,
    taxCode: c.taxCode,
    address: c.address,
    note: c.note,
    createdAt: c.createdAt.toISOString(),
  };
}
