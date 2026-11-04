import { Body, Controller, HttpCode, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ActivityEntryDto } from '../activity/activity.dto';
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { can, type AuthUser } from '../auth/auth.types';
import { QuotesService } from '../quotes/quotes.service';
import {
  BoardDto,
  BoardQueryDto,
  CancelOrderDto,
  CreateOrderDto,
  OrderDetailDto,
  OrderListDto,
  OrderQueryDto,
  ReplaceLinesDto,
  UpdateOrderDto,
} from './orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly activity: ActivityService,
    private readonly quotes: QuotesService,
  ) {}

  /** Board of the 6 steps: open quotes, one column per order status, completed orders from the last 14 days */
  @RequirePermission('orders.view')
  @Get('board')
  async board(@Query() query: BoardQueryDto, @CurrentUser() actor: AuthUser): Promise<BoardDto> {
    const [orders, quotes] = await Promise.all([
      this.orders.board(query),
      can(actor, 'quotes.view') && !query.hasUnplanned && !query.due ? this.quotes.openForBoard(query.q) : null,
    ]);
    return { ...orders, quotes };
  }

  /** Search and filter orders */
  @RequirePermission('orders.view')
  @Get('orders')
  list(@Query() query: OrderQueryDto): Promise<OrderListDto> {
    return this.orders.list(query);
  }

  /** Create an order with its lines, an optional delivery plan and an optional deposit */
  @RequirePermission('orders.create')
  @Post('orders')
  create(@Body() dto: CreateOrderDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    return this.orders.create(dto, actor);
  }

  /** Find an order by its code, e.g. DH-2610-0042 */
  @RequirePermission('orders.view')
  @Get('orders/by-code/:code')
  byCode(@Param('code') code: string, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    return this.orders.getByCode(code, actor);
  }

  /** Everything about one order: lines, trips, payments, balance */
  @RequirePermission('orders.view')
  @Get('orders/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    return this.orders.get(id, actor);
  }

  /** Change dates or note */
  @RequirePermission('orders.update')
  @Patch('orders/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    return this.orders.update(id, dto, actor);
  }

  /** Replace the order lines (quantities can't go below what is already planned) */
  @RequirePermission('orders.update')
  @Put('orders/:id/lines')
  replaceLines(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceLinesDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    return this.orders.replaceLines(id, dto, actor);
  }

  /** Cancel the order and its scheduled trips */
  @RequirePermission('orders.cancel')
  @HttpCode(200)
  @Post('orders/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    return this.orders.cancel(id, dto, actor);
  }

  /** History of the order, its trips and payments, newest first */
  @RequirePermission('orders.view')
  @Get('orders/:id/activity')
  history(@Param('id', ParseUUIDPipe) id: string): Promise<ActivityEntryDto[]> {
    return this.activity.forOrder(id);
  }
}
