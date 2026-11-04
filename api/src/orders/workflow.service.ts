import { Inject, Injectable } from '@nestjs/common';
import type { Order, Prisma } from '../generated/prisma/client';
import { DesignFeedback, OrderStatus, ProductionStage } from '../generated/prisma/enums';
import { ActivityService } from '../activity/activity.service';
import { can, type AuthUser } from '../auth/auth.types';
import { ENV, type Env } from '../config/env';
import { DomainError } from '../common/errors/domain-error';
import { addDays, formatDateOnly, parseDateOnly, todayInZone } from '../common/utils/dates';
import { cleanText, dateField } from '../common/utils/input';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { OrderRecalcService } from './order-recalc.service';
import { isFullyDelivered, toProductionDto } from './order-views';
import type {
  AcceptOrderDto,
  AdvanceProductionDto,
  AssignDesignerDto,
  ConfirmOrderDto,
  DesignerDto,
  DesignFeedbackDto,
  DesignQueueItemDto,
  DesignQueueQueryDto,
  ProductionItemDto,
  SendDesignDto,
  UnapproveDesignDto,
  UpdateApprovalDto,
  UpdateProductionDto,
} from './workflow.dto';

export const PRODUCTION_STAGES: ProductionStage[] = [
  ProductionStage.RECEIVED,
  ProductionStage.PRINTING,
  ProductionStage.FINISHING,
  ProductionStage.QC,
  ProductionStage.DONE,
];
const STAGE_LABEL: Record<ProductionStage, string> = {
  RECEIVED: 'Nhận lệnh',
  PRINTING: 'In',
  FINISHING: 'Gia công',
  QC: 'Kiểm tra',
  DONE: 'Xong',
};
/** Work order due date when the order has none */
const DEFAULT_PRODUCTION_DAYS = 3;
const DEFAULT_CHANNEL = 'Zalo';

const DESIGN_STATUSES: OrderStatus[] = [OrderStatus.DESIGNING, OrderStatus.DESIGN_FINALIZING];

/**
 * Steps 2–6 of the order process (spec v0.7, section 7):
 *  2 confirm with the customer, choose whether a design is needed
 *  3 send maket versions until the customer approves one
 *  4 record the approval, finish the print files, lock the design → work order
 *  5 workshop stages, hand over to delivery
 *  6 trips (DeliveriesService), then the signed acceptance report completes the order
 * Every write ends with OrderRecalcService, which derives the status.
 */
@Injectable()
export class OrderWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly activity: ActivityService,
    private readonly recalc: OrderRecalcService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private today(): string {
    return todayInZone(this.env.APP_TIMEZONE);
  }

  // ───────────── Step 2 ─────────────

  async confirm(id: string, dto: ConfirmOrderDto, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, id, [OrderStatus.CONFIRMED], 'confirmed');
      await tx.order.update({ where: { id }, data: { confirmedAt: new Date(), needsDesign: dto.needsDesign } });
      await this.log(tx, id, 'ORDER_CONFIRMED', actor, { needsDesign: dto.needsDesign });
      if (!dto.needsDesign) await this.startProduction(tx, order, actor, 'File khách gửi');
      await this.recalc.recalc(tx, id, actor.id);
    });
  }

  // ───────────── Steps 3–4 ─────────────

  async designers(): Promise<DesignerDto[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { OR: [{ permissions: { has: 'design.work' } }, { isSystem: true }] } },
      select: { id: true, fullName: true, role: { select: { isSystem: true } }, _count: { select: { ordersDesigned: { where: { status: { in: DESIGN_STATUSES } } } } } },
      orderBy: { fullName: 'asc' },
    });
    // Designers first; admins can do everything but are listed after them.
    return users
      .sort((a, b) => Number(a.role.isSystem) - Number(b.role.isSystem))
      .map((u) => ({ id: u.id, fullName: u.fullName, openOrders: u._count.ordersDesigned }));
  }

  async assignDesigner(id: string, dto: AssignDesignerDto, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, id, DESIGN_STATUSES, 'assigned a designer');
      let name: string | null = null;
      if (dto.designerId) {
        const user = await tx.user.findUnique({ where: { id: dto.designerId } });
        if (!user || !user.isActive) throw DomainError.badRequest('USER_NOT_FOUND', 'Designer not found or locked');
        name = user.fullName;
      }
      if (order.designerId === dto.designerId) return;
      await tx.order.update({ where: { id }, data: { designerId: dto.designerId } });
      await this.log(tx, id, 'DESIGNER_ASSIGNED', actor, {}, name);
    });
  }

  async sendVersion(id: string, dto: SendDesignDto, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, id, [OrderStatus.DESIGNING], 'sent a design');
      const last = await tx.designVersion.findFirst({ where: { orderId: id }, orderBy: { version: 'desc' } });
      if (last?.feedback === DesignFeedback.PENDING) {
        throw DomainError.conflict('DESIGN_AWAITING_FEEDBACK', `Version ${last.version} is still waiting for the customer's answer`);
      }
      const version = (last?.version ?? 0) + 1;
      // Whoever sends the first version becomes the designer when nobody was assigned.
      if (!order.designerId && can(actor, 'design.work')) await tx.order.update({ where: { id }, data: { designerId: actor.id } });
      const note = cleanText(dto.note) ?? (version === 1 ? 'Gửi maket' : 'Gửi bản sửa');
      await tx.designVersion.create({ data: { orderId: id, version, note, createdById: actor.id } });
      await this.log(tx, id, 'DESIGN_SENT', actor, { version, note }, `v${version}`);
    });
  }

  async feedback(id: string, versionId: string, dto: DesignFeedbackDto, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, id, [OrderStatus.DESIGNING], 'given design feedback');
      const v = await tx.designVersion.findUnique({ where: { id: versionId } });
      if (!v || v.orderId !== id) throw DomainError.notFound('DesignVersion', versionId);
      const last = await tx.designVersion.findFirst({ where: { orderId: id }, orderBy: { version: 'desc' }, select: { id: true } });
      if (last?.id !== v.id || v.feedback !== DesignFeedback.PENDING) {
        throw DomainError.conflict('DESIGN_FEEDBACK_CLOSED', `Version ${v.version} already has an answer or is not the latest`);
      }
      const now = new Date();
      const note = cleanText(dto.note);
      await tx.designVersion.update({
        where: { id: v.id },
        data: { feedback: dto.approved ? DesignFeedback.APPROVED : DesignFeedback.CHANGES_REQUESTED, feedbackAt: now, feedbackNote: note },
      });
      if (dto.approved) {
        const customer = await tx.customer.findUnique({ where: { id: order.customerId }, select: { name: true } });
        await tx.order.update({
          where: { id },
          data: {
            designApprovedAt: now,
            approvedVersion: v.version,
            approvalChannel: cleanText(dto.channel) ?? DEFAULT_CHANNEL,
            approvedByName: cleanText(dto.approvedByName) ?? customer?.name ?? null,
            designFinalizedAt: null,
          },
        });
      }
      await this.log(tx, id, dto.approved ? 'DESIGN_APPROVED' : 'DESIGN_CHANGES', actor, { version: v.version, note, channel: dto.channel }, `v${v.version}`);
      await this.recalc.recalc(tx, id, actor.id);
    });
  }

  async updateApproval(id: string, dto: UpdateApprovalDto, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, id, [OrderStatus.DESIGN_FINALIZING], 'changed the approval');
      const data: Prisma.OrderUpdateInput = {};
      if (dto.channel !== undefined) data.approvalChannel = dto.channel.trim();
      if (dto.approvedByName !== undefined) data.approvedByName = dto.approvedByName.trim();
      if (dto.finalized !== undefined && dto.finalized !== (order.designFinalizedAt !== null)) data.designFinalizedAt = dto.finalized ? new Date() : null;
      if (Object.keys(data).length === 0) return;
      await tx.order.update({ where: { id }, data });
      await this.log(tx, id, 'DESIGN_APPROVAL_UPDATED', actor, { ...dto });
    });
  }

  /** The customer changed their mind after approving: back to step 3, the approved version counts as "changes requested". */
  async unapprove(id: string, dto: UnapproveDesignDto, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, id, [OrderStatus.DESIGN_FINALIZING], 'reopened for design');
      if (order.approvedVersion !== null) {
        await tx.designVersion.updateMany({
          where: { orderId: id, version: order.approvedVersion },
          data: { feedback: DesignFeedback.CHANGES_REQUESTED, feedbackNote: dto.reason.trim() },
        });
      }
      await tx.order.update({
        where: { id },
        data: { designApprovedAt: null, approvedVersion: null, approvalChannel: null, approvedByName: null, designFinalizedAt: null },
      });
      await this.log(tx, id, 'DESIGN_REOPENED', actor, { reason: dto.reason.trim(), version: order.approvedVersion });
      await this.recalc.recalc(tx, id, actor.id);
    });
  }

  async lock(id: string, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, id, [OrderStatus.DESIGN_FINALIZING], 'locked');
      if (!order.designFinalizedAt) {
        throw DomainError.conflict('DESIGN_NOT_FINALIZED', 'Mark the print files as finished before locking the design');
      }
      await tx.order.update({ where: { id }, data: { designLockedAt: new Date() } });
      await this.log(tx, id, 'DESIGN_LOCKED', actor, { version: order.approvedVersion });
      await this.startProduction(tx, order, actor, `Maket v${order.approvedVersion} đã duyệt`);
      await this.recalc.recalc(tx, id, actor.id);
    });
  }

  async designQueue(query: DesignQueueQueryDto, actor: AuthUser): Promise<DesignQueueItemDto[]> {
    const today = this.today();
    const rows = await this.prisma.order.findMany({
      where: { status: { in: DESIGN_STATUSES }, ...(query.mine ? { designerId: actor.id } : {}) },
      include: {
        customer: { select: { id: true, name: true } },
        designer: { select: { id: true, fullName: true } },
        designs: { orderBy: { version: 'desc' }, take: 1 },
        lines: { select: { description: true }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { code: 'asc' }],
    });
    return rows.map((o) => {
      const last = o.designs[0];
      const state: DesignQueueItemDto['state'] =
        o.status === OrderStatus.DESIGN_FINALIZING
          ? 'FINAL'
          : !last
            ? 'TODO'
            : last.feedback === DesignFeedback.PENDING
              ? 'WAITING'
              : last.feedback === DesignFeedback.CHANGES_REQUESTED
                ? 'CHANGES'
                : 'FINAL';
      const due = formatDateOnly(o.dueDate);
      return {
        id: o.id,
        code: o.code,
        status: o.status,
        customerId: o.customer.id,
        customerName: o.customer.name,
        summary: summarize(o.lines.map((l) => l.description)),
        dueDate: due,
        isOverdue: due !== null && due < today,
        designer: o.designer,
        lastVersion: last?.version ?? null,
        lastFeedback: last?.feedback ?? null,
        lastSentAt: last?.sentAt.toISOString() ?? null,
        approvedVersion: o.approvedVersion,
        finalized: o.designFinalizedAt !== null,
        state,
      };
    });
  }

  // ───────────── Step 5 ─────────────

  private async startProduction(tx: Tx, order: Order, actor: AuthUser, source: string): Promise<void> {
    const code = await this.numbering.next(tx, 'LSX');
    const today = this.today();
    const due = order.dueDate ? formatDateOnly(order.dueDate) : addDays(today, DEFAULT_PRODUCTION_DAYS);
    await tx.order.update({
      where: { id: order.id },
      data: {
        productionStartedAt: new Date(),
        productionCode: code,
        productionStage: ProductionStage.RECEIVED,
        productionDueDate: parseDateOnly(due < today ? today : due),
      },
    });
    await this.log(tx, order.id, 'PRODUCTION_STARTED', actor, { source }, code);
  }

  async updateProduction(id: string, dto: UpdateProductionDto, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.load(tx, id, [OrderStatus.IN_PRODUCTION], 'updated in production');
      await tx.order.update({
        where: { id },
        data: {
          productionDueDate: dto.dueDate ? dateField(dto.dueDate, 'dueDate') : undefined,
          productionPriority: dto.priority,
          productionNote: dto.note === undefined ? undefined : cleanText(dto.note),
        },
      });
      await this.log(tx, id, 'PRODUCTION_UPDATED', actor, { ...dto });
    });
  }

  async advance(id: string, dto: AdvanceProductionDto, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, id, [OrderStatus.IN_PRODUCTION], 'moved in production');
      const current = order.productionStage ?? ProductionStage.RECEIVED;
      const index = PRODUCTION_STAGES.indexOf(current);
      const next = dto.stage ?? PRODUCTION_STAGES[index + 1];
      if (!next) throw DomainError.conflict('PRODUCTION_DONE', 'The work order is already done; hand it over to delivery');
      if (next === current) return;
      await tx.order.update({ where: { id }, data: { productionStage: next } });
      await this.log(tx, id, 'PRODUCTION_STAGE', actor, { from: current, to: next }, STAGE_LABEL[next]);
    });
  }

  /** Workshop finished: the order moves to step 6 */
  async handover(id: string, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.load(tx, id, [OrderStatus.IN_PRODUCTION], 'handed over');
      if (order.productionStage !== ProductionStage.DONE) {
        throw DomainError.conflict('PRODUCTION_NOT_DONE', 'Mark the work order as done before handing it over');
      }
      await tx.order.update({ where: { id }, data: { productionDoneAt: new Date() } });
      await this.log(tx, id, 'PRODUCTION_HANDOVER', actor, {}, order.productionCode);
      await this.recalc.recalc(tx, id, actor.id);
    });
  }

  async productionBoard(): Promise<ProductionItemDto[]> {
    const today = this.today();
    const rows = await this.prisma.order.findMany({
      where: { status: OrderStatus.IN_PRODUCTION },
      include: {
        customer: { select: { id: true, name: true } },
        lines: { select: { description: true, spec: true, quantity: true, unit: true }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: [{ productionPriority: 'desc' }, { productionDueDate: { sort: 'asc', nulls: 'last' } }, { code: 'asc' }],
    });
    return rows.map((o) => {
      const production = toProductionDto(o)!;
      return {
        id: o.id,
        code: o.code,
        customerId: o.customer.id,
        customerName: o.customer.name,
        production,
        source: o.needsDesign === false || o.approvedVersion === null ? 'File khách gửi' : `Maket v${o.approvedVersion} đã duyệt`,
        lines: o.lines,
        isLate: production.dueDate !== null && production.dueDate < today,
      };
    });
  }

  // ───────────── Step 6 ─────────────

  async accept(id: string, dto: AcceptOrderDto, actor: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.load(tx, id, [OrderStatus.DELIVERING], 'accepted');
      const lines = await tx.orderLine.findMany({ where: { orderId: id }, select: { quantity: true, deliveredQty: true } });
      if (!isFullyDelivered(lines)) {
        throw DomainError.conflict('NOT_FULLY_DELIVERED', 'Deliver every line in full before recording the acceptance report');
      }
      const now = new Date();
      await tx.order.update({ where: { id }, data: { acceptedAt: now, acceptedByName: dto.signedBy.trim(), acceptanceNote: cleanText(dto.note), completedAt: now } });
      await this.log(tx, id, 'ORDER_ACCEPTED', actor, { signedBy: dto.signedBy.trim(), note: cleanText(dto.note) }, dto.signedBy.trim());
      await this.recalc.recalc(tx, id, actor.id);
    });
  }

  // ───────────── Helpers ─────────────

  private async load(tx: Tx, id: string, allowed: OrderStatus[], verb: string): Promise<Order> {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id } });
    if (!order) throw DomainError.notFound('Order', id);
    if (order.status === OrderStatus.CANCELLED) throw DomainError.conflict('ORDER_CANCELLED', `${order.code} is cancelled`);
    if (!allowed.includes(order.status)) {
      throw DomainError.conflict('INVALID_STATUS', `${order.code} is ${order.status} and cannot be ${verb} now`, { status: order.status });
    }
    return order;
  }

  private log(tx: Tx, orderId: string, action: string, actor: AuthUser, data: Record<string, unknown>, toValue?: string | null) {
    return this.activity.log(tx, { orderId, entityType: 'ORDER', entityId: orderId, action, toValue: toValue ?? null, data, userId: actor.id });
  }
}

function summarize(descriptions: string[]): string {
  if (descriptions.length <= 2) return descriptions.join(', ');
  return `${descriptions.slice(0, 2).join(', ')} +${descriptions.length - 2}`;
}
