import { Body, Controller, HttpCode, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import {
  CancelDeliveryDto,
  CreateDeliveryDto,
  DeliverDto,
  DeliveryListDto,
  DeliveryListItemDto,
  DeliveryQueryDto,
  UpdateDeliveryDto,
} from './deliveries.dto';
import { DeliveriesService } from './deliveries.service';

@ApiTags('deliveries')
@Controller()
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  /** Delivery schedule: filter by status and planned date range */
  @RequirePermission('deliveries.view')
  @Get('deliveries')
  list(@Query() query: DeliveryQueryDto): Promise<DeliveryListDto> {
    return this.deliveries.list(query);
  }

  @RequirePermission('deliveries.view')
  @Get('deliveries/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<DeliveryListItemDto> {
    return this.deliveries.get(id);
  }

  /** Add a trip to an order. 409 PLANNED_QTY_EXCEEDS_ORDER if it plans more than ordered. */
  @RequirePermission('deliveries.create')
  @Post('orders/:orderId/deliveries')
  create(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateDeliveryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<DeliveryListItemDto> {
    return this.deliveries.create(orderId, dto, actor);
  }

  /** Change a scheduled trip: date, address, note or quantities */
  @RequirePermission('deliveries.update')
  @Patch('deliveries/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeliveryDto, @CurrentUser() actor: AuthUser): Promise<DeliveryListItemDto> {
    return this.deliveries.update(id, dto, actor);
  }

  /** Mark delivered, optionally with lower quantities and money collected */
  @RequirePermission('deliveries.deliver')
  @HttpCode(200)
  @Post('deliveries/:id/deliver')
  deliver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverDto, @CurrentUser() actor: AuthUser): Promise<DeliveryListItemDto> {
    return this.deliveries.deliver(id, dto, actor);
  }

  /** Set a delivered trip back to scheduled, to fix a mistake */
  @RequirePermission('deliveries.reopen')
  @HttpCode(200)
  @Post('deliveries/:id/reopen')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto, @CurrentUser() actor: AuthUser): Promise<DeliveryListItemDto> {
    return this.deliveries.reopen(id, dto, actor);
  }

  /** Cancel a scheduled trip; its quantity returns to "not yet planned" */
  @RequirePermission('deliveries.cancel')
  @HttpCode(200)
  @Post('deliveries/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto, @CurrentUser() actor: AuthUser): Promise<DeliveryListItemDto> {
    return this.deliveries.cancel(id, dto, actor);
  }
}
