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
import { allowedActions, moveLabel, CAN_GO_CUT, parseSize, sizeMatches, sizeQuery, statusAfterMove, TRANSITIONS } from './die-rules';
import type {
  BatchDto,
  BatchInputDto,
  BatchQueryDto,
  DieActionDto,
  DieDto,
  DieInputDto,
  DieJournalQueryDto,
  DieJournalRowDto,
  DieListDto,
  DiePlaceDto,
  DieQueryDto,
  DieRowDto,
} from './warehouse.dto';
import { batchEnds, batchFromName, batchToName, dieInclude, dieRow, dieSearchText, locationIdOrCreate, placeOf, sizeOf, warehouseIdOrCreate, type DieWithPlace } from './wh-common';

/** Photos of dies live next to chat files, in their own folder */
export class WhFiles extends ChatFiles {}

const batchFull = {
  fromWarehouse: { select: { name: true } },
  toWarehouse: { select: { name: true } },
  toLocation: { select: { code: true } },
  control: { select: { name: true } },
  createdBy: { select: { fullName: true } },
  outBy: { select: { fullName: true } },
  inBy: { select: { fullName: true } },
  items: { include: { die: { include: dieInclude } } },
} satisfies Prisma.WhDieBatchInclude;

type BatchFull = Prisma.WhDieBatchGetPayload<{ include: typeof batchFull }>;

/**
 * Khuôn: hồ sơ, chuyển giữa các kho (Âu Việt hoặc kho ngoài: xưởng bế, nơi làm khuôn), có hiệu lực ngay;
 * thao tác tại chỗ, nhật ký, tìm khuôn dùng lại.
 */
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

  // ───────────── Danh sách, hồ sơ ─────────────

  async list(q: DieQueryDto): Promise<DieListDto> {
    const and: Prisma.WhDieWhereInput[] = [];
    if (q.status) and.push({ status: q.status });
    else if (q.flag !== 'review') and.push({ status: { not: 'DISPOSED' } });
    if (q.symbol) and.push({ symbolCode: q.symbol });
    if (q.place === 'transit') and.push({ status: { in: ['TRANSIT', 'INCOMING'] } });
    else if (q.place && /^[kx]:/.test(q.place)) and.push({ warehouseId: q.place.slice(2), status: { notIn: ['TRANSIT', 'INCOMING'] } });
    if (q.flag === 'review') and.push({ needsReview: true });
    if (q.flag === 'out') and.push({ warehouse: { ownership: 'EXTERNAL' } });
    if (q.flag === 'overdue') {
      and.push({ status: { in: ['IN_USE', 'REPAIRING'] }, expectedBackOn: { lt: dateField(this.today(), 'today') } });
    }
    const text = q.q?.trim();
    const dims = text ? sizeQuery(text) : null;
    if (text && !dims) and.push({ OR: [{ code: { contains: text, mode: 'insensitive' } }, { searchText: { contains: toSearchText(text) } }] });
    const tol = q.tol ?? 0.5;
    const near = (field: 'lengthCm' | 'widthCm' | 'heightCm', v?: number) => {
      if (v === undefined) return;
      and.push({ [field]: { gte: v - tol, lte: v + tol } });
    };
    near('lengthCm', q.l);
    near('widthCm', q.w);
    near('heightCm', q.h);
    let rows = await this.prisma.whDie.findMany({
      where: { AND: and },
      include: dieInclude,
      orderBy: [{ symbolCode: 'asc' }, { seq: 'asc' }],
      take: dims ? undefined : 1000,
    });
    // "24x24x12.5": mỗi chiều khớp một chiều của khuôn, không cần đúng thứ tự
    if (dims) rows = rows.filter((d) => sizeMatches(dims, [d.lengthCm, d.widthCm, d.heightCm].map((v) => (v === null ? null : Number(v))), tol)).slice(0, 1000);
    const today = this.today();
    return { items: rows.map((d) => dieRow(d, today)), total: rows.length };
  }

  async get(id: string, actor: AuthUser): Promise<DieDto> {
    const d = await this.prisma.whDie.findUnique({
      where: { id },
      include: {
        ...dieInclude,
        maker: { select: { name: true } },
        moves: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: { user: { select: { fullName: true } }, batch: { select: { id: true, code: true } } },
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
      allowedActions: allowedActions(d.status, !!d.pendingBatchId),
      pending: d.pendingBatchId ? await this.batch(d.pendingBatchId, actor) : null,
      similar: similar.map((s) => dieRow(s, today)),
      moves: d.moves.map((m) => ({
        id: m.id,
        action: m.action,
        actionLabel: moveLabel(m.action, m.toStatus),
        date: formatDateOnly(m.date),
        toStatus: m.toStatus,
        fromPlace: m.fromPlace,
        place: m.place,
        reference: m.reference,
        expectedBackOn: formatDateOnly(m.expectedBackOn),
        note: m.note,
        batchId: m.batch?.id ?? null,
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
        status: { notIn: ['DISPOSED', 'INCOMING'] },
        lengthCm: near(l)!,
        widthCm: near(w)!,
        ...(h === null ? {} : { heightCm: near(h)! }),
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      include: dieInclude,
      take: 20,
    });
  }

  /**
   * Khuôn mới: bắt buộc chọn nơi làm khuôn (một kho, gõ tên mới thì tự thêm kho ngoài). Khuôn nằm ở đó, "Đang làm khuôn", cho tới khi được kiểm tra
   * (đạt / không đạt) rồi bế khuôn hoặc chuyển kho.
   */
  async create(dto: DieInputDto, actor: AuthUser): Promise<DieDto> {
    if (!dto.symbolCode) throw DomainError.badRequest('WH_SYMBOL_REQUIRED', 'Choose the die symbol');
    if (!dto.makerId && !dto.makerName?.trim()) throw DomainError.badRequest('WH_DIE_MAKER_REQUIRED', 'Choose where the die is made');
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
    const dieId = await this.prisma.$transaction(async (tx) => {
      const makerId = (await warehouseIdOrCreate(tx, dto.makerId, dto.makerName))!;
      const maker = await this.dieKho(tx, makerId);
      const { lastNo } = await tx.whDieSymbol.update({ where: { code: dto.symbolCode! }, data: { lastNo: { increment: 1 } } });
      const code = `${dto.symbolCode}-${String(lastNo).padStart(3, '0')}`;
      const fields = { ...this.fields(dto), makerId };
      const d = await tx.whDie.create({
        data: { code, symbolCode: dto.symbolCode!, seq: lastNo, ...fields, status: 'MAKING', warehouseId: maker.id, searchText: dieSearchText({ code, ...fields }, sizeOf(fields)) },
        include: dieInclude,
      });
      const today = this.today();
      await tx.whDieMove.create({
        data: { dieId: d.id, action: 'CREATE', date: dateField(today, 'today'), toStatus: 'MAKING', place: placeOf(d), warehouseId: maker.id, userId: actor.id },
      });
      return d.id;
    });
    return this.get(dieId, actor);
  }

  async update(id: string, dto: DieInputDto, actor: AuthUser): Promise<DieDto> {
    const cur = await this.prisma.whDie.findUnique({ where: { id } });
    if (!cur) throw DomainError.notFound('WhDie', id);
    dto.makerId = await this.prisma.$transaction((tx) => warehouseIdOrCreate(tx, dto.makerId, dto.makerName));
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
    return this.get(id, actor);
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

  private async dieKho(tx: Tx, id: string) {
    const w = await tx.whWarehouse.findUnique({ where: { id } });
    if (!w) throw DomainError.notFound('WhWarehouse', id);
    if (!w.isActive) throw DomainError.badRequest('WH_WAREHOUSE_INACTIVE', 'This warehouse is not in use');
    return w;
  }

  // ───────────── Thao tác tại chỗ ─────────────

  async action(id: string, dto: DieActionDto, actor: AuthUser): Promise<DieDto> {
    await this.prisma.$transaction((tx) => this.applyAction(tx, id, dto, actor));
    return this.get(id, actor);
  }

  /**
   * Khuôn không đổi nơi: kiểm tra (đạt / không đạt), thanh lý, đổi kệ. Ai có quyền quản lý khuôn cũng làm được.
   */
  private async applyAction(tx: Tx, id: string, dto: DieActionDto, actor: AuthUser): Promise<void> {
    const d = await tx.whDie.findUnique({ where: { id }, include: dieInclude });
    if (!d) throw DomainError.notFound('WhDie', id);
    const action = dto.action;
    const rule = TRANSITIONS[action];
    if (!allowedActions(d.status, !!d.pendingBatchId).includes(action)) {
      if (d.pendingBatchId) throw DomainError.conflict('WH_DIE_PENDING', `${d.code} is on a transfer waiting for confirmation`, { code: d.code });
      throw DomainError.conflict('WH_DIE_ACTION_NOT_ALLOWED', `${d.code}: action ${action} is not allowed while ${d.status}`, { code: d.code, status: d.status, action });
    }
    let locationId = d.locationId;
    // Đổi kệ phải chọn kệ; kiểm tra đạt trong kho thì chọn kệ nếu muốn cất luôn
    if (action === 'MOVE' || (action === 'PASS' && (dto.locationId || dto.locationCode))) {
      const shelf = await locationIdOrCreate(tx, d.warehouseId, dto.locationId, dto.locationCode);
      if (!shelf) throw DomainError.badRequest('WH_LOCATION_REQUIRED', 'Choose the shelf');
      dto.locationId = shelf;
      const l = await tx.whLocation.findUnique({ where: { id: shelf } });
      if (!l || l.warehouseId !== d.warehouseId) throw DomainError.badRequest('WH_LOCATION_OTHER_WAREHOUSE', 'The shelf must be in the warehouse that keeps the die');
      locationId = l.id;
    }
    const reference = cleanText(dto.reference);
    const status: WhDieStatus = rule.to === 'SAME' ? d.status : action === 'DEFECT' && dto.broken ? 'BROKEN' : rule.to;
    const updated = await tx.whDie.update({ where: { id }, data: { status, locationId }, include: dieInclude });
    await tx.whDieMove.create({
      data: {
        dieId: id,
        action,
        date: dateField(dto.date, 'date'),
        fromStatus: d.status,
        toStatus: status,
        fromPlace: action === 'MOVE' ? placeOf(d) : null,
        place: placeOf(updated),
        warehouseId: d.warehouseId,
        locationId,
        reference,
        note: cleanText(dto.note),
        userId: actor.id,
      },
    });
  }

  // ───────────── Chuyển khuôn ─────────────

  async createBatch(dto: BatchInputDto, actor: AuthUser): Promise<BatchDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const toId = await warehouseIdOrCreate(tx, dto.toWarehouseId, dto.toWarehouseName);
      if (!toId) throw DomainError.badRequest('WH_BATCH_TO_REQUIRED', 'Choose where the dies go');
      dto.toLocationId = await locationIdOrCreate(tx, toId, dto.toLocationId, dto.toLocationCode);
      const fromId = dto.fromWarehouseId;
      const ids = [...new Set(dto.dieIds)];
      // Khuôn có sẵn trong kho đi nhưng chưa có mã: cấp mã ngay, đánh dấu cần bổ sung thông tin
      if (dto.newDies?.length) {
        for (const n of dto.newDies) {
          const symbol = await tx.whDieSymbol.findUnique({ where: { code: n.symbolCode } });
          if (!symbol || !symbol.isActive) throw DomainError.badRequest('WH_SYMBOL_NOT_FOUND', 'Unknown die symbol');
          const { lastNo } = await tx.whDieSymbol.update({ where: { code: n.symbolCode }, data: { lastNo: { increment: 1 } } });
          const code = `${n.symbolCode}-${String(lastNo).padStart(3, '0')}`;
          const size = parseSize(n.size);
          const d = await tx.whDie.create({
            data: {
              code,
              symbolCode: n.symbolCode,
              seq: lastNo,
              productName: n.productName.trim(),
              ...size,
              status: 'READY',
              warehouseId: fromId,
              needsReview: true,
              reviewNote: 'Cấp mã khi lập phiếu giao nhận, cần bổ sung thông tin',
              searchText: dieSearchText({ code, productName: n.productName, sizeText: size.sizeText }, sizeOf(size)),
            },
            include: dieInclude,
          });
          await tx.whDieMove.create({
            data: { dieId: d.id, action: 'CREATE', date: dateField(dto.date, 'date'), toStatus: 'READY', place: placeOf(d), note: 'Khuôn có sẵn trong kho, cấp mã khi giao', userId: actor.id },
          });
          ids.push(d.id);
        }
      }
      if (!ids.length) throw DomainError.badRequest('WH_BATCH_EMPTY', 'Choose at least one die');
      return this.openBatch(
        tx,
        fromId,
        toId,
        { date: dto.date, dieIds: ids, toLocationId: dto.toLocationId ?? null, reference: dto.reference ?? null, note: dto.note ?? null, purpose: dto.purpose ?? null },
        actor,
      );
    });
    return this.batch(id, actor);
  }

  /**
   * Chuyển khuôn, có hiệu lực ngay: khuôn phải đang ở kho đi và không nằm trong phiếu cũ đang chờ.
   * Bế khuôn / gửi sửa ngay tại kho đang giữ khuôn (bế tại chỗ) được: chỉ đổi trạng thái. Chuyển kho thì nơi đến phải khác.
   * Ghi một phiếu (đã xong) để tra lại, và một dòng nhật ký cho mỗi khuôn.
   */
  private async openBatch(
    tx: Tx,
    fromId: string,
    toId: string,
    o: { date: string; dieIds: string[]; toLocationId?: string | null; reference?: string | null; note?: string | null; isNew?: boolean; purpose: 'CUT' | 'REPAIR' | null },
    actor: AuthUser,
  ): Promise<string> {
    const inPlace = fromId === toId;
    if (inPlace && !o.purpose) throw DomainError.badRequest('WH_BATCH_SAME_PLACE', 'Where the dies go must differ from where they are');
    const fromKho = await this.dieKho(tx, fromId);
    const toKho = await this.dieKho(tx, toId);
    if (o.toLocationId) {
      const l = await tx.whLocation.findUnique({ where: { id: o.toLocationId } });
      if (!l || l.warehouseId !== toKho.id) throw DomainError.badRequest('WH_LOCATION_OTHER_WAREHOUSE', 'The shelf must be in the receiving warehouse');
    }
    const dies = await tx.whDie.findMany({ where: { id: { in: o.dieIds } }, include: dieInclude });
    if (dies.length !== o.dieIds.length) throw DomainError.notFound('WhDie', o.dieIds.find((i) => !dies.some((d) => d.id === i))!);
    for (const d of dies) {
      if (d.pendingBatchId) throw DomainError.conflict('WH_DIE_PENDING', `${d.code} is already on a transfer waiting for confirmation`, { code: d.code });
      if (o.purpose === 'CUT' && !CAN_GO_CUT.includes(d.status)) {
        throw DomainError.conflict('WH_DIE_NOT_PASSED', `${d.code} has not passed inspection yet`, { code: d.code, status: d.status });
      }
      if (['DISPOSED', 'BROKEN', 'TRANSIT', 'INCOMING'].includes(d.status)) {
        throw DomainError.conflict('WH_DIE_ACTION_NOT_ALLOWED', `${d.code} cannot be moved while ${d.status}`, { code: d.code, status: d.status, action: 'TRANSFER' });
      }
      if (d.warehouseId !== fromKho.id) throw DomainError.conflict('WH_DIE_NOT_HERE', `${d.code} is not at ${fromKho.name}`, { code: d.code, place: placeOf(d) });
    }
    const date = dateField(o.date, 'date');
    const now = new Date();
    const b = await tx.whDieBatch.create({
      data: {
        code: await this.numbering.next(tx, 'GN', date),
        date,
        fromWarehouseId: fromKho.id,
        toWarehouseId: toKho.id,
        toLocationId: o.toLocationId ?? null,
        controlWarehouseId: fromKho.id,
        status: 'DONE',
        outState: 'OK',
        inState: 'OK',
        outById: actor.id,
        outAt: now,
        inById: actor.id,
        inAt: now,
        isNew: !!o.isNew,
        reference: cleanText(o.reference),
        note: cleanText(o.note),
        createdById: actor.id,
        items: { create: dies.map((d) => ({ dieId: d.id })) },
      },
    });
    for (const d of dies) {
      const status = statusAfterMove(d.status, o.purpose);
      // Bế / sửa tại chỗ: giữ kệ cũ
      const locationId = inPlace ? d.locationId : (o.toLocationId ?? null);
      const updated = await tx.whDie.update({
        where: { id: d.id },
        data: { status, warehouseId: toKho.id, locationId, expectedBackOn: null },
        include: dieInclude,
      });
      await tx.whDieMove.create({
        data: {
          dieId: d.id,
          action: 'TRANSFER',
          date,
          fromStatus: d.status,
          toStatus: status,
          fromPlace: placeOf(d) || fromKho.name,
          place: placeOf(updated),
          warehouseId: toKho.id,
          locationId,
          reference: cleanText(o.reference),
          note: cleanText(o.note),
          batchId: b.id,
          userId: actor.id,
        },
      });
    }
    return b.id;
  }

  /** Phiếu cũ còn chờ: xác nhận xuất. Phiếu tới kho ngoài (trước là xưởng): khuôn tới nơi ngay; tới kho khác: đang chuyển, chờ nhận. */
  async send(id: string, actor: AuthUser): Promise<BatchDto> {
    await this.prisma.$transaction(async (tx) => {
      const b = await tx.whDieBatch.findUnique({ where: { id }, include: { ...batchEnds, items: { include: { die: { include: dieInclude } } } } });
      if (!b) throw DomainError.notFound('WhDieBatch', id);
      if (b.status !== 'OPEN' || b.outState !== 'PENDING') throw DomainError.conflict('WH_BATCH_NOT_PENDING', 'This transfer is not waiting to be sent');
      const arrived = b.inState === 'NONE';
      const claimed = await tx.whDieBatch.updateMany({
        where: { id, status: 'OPEN', outState: 'PENDING' },
        data: { outState: 'OK', outById: actor.id, outAt: new Date(), ...(arrived ? { status: 'DONE' } : {}) },
      });
      if (!claimed.count) throw DomainError.conflict('WH_BATCH_NOT_PENDING', 'This transfer is not waiting to be sent');
      const date = dateField(this.today(), 'today');
      const fromName = batchFromName(b);
      const toName = batchToName(b);
      for (const { die: d } of b.items) {
        let data: Prisma.WhDieUncheckedUpdateInput;
        let status: WhDieStatus;
        if (arrived) {
          // Tới xưởng: gửi sửa nếu khuôn lỗi, đang bế nếu có lệnh, không thì xưởng giữ
          status = d.status === 'DEFECT' ? 'REPAIRING' : b.reference ? 'IN_USE' : 'READY';
          const needsBack = status === 'IN_USE' || status === 'REPAIRING';
          data = { status, warehouseId: b.toWarehouseId ?? d.warehouseId, locationId: null, pendingBatchId: null, expectedBackOn: needsBack ? b.expectedBackOn : null };
        } else {
          status = 'TRANSIT';
          data = { status, locationId: null };
        }
        await tx.whDie.update({ where: { id: d.id }, data });
        await tx.whDieMove.create({
          data: {
            dieId: d.id,
            action: 'SEND',
            date,
            fromStatus: d.status,
            toStatus: status,
            fromPlace: fromName,
            place: arrived ? toName : `Đang chuyển tới ${toName}`,
            warehouseId: arrived ? b.toWarehouseId : null,
            reference: b.reference,
            expectedBackOn: arrived ? b.expectedBackOn : null,
            batchId: b.id,
            userId: actor.id,
          },
        });
      }
    });
    return this.batch(id, actor);
  }

  /** Phiếu cũ còn chờ: xác nhận đã nhận. Khuôn từ kho ngoài về ở trạng thái chờ kiểm. */
  async receive(id: string, dto: { locationId?: string | null; locationCode?: string | null }, actor: AuthUser): Promise<BatchDto> {
    await this.prisma.$transaction(async (tx) => {
      const b = await tx.whDieBatch.findUnique({ where: { id }, include: { ...batchEnds, items: { include: { die: { include: dieInclude } } } } });
      if (!b) throw DomainError.notFound('WhDieBatch', id);
      if (b.status !== 'OPEN' || b.inState !== 'PENDING') throw DomainError.conflict('WH_BATCH_NOT_PENDING', 'This transfer is not waiting to be received');
      if (b.outState === 'PENDING') throw DomainError.conflict('WH_TRANSFER_NOT_SENT', 'The sending warehouse has not confirmed yet');
      const locationId = (await locationIdOrCreate(tx, b.toWarehouseId, dto.locationId, dto.locationCode)) ?? b.toLocationId;
      if (locationId) {
        const l = await tx.whLocation.findUnique({ where: { id: locationId } });
        if (!l || l.warehouseId !== b.toWarehouseId) throw DomainError.badRequest('WH_LOCATION_OTHER_WAREHOUSE', 'The shelf must be in the receiving warehouse');
      }
      const claimed = await tx.whDieBatch.updateMany({
        where: { id, status: 'OPEN', inState: 'PENDING' },
        data: { inState: 'OK', inById: actor.id, inAt: new Date(), status: 'DONE', toLocationId: locationId ?? null },
      });
      if (!claimed.count) throw DomainError.conflict('WH_BATCH_NOT_PENDING', 'This transfer is not waiting to be received');
      const date = dateField(this.today(), 'today');
      // Kho → kho: khuôn giữ trạng thái trước khi xuất (vd đang chờ kiểm); từ xưởng về: chờ kiểm
      const before = new Map((await tx.whDieMove.findMany({ where: { batchId: id, action: 'SEND' }, select: { dieId: true, fromStatus: true } })).map((m) => [m.dieId, m.fromStatus]));
      for (const { die: d } of b.items) {
        const status: WhDieStatus = b.isNew ? 'READY' : b.fromWarehouseId ? (before.get(d.id) ?? 'READY') : 'CHECKING';
        const updated = await tx.whDie.update({
          where: { id: d.id },
          data: { status, warehouseId: b.toWarehouseId!, locationId: locationId ?? null, expectedBackOn: null, pendingBatchId: null },
          include: dieInclude,
        });
        await tx.whDieMove.create({
          data: {
            dieId: d.id,
            action: 'RECEIVE',
            date,
            fromStatus: d.status,
            toStatus: status,
            fromPlace: batchFromName(b),
            place: placeOf(updated),
            locationId: locationId ?? null,
            reference: b.reference,
            batchId: b.id,
            userId: actor.id,
          },
        });
      }
    });
    return this.batch(id, actor);
  }

  /** Từ chối (thủ kho) hoặc huỷ (người lập) trước khi khuôn rời nơi đi; khuôn ở nguyên chỗ cũ */
  async close(id: string, kind: 'REJECTED' | 'CANCELLED', reason: string | null, actor: AuthUser): Promise<BatchDto | null> {
    const removed = await this.prisma.$transaction(async (tx) => {
      const b = await tx.whDieBatch.findUnique({ where: { id }, include: { items: true } });
      if (!b) throw DomainError.notFound('WhDieBatch', id);
      if (b.status !== 'OPEN' || b.outState === 'OK') throw DomainError.conflict('WH_BATCH_ALREADY_SENT', 'The dies have already left; this transfer can no longer be rejected or cancelled');
      if (kind === 'REJECTED') {
        // ai có quyền quản lý khuôn cũng từ chối được phiếu cũ còn chờ
      } else if (b.createdById !== actor.id && !actor.isAdmin) {
        throw DomainError.forbidden('WH_NOT_CREATOR', 'Only the person who made this transfer can cancel it');
      }
      await tx.whDieBatch.update({ where: { id }, data: { status: kind, rejectReason: cleanText(reason) } });
      const dieIds = b.items.map((i) => i.dieId);
      await tx.whDie.updateMany({ where: { id: { in: dieIds } }, data: { pendingBatchId: null } });
      if (b.isNew) {
        // Khuôn mới chưa từng về: bỏ luôn hồ sơ
        await tx.whDie.deleteMany({ where: { id: { in: dieIds }, status: 'INCOMING' } });
        return true;
      }
      await tx.whDieMove.createMany({
        data: dieIds.map((dieId) => ({ dieId, action: 'REJECT' as const, date: dateField(this.today(), 'today'), note: [kind === 'REJECTED' ? 'Từ chối' : 'Huỷ phiếu', cleanText(reason)].filter(Boolean).join(': '), batchId: id, userId: actor.id })),
      });
      return false;
    });
    return removed ? null : this.batch(id, actor);
  }

  async batches(q: BatchQueryDto, actor: AuthUser): Promise<BatchDto[]> {
    const tab = q.tab ?? 'open';
    const id = q.place?.slice(2);
    const at = !q.place ? {} : { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] };
    const rows = await this.prisma.whDieBatch.findMany({
      where: { ...(tab === 'all' ? {} : { status: 'OPEN' as const }), ...at },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: tab === 'all' ? 200 : 500,
      include: batchFull,
    });
    const out = rows.map((b) => this.batchDto(b, actor));
    return tab === 'mine' ? out.filter((b) => b.canSend || b.canReceive) : out;
  }

  async batch(id: string, actor: AuthUser): Promise<BatchDto> {
    const b = await this.prisma.whDieBatch.findUnique({ where: { id }, include: batchFull });
    if (!b) throw DomainError.notFound('WhDieBatch', id);
    return this.batchDto(b, actor);
  }

  private batchDto(b: BatchFull, actor: AuthUser): BatchDto {
    const open = b.status === 'OPEN';
    // Phiếu cũ (trước khi chuyển khuôn có hiệu lực ngay) còn chờ: ai có quyền quản lý khuôn cũng xác nhận được
    const may = actor.isAdmin || actor.permissions.has('warehouse.dies');
    const canSend = open && b.outState === 'PENDING' && may;
    const canReceive = open && b.outState !== 'PENDING' && b.inState === 'PENDING' && may;
    const keeperOfTo = !!b.toWarehouse && may;
    const waitingFor = !open
      ? null
      : b.outState === 'PENDING'
        ? `Phiếu cũ chờ xác nhận xuất (${b.control?.name ?? ''})`
        : `Phiếu cũ chờ xác nhận đã nhận (${b.toWarehouse?.name ?? ''})`;
    const today = this.today();
    return {
      id: b.id,
      code: b.code,
      date: formatDateOnly(b.date)!,
      fromWarehouseId: b.fromWarehouseId,
      toWarehouseId: b.toWarehouseId,
      toLocationId: b.toLocationId,
      fromName: batchFromName(b),
      toName: batchToName(b) + (b.toLocation ? ` · ${b.toLocation.code}` : ''),
      status: b.status,
      outState: b.outState,
      inState: b.inState,
      isNew: b.isNew,
      reference: b.reference,
      note: b.note,
      rejectReason: b.rejectReason,
      expectedBackOn: formatDateOnly(b.expectedBackOn),
      createdBy: b.createdBy.fullName,
      createdAt: b.createdAt,
      outBy: b.outBy?.fullName ?? null,
      outAt: b.outAt,
      inBy: b.inBy?.fullName ?? null,
      inAt: b.inAt,
      waitingFor,
      controlName: b.control?.name ?? null,
      canSend,
      canReceive,
      canReject: open && b.outState !== 'OK' && ((b.outState === 'PENDING' && canSend) || keeperOfTo),
      canCancel: open && b.outState !== 'OK' && (b.createdById === actor.id || actor.isAdmin),
      dies: b.items.map((i) => dieRow(i.die, today)).sort((x, y) => x.code.localeCompare(y.code)),
    };
  }

  // ───────────── Nhật ký ─────────────

  async journal(q: DieJournalQueryDto): Promise<DieJournalRowDto[]> {
    const place = q.place?.trim();
    const rows = await this.prisma.whDieMove.findMany({
      where: {
        date: { gte: dateField(q.from, 'from'), lte: dateField(q.to, 'to') },
        ...(q.action ? { action: q.action } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
        ...(place ? { OR: [{ place: { startsWith: place, mode: 'insensitive' } }, { fromPlace: { startsWith: place, mode: 'insensitive' } }, { place: { startsWith: `Đang chuyển tới ${place}`, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: 2000,
      include: { die: { select: { code: true, productName: true } }, batch: { select: { id: true, code: true } }, user: { select: { fullName: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      date: formatDateOnly(m.date)!,
      createdAt: m.createdAt,
      dieId: m.dieId,
      code: m.die.code,
      productName: m.die.productName,
      action: m.action,
      actionLabel: moveLabel(m.action, m.toStatus),
      fromPlace: m.fromPlace,
      place: m.place,
      reference: m.reference,
      note: m.note,
      batchId: m.batch?.id ?? null,
      batchCode: m.batch?.code ?? null,
      user: m.user?.fullName ?? null,
    }));
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

  // ───────────── Tổng quan ─────────────

  async overviewParts(actor: AuthUser): Promise<{
    diesTotal: number;
    diesByStatus: Record<string, number>;
    outside: Array<{ warehouseId: string; name: string; inUse: number; kept: number; overdue: number }>;
    overdue: DieRowDto[];
    checking: DieRowDto[];
    needsReview: number;
    dieToConfirm: BatchDto[];
    dieInTransit: BatchDto[];
    diePlaces: DiePlaceDto[];
  }> {
    const today = this.today();
    const [byStatus, out, checking, needsReview, open, khos, atKho] = await Promise.all([
      this.prisma.whDie.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.whDie.findMany({ where: { warehouse: { ownership: 'EXTERNAL' }, status: { notIn: ['DISPOSED', 'TRANSIT', 'INCOMING'] } }, include: dieInclude }),
      this.prisma.whDie.findMany({ where: { status: 'CHECKING' }, include: dieInclude, take: 50, orderBy: { updatedAt: 'desc' } }),
      this.prisma.whDie.count({ where: { needsReview: true } }),
      this.batches({ tab: 'open' }, actor),
      this.prisma.whWarehouse.findMany({ where: { isActive: true }, orderBy: [{ ownership: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.whDie.groupBy({ by: ['warehouseId'], where: { status: { notIn: ['DISPOSED', 'TRANSIT', 'INCOMING'] } }, _count: { _all: true } }),
    ]);
    const rowsOut = out.map((d) => dieRow(d, today));
    const places = new Map<string, { warehouseId: string; name: string; inUse: number; kept: number; overdue: number }>();
    for (const r of rowsOut) {
      const p = places.get(r.warehouseId) ?? { warehouseId: r.warehouseId, name: r.warehouseName, inUse: 0, kept: 0, overdue: 0 };
      if (r.status === 'IN_USE' || r.status === 'REPAIRING') p.inUse++;
      else p.kept++;
      if (r.overdue) p.overdue++;
      places.set(r.warehouseId, p);
    }
    const outside = [...places.values()].sort((a, b) => b.inUse + b.kept - (a.inUse + a.kept));
    const overdueAll = await this.list({ flag: 'overdue' });
    const diesByStatus = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    return {
      diesTotal: byStatus.filter((s) => s.status !== 'DISPOSED').reduce((a, s) => a + s._count._all, 0),
      diesByStatus,
      outside,
      overdue: overdueAll.items,
      checking: checking.map((d) => dieRow(d, today)),
      needsReview,
      dieToConfirm: open.filter((b) => b.canSend || b.canReceive),
      dieInTransit: open.filter((b) => b.outState === 'OK' && b.inState === 'PENDING'),
      diePlaces: khos.map((k) => ({ key: `k:${k.id}`, name: k.name, ownership: k.ownership, dies: atKho.find((a) => a.warehouseId === k.id)?._count._all ?? 0 })),
    };
  }
}
