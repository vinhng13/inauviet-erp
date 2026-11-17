import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { formatDateOnly, todayInZone } from '../common/utils/dates';
import { cleanText, dateField } from '../common/utils/input';
import { toSearchText } from '../common/utils/vn-text';
import { ENV, type Env } from '../config/env';
import { ChatFiles } from '../channels/chat-files';
import { Prisma } from '../generated/prisma/client';
import type { WhDieStatus } from '../generated/prisma/enums';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ACTION_LABEL, allowedActions, TRANSITIONS, type MoveAction } from './die-rules';
import type {
  BatchDto,
  BatchInputDto,
  DieActionDto,
  DieCountCreateDto,
  DieCountDto,
  DieDto,
  DieInputDto,
  DieListDto,
  DieQueryDto,
  DieRowDto,
} from './warehouse.dto';
import { dieInclude, dieRow, dieSearchText, placeOf, sizeOf, type DieWithPlace } from './wh-common';

/** Photos of dies live next to chat files, in their own folder */
export class WhFiles extends ChatFiles {}

/** Khuôn: hồ sơ, vòng luân chuyển, giao nhận nhiều khuôn, kiểm kê theo kệ, tìm khuôn dùng lại. */
@Injectable()
export class DiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly files: WhFiles,
    @Inject(ENV) private readonly env: Env,
  ) {}

  today(): string {
    return todayInZone(this.env.APP_TIMEZONE);
  }

  async list(q: DieQueryDto): Promise<DieListDto> {
    const and: Prisma.WhDieWhereInput[] = [];
    if (q.status) and.push({ status: q.status });
    else if (q.flag !== 'review') and.push({ status: { not: 'DISPOSED' } });
    if (q.symbol) and.push({ symbolCode: q.symbol });
    if (q.place === 'home') and.push({ holderId: null });
    else if (q.place) and.push({ holderId: q.place });
    if (q.flag === 'review') and.push({ needsReview: true });
    if (q.flag === 'out') and.push({ holderId: { not: null } });
    if (q.flag === 'overdue') {
      and.push({ status: { in: ['IN_USE', 'REPAIRING'] }, expectedBackOn: { lt: dateField(this.today(), 'today') } });
    }
    const text = q.q?.trim();
    if (text) and.push({ OR: [{ code: { contains: text, mode: 'insensitive' } }, { searchText: { contains: toSearchText(text) } }] });
    const tol = q.tol ?? 0.5;
    const near = (field: 'lengthCm' | 'widthCm' | 'heightCm', v?: number) => {
      if (v === undefined) return;
      and.push({ [field]: { gte: v - tol, lte: v + tol } });
    };
    near('lengthCm', q.l);
    near('widthCm', q.w);
    near('heightCm', q.h);
    const rows = await this.prisma.whDie.findMany({
      where: { AND: and },
      include: dieInclude,
      orderBy: [{ symbolCode: 'asc' }, { seq: 'asc' }],
      take: 1000,
    });
    const today = this.today();
    return { items: rows.map((d) => dieRow(d, today)), total: rows.length };
  }

  async get(id: string): Promise<DieDto> {
    const d = await this.prisma.whDie.findUnique({
      where: { id },
      include: {
        ...dieInclude,
        maker: { select: { name: true } },
        moves: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: { user: { select: { fullName: true } }, batch: { select: { code: true } } },
        },
      },
    });
    if (!d) throw DomainError.notFound('WhDie', id);
    const today = this.today();
    const similar = await this.similar(d.symbolCode, d.lengthCm, d.widthCm, d.heightCm, d.id);
    return {
      ...dieRow(d, today),
      makerId: d.makerId,
      makerName: d.maker?.name ?? null,
      owner: d.owner,
      sizeText: d.sizeText,
      costVnd: d.costVnd === null ? null : Number(d.costVnd),
      note: d.note,
      hasPhoto: !!d.photo,
      allowedActions: allowedActions(d.status),
      similar: similar.map((s) => dieRow(s, today)),
      moves: d.moves.map((m) => ({
        id: m.id,
        action: m.action,
        actionLabel: ACTION_LABEL[m.action],
        date: formatDateOnly(m.date),
        toStatus: m.toStatus,
        place: m.place,
        reference: m.reference,
        expectedBackOn: formatDateOnly(m.expectedBackOn),
        note: m.note,
        batchCode: m.batch?.code ?? null,
        user: m.user?.fullName ?? null,
        createdAt: m.createdAt,
      })),
    };
  }

  /** Khuôn cùng ký hiệu, mỗi chiều lệch dưới 0,5 cm */
  private async similar(symbolCode: string, l: Prisma.Decimal | number | null, w: Prisma.Decimal | number | null, h: Prisma.Decimal | number | null, exceptId?: string): Promise<DieWithPlace[]> {
    if (l === null || w === null) return [];
    const near = (v: Prisma.Decimal | number | null) => (v === null ? null : { gt: Number(v) - 0.5, lt: Number(v) + 0.5 });
    return this.prisma.whDie.findMany({
      where: {
        symbolCode,
        status: { not: 'DISPOSED' },
        lengthCm: near(l)!,
        widthCm: near(w)!,
        ...(h === null ? {} : { heightCm: near(h)! }),
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      include: dieInclude,
      take: 20,
    });
  }

  async create(dto: DieInputDto, actor: AuthUser): Promise<DieDto> {
    if (!dto.symbolCode) throw DomainError.badRequest('WH_SYMBOL_REQUIRED', 'Choose the die symbol');
    const symbol = await this.prisma.whDieSymbol.findUnique({ where: { code: dto.symbolCode } });
    if (!symbol || !symbol.isActive) throw DomainError.badRequest('WH_SYMBOL_NOT_FOUND', 'Unknown die symbol');
    if (!dto.force) {
      const similar = await this.similar(dto.symbolCode, dto.lengthCm ?? null, dto.widthCm ?? null, dto.heightCm ?? null);
      if (similar.length) {
        const today = this.today();
        throw DomainError.conflict('WH_DIE_SIMILAR_EXISTS', 'A die with the same symbol and nearly the same size exists', {
          similar: similar.map((s) => dieRow(s, today)),
        });
      }
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const { lastNo } = await tx.whDieSymbol.update({ where: { code: dto.symbolCode! }, data: { lastNo: { increment: 1 } } });
      const code = `${dto.symbolCode}-${String(lastNo).padStart(3, '0')}`;
      const holder = dto.holderId ? await tx.whPartner.findUnique({ where: { id: dto.holderId } }) : null;
      const location = dto.locationId ? await tx.whLocation.findUnique({ where: { id: dto.locationId } }) : null;
      // Khuôn mới về kho thì qua bước kiểm (trừ khi đã chọn kệ); giao thẳng tới xưởng thì sẵn sàng tại xưởng
      const status: WhDieStatus = holder || location ? 'READY' : 'CHECKING';
      const fields = this.fields(dto);
      const d = await tx.whDie.create({
        data: {
          code,
          symbolCode: dto.symbolCode!,
          seq: lastNo,
          ...fields,
          status,
          holderId: holder?.id ?? null,
          locationId: holder ? null : (location?.id ?? null),
          searchText: dieSearchText({ code, ...fields }, sizeOf(fields)),
        },
      });
      await tx.whDieMove.create({
        data: {
          dieId: d.id,
          action: 'CREATE',
          date: dateField(this.today(), 'today'),
          toStatus: status,
          place: holder?.name ?? (location ? `Kho · ${location.code}` : 'Kho Âu Việt'),
          partnerId: holder?.id,
          locationId: location?.id,
          userId: actor.id,
        },
      });
      return d.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: DieInputDto, actor: AuthUser): Promise<DieDto> {
    const cur = await this.prisma.whDie.findUnique({ where: { id } });
    if (!cur) throw DomainError.notFound('WhDie', id);
    const fields = this.fields(dto);
    const changed = (Object.keys(fields) as Array<keyof typeof fields>).filter((k) => String(fields[k] ?? '') !== String(cur[k] ?? ''));
    await this.prisma.$transaction(async (tx) => {
      await tx.whDie.update({
        where: { id },
        data: {
          ...fields,
          ...(dto.reviewed ? { needsReview: false, reviewNote: null } : {}),
          searchText: dieSearchText({ code: cur.code, ...fields }, sizeOf(fields)),
        },
      });
      if (changed.length || dto.reviewed) {
        await tx.whDieMove.create({
          data: {
            dieId: id,
            action: 'EDIT',
            date: dateField(this.today(), 'today'),
            note: [changed.length ? `Sửa: ${changed.join(', ')}` : null, dto.reviewed ? 'Đã xác nhận thông tin' : null].filter(Boolean).join('. '),
            userId: actor.id,
          },
        });
      }
    });
    return this.get(id);
  }

  private fields(dto: DieInputDto) {
    return {
      kind: dto.kind ?? 'CUT',
      productName: dto.productName.trim(),
      customerName: cleanText(dto.customerName),
      lengthCm: dto.lengthCm ?? null,
      widthCm: dto.widthCm ?? null,
      heightCm: dto.heightCm ?? null,
      sizeText: cleanText(dto.sizeText),
      orientation: dto.orientation ?? null,
      pieces: dto.pieces ?? null,
      ups: dto.ups ?? null,
      makerId: dto.makerId ?? null,
      owner: dto.owner ?? 'AU_VIET',
      costVnd: dto.costVnd == null ? null : BigInt(dto.costVnd),
      note: cleanText(dto.note),
    } as const;
  }


  async action(id: string, dto: DieActionDto, actor: AuthUser): Promise<DieDto> {
    await this.prisma.$transaction((tx) => this.applyAction(tx, id, dto, actor));
    return this.get(id);
  }

  /**
   * One step of the die's life. Only actions allowed from the current status are accepted, so a die
   * cannot be passed before it came back, or issued while it is out, defective or disposed.
   */
  private async applyAction(tx: Tx, id: string, dto: DieActionDto, actor: AuthUser, batchId?: string): Promise<void> {
    const d = await tx.whDie.findUnique({ where: { id }, include: dieInclude });
    if (!d) throw DomainError.notFound('WhDie', id);
    const action = dto.action as MoveAction;
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(d.status)) {
      throw DomainError.conflict('WH_DIE_ACTION_NOT_ALLOWED', `${d.code}: action ${action} is not allowed while ${d.status}`, {
        code: d.code,
        status: d.status,
        action,
      });
    }
    const partner = dto.partnerId ? await tx.whPartner.findUnique({ where: { id: dto.partnerId } }) : null;
    if (dto.partnerId && !partner) throw DomainError.notFound('WhPartner', dto.partnerId);
    const location = dto.locationId ? await tx.whLocation.findUnique({ where: { id: dto.locationId } }) : null;
    if (dto.locationId && !location) throw DomainError.notFound('WhLocation', dto.locationId);

    let holderId = d.holderId;
    let locationId = d.locationId;
    if (rule.place === 'PARTNER') {
      if (!partner) throw DomainError.badRequest('WH_PARTNER_REQUIRED', 'Choose the workshop');
      holderId = partner.id;
      locationId = null;
    } else if (rule.place === 'HOME') {
      holderId = null;
      if (action === 'PASS') {
        if (!location) throw DomainError.badRequest('WH_LOCATION_REQUIRED', 'Choose the shelf the die goes to');
        locationId = location.id;
      } else if (location) locationId = location.id;
    } else if (rule.place === 'ANY') {
      if (partner) {
        holderId = partner.id;
        locationId = null;
      } else if (action === 'MOVE') {
        if (!location) throw DomainError.badRequest('WH_LOCATION_REQUIRED', 'Choose a shelf or a workshop');
        holderId = null;
        locationId = location.id;
      }
      // ISSUE without a partner: used in Âu Việt's own workshop, stays where it is
    }
    const status: WhDieStatus = rule.to === 'SAME' ? d.status : action === 'DEFECT' && dto.broken ? 'BROKEN' : rule.to;
    const needsBack = status === 'IN_USE' || status === 'REPAIRING';
    const expected = needsBack && dto.expectedBackOn ? dateField(dto.expectedBackOn, 'expectedBackOn') : needsBack ? d.expectedBackOn : null;

    const updated = await tx.whDie.update({
      where: { id },
      data: { status, holderId, locationId, expectedBackOn: expected },
      include: dieInclude,
    });
    await tx.whDieMove.create({
      data: {
        dieId: id,
        action,
        date: dateField(dto.date, 'date'),
        fromStatus: d.status,
        toStatus: status,
        place: placeOf(updated),
        partnerId: holderId,
        locationId,
        reference: cleanText(dto.reference),
        expectedBackOn: expected,
        note: cleanText(dto.note),
        batchId: batchId ?? null,
        userId: actor.id,
      },
    });
  }

  // ───────────── Giao nhận nhiều khuôn ─────────────

  async createBatch(dto: BatchInputDto, actor: AuthUser): Promise<BatchDto> {
    const ids = [...new Set(dto.dieIds)];
    const batchId = await this.prisma.$transaction(async (tx) => {
      const partner = await tx.whPartner.findUnique({ where: { id: dto.partnerId } });
      if (!partner) throw DomainError.notFound('WhPartner', dto.partnerId);
      const b = await tx.whDieBatch.create({
        data: {
          code: await this.numbering.next(tx, 'GN', dateField(dto.date, 'date')),
          kind: dto.kind,
          date: dateField(dto.date, 'date'),
          partnerId: partner.id,
          reference: cleanText(dto.reference),
          note: cleanText(dto.note),
          createdById: actor.id,
        },
      });
      for (const dieId of ids) {
        await this.applyAction(
          tx,
          dieId,
          {
            action: dto.kind === 'OUT' ? 'ISSUE' : 'RETURN',
            date: dto.date,
            partnerId: dto.kind === 'OUT' ? partner.id : null,
            expectedBackOn: dto.expectedBackOn,
            reference: dto.reference,
            note: dto.note,
          },
          actor,
          b.id,
        );
      }
      return b.id;
    });
    return this.batch(batchId);
  }

  async batches(): Promise<BatchDto[]> {
    const rows = await this.prisma.whDieBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true } });
    return Promise.all(rows.map((r) => this.batch(r.id)));
  }

  async batch(id: string): Promise<BatchDto> {
    const b = await this.prisma.whDieBatch.findUnique({
      where: { id },
      include: { partner: { select: { name: true } }, createdBy: { select: { fullName: true } }, moves: { include: { die: { include: dieInclude } } } },
    });
    if (!b) throw DomainError.notFound('WhDieBatch', id);
    const today = this.today();
    return {
      id: b.id,
      code: b.code,
      kind: b.kind,
      date: formatDateOnly(b.date),
      partnerId: b.partnerId,
      partnerName: b.partner.name,
      reference: b.reference,
      note: b.note,
      createdBy: b.createdBy.fullName,
      createdAt: b.createdAt,
      dies: b.moves.map((m) => dieRow(m.die, today)).sort((x, y) => x.code.localeCompare(y.code)),
    };
  }

  // ───────────── Ảnh khuôn ─────────────

  async savePhoto(id: string, file: { buffer: Buffer; mimetype: string; originalname: string } | undefined): Promise<void> {
    if (!file?.buffer?.length) throw DomainError.badRequest('FILE_REQUIRED', 'Choose a photo');
    if (!file.mimetype.startsWith('image/')) throw DomainError.badRequest('WH_PHOTO_IMAGE_ONLY', 'Photos must be images');
    if (!(await this.prisma.whDie.findUnique({ where: { id }, select: { id: true } }))) throw DomainError.notFound('WhDie', id);
    const rel = await this.files.save(file.buffer, file.mimetype, file.originalname);
    await this.prisma.whDie.update({ where: { id }, data: { photo: rel } });
  }

  async photoPath(id: string): Promise<string> {
    const d = await this.prisma.whDie.findUnique({ where: { id }, select: { photo: true } });
    if (!d?.photo) throw DomainError.notFound('WhDiePhoto', id);
    return this.files.path(d.photo);
  }

  // ───────────── Kiểm kê khuôn ─────────────

  async createDieCount(dto: DieCountCreateDto, actor: AuthUser): Promise<DieCountDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      let scope = 'Toàn kho Âu Việt';
      const where: Prisma.WhDieWhereInput = { status: { not: 'DISPOSED' } };
      if (dto.holderId) {
        const p = await tx.whPartner.findUnique({ where: { id: dto.holderId } });
        if (!p) throw DomainError.notFound('WhPartner', dto.holderId);
        scope = p.name;
        where.holderId = p.id;
      } else {
        where.holderId = null;
        if (dto.locationId) {
          const l = await tx.whLocation.findUnique({ where: { id: dto.locationId } });
          if (!l) throw DomainError.notFound('WhLocation', dto.locationId);
          scope = `Kệ ${l.code}`;
          where.locationId = l.id;
        }
      }
      const dies = await tx.whDie.findMany({ where, select: { id: true } });
      const c = await tx.whDieCount.create({
        data: { scope, locationId: dto.holderId ? null : (dto.locationId ?? null), createdById: actor.id, lines: { create: dies.map((d) => ({ dieId: d.id })) } },
      });
      return c.id;
    });
    return this.dieCount(id);
  }

  async dieCounts(): Promise<DieCountDto[]> {
    const rows = await this.prisma.whDieCount.findMany({ orderBy: { createdAt: 'desc' }, take: 30, select: { id: true } });
    return Promise.all(rows.map((r) => this.dieCount(r.id)));
  }

  async dieCount(id: string): Promise<DieCountDto> {
    const c = await this.prisma.whDieCount.findUnique({
      where: { id },
      include: { createdBy: { select: { fullName: true } }, lines: { include: { die: { include: dieInclude } } } },
    });
    if (!c) throw DomainError.notFound('WhDieCount', id);
    return {
      id: c.id,
      scope: c.scope,
      createdBy: c.createdBy.fullName,
      createdAt: c.createdAt,
      finishedAt: c.finishedAt,
      lines: c.lines
        .map((l) => ({ dieId: l.dieId, code: l.die.code, productName: l.die.productName, place: placeOf(l.die), found: l.found, extra: l.extra }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    };
  }

  /** Tick (or scan) one die. A die found here that the software places elsewhere is added as "extra". */
  async markDieCount(id: string, die: string, found: boolean): Promise<DieCountDto> {
    const c = await this.prisma.whDieCount.findUnique({ where: { id } });
    if (!c) throw DomainError.notFound('WhDieCount', id);
    if (c.finishedAt) throw DomainError.conflict('WH_COUNT_CLOSED', 'This count is already finished');
    const key = die.trim();
    const d = await this.prisma.whDie.findFirst({ where: /^[0-9a-f-]{36}$/i.test(key) ? { id: key } : { code: key.toUpperCase() } });
    if (!d) throw DomainError.notFound('WhDie', key);
    await this.prisma.whDieCountLine.upsert({
      where: { countId_dieId: { countId: id, dieId: d.id } },
      create: { countId: id, dieId: d.id, found, extra: true },
      update: { found },
    });
    return this.dieCount(id);
  }

  /** Kết thúc: khuôn không thấy được đánh dấu cần xác nhận; khuôn thấy ở kệ khác được chuyển về kệ đang kiểm */
  async finishDieCount(id: string, actor: AuthUser): Promise<DieCountDto> {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.whDieCount.findUnique({ where: { id }, include: { lines: { include: { die: true } }, location: true } });
      if (!c) throw DomainError.notFound('WhDieCount', id);
      if (c.finishedAt) throw DomainError.conflict('WH_COUNT_CLOSED', 'This count is already finished');
      const today = dateField(this.today(), 'today');
      for (const l of c.lines) {
        if (!l.found && !l.extra) {
          await tx.whDie.update({ where: { id: l.dieId }, data: { needsReview: true, reviewNote: `Không thấy khi kiểm kê ${c.scope} ngày ${this.today()}` } });
        } else if (l.found && l.extra && c.location && l.die.status === 'READY') {
          await tx.whDie.update({ where: { id: l.dieId }, data: { holderId: null, locationId: c.location.id } });
          await tx.whDieMove.create({
            data: { dieId: l.dieId, action: 'MOVE', date: today, fromStatus: 'READY', toStatus: 'READY', place: `Kho · ${c.location.code}`, locationId: c.location.id, note: `Thấy khi kiểm kê ${c.scope}`, userId: actor.id },
          });
        }
      }
      await tx.whDieCount.update({ where: { id }, data: { finishedAt: new Date() } });
    });
    return this.dieCount(id);
  }

  // ───────────── Tổng quan ─────────────

  async overviewParts(): Promise<{
    diesTotal: number;
    diesByStatus: Record<string, number>;
    atPartners: Array<{ holderId: string; name: string; inUse: number; kept: number; overdue: number }>;
    overdue: DieRowDto[];
    checking: DieRowDto[];
    needsReview: number;
  }> {
    const today = this.today();
    const [byStatus, out, checking, needsReview] = await Promise.all([
      this.prisma.whDie.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.whDie.findMany({ where: { holderId: { not: null }, status: { not: 'DISPOSED' } }, include: dieInclude }),
      this.prisma.whDie.findMany({ where: { status: 'CHECKING' }, include: dieInclude, take: 50, orderBy: { updatedAt: 'desc' } }),
      this.prisma.whDie.count({ where: { needsReview: true } }),
    ]);
    const rowsOut = out.map((d) => dieRow(d, today));
    const places = new Map<string, { holderId: string; name: string; inUse: number; kept: number; overdue: number }>();
    for (const r of rowsOut) {
      const p = places.get(r.holderId!) ?? { holderId: r.holderId!, name: r.place, inUse: 0, kept: 0, overdue: 0 };
      if (r.status === 'IN_USE' || r.status === 'REPAIRING') p.inUse++;
      else p.kept++;
      if (r.overdue) p.overdue++;
      places.set(r.holderId!, p);
    }
    const overdueAll = await this.list({ flag: 'overdue' });
    const diesByStatus = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    return {
      diesTotal: byStatus.filter((s) => s.status !== 'DISPOSED').reduce((a, s) => a + s._count._all, 0),
      diesByStatus,
      atPartners: [...places.values()].sort((a, b) => b.inUse + b.kept - (a.inUse + a.kept)),
      overdue: overdueAll.items,
      checking: checking.map((d) => dieRow(d, today)),
      needsReview,
    };
  }
}
