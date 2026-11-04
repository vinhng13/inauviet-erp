import { Body, Controller, HttpCode, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { CreatePaymentDto, PaymentDto, PaymentListDto, PaymentQueryDto, ReceivableListDto, ReceivableQueryDto, VoidPaymentDto } from './payments.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** All receipts across orders, newest first */
  @RequirePermission('payments.view')
  @Get('payments')
  all(@Query() query: PaymentQueryDto): Promise<PaymentListDto> {
    return this.payments.list(query);
  }

  /** Orders that still owe money */
  @RequirePermission('payments.view')
  @Get('receivables')
  receivables(@Query() query: ReceivableQueryDto): Promise<ReceivableListDto> {
    return this.payments.receivables(query);
  }

  @RequirePermission('payments.view')
  @Get('orders/:orderId/payments')
  list(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<PaymentDto[]> {
    return this.payments.listForOrder(orderId);
  }

  /** Record money received for an order, optionally linked to the trip it was collected on */
  @RequirePermission('payments.create')
  @Post('orders/:orderId/payments')
  create(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: CreatePaymentDto, @CurrentUser() actor: AuthUser): Promise<PaymentDto> {
    return this.payments.create(orderId, dto, actor);
  }

  /** Void a payment entered by mistake. It stays in the history. */
  @RequirePermission('payments.void')
  @HttpCode(200)
  @Post('payments/:id/void')
  void(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidPaymentDto, @CurrentUser() actor: AuthUser): Promise<PaymentDto> {
    return this.payments.void(id, dto, actor);
  }
}
