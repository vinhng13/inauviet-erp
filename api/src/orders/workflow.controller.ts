import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import type { OrderDetailDto } from './orders.dto';
import { OrdersService } from './orders.service';
import {
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
import { OrderWorkflowService } from './workflow.service';

/** Steps 2–6 of an order. Every write returns the updated order. */
@ApiTags('workflow')
@Controller()
export class WorkflowController {
  constructor(
    private readonly workflow: OrderWorkflowService,
    private readonly orders: OrdersService,
  ) {}

  /** Step 2 → 3, or straight to step 5 when the customer brings print-ready files */
  @RequirePermission('orders.update')
  @HttpCode(200)
  @Post('orders/:id/confirm')
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmOrderDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.confirm(id, dto, actor);
    return this.orders.get(id, actor);
  }

  // ───────────── Design (steps 3–4) ─────────────

  /** Orders in steps 3–4 */
  @RequirePermission('design.view')
  @Get('design-queue')
  designQueue(@Query() query: DesignQueueQueryDto, @CurrentUser() actor: AuthUser): Promise<DesignQueueItemDto[]> {
    return this.workflow.designQueue(query, actor);
  }

  /** Active accounts that can do design work */
  @RequirePermission('design.view')
  @Get('designers')
  designers(): Promise<DesignerDto[]> {
    return this.workflow.designers();
  }

  @RequirePermission('design.assign')
  @Patch('orders/:id/design')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDesignerDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.assignDesigner(id, dto, actor);
    return this.orders.get(id, actor);
  }

  /** Record that maket v(n+1) was sent to the customer */
  @RequirePermission('design.work')
  @Post('orders/:id/design/versions')
  async send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendDesignDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.sendVersion(id, dto, actor);
    return this.orders.get(id, actor);
  }

  /** The customer's answer on the latest version: approved (→ step 4) or changes requested */
  @RequirePermission('design.work')
  @HttpCode(200)
  @Post('orders/:id/design/versions/:versionId/feedback')
  async feedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: DesignFeedbackDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<OrderDetailDto> {
    await this.workflow.feedback(id, versionId, dto, actor);
    return this.orders.get(id, actor);
  }

  /** Step 4: approval channel / approver, print files finished */
  @RequirePermission('design.work')
  @Patch('orders/:id/design/approval')
  async approval(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateApprovalDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.updateApproval(id, dto, actor);
    return this.orders.get(id, actor);
  }

  /** Step 4 → 3: the customer wants changes after approving */
  @RequirePermission('design.work')
  @HttpCode(200)
  @Post('orders/:id/design/unapprove')
  async unapprove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UnapproveDesignDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.unapprove(id, dto, actor);
    return this.orders.get(id, actor);
  }

  /** Step 4 → 5: lock the approved design and create the work order */
  @RequirePermission('design.work')
  @HttpCode(200)
  @Post('orders/:id/design/lock')
  async lock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.lock(id, actor);
    return this.orders.get(id, actor);
  }

  // ───────────── Production (step 5) ─────────────

  /** Work orders in the workshop */
  @RequirePermission('production.view')
  @Get('production')
  production(): Promise<ProductionItemDto[]> {
    return this.workflow.productionBoard();
  }

  @RequirePermission('production.update')
  @Patch('orders/:id/production')
  async updateProduction(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductionDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.updateProduction(id, dto, actor);
    return this.orders.get(id, actor);
  }

  /** Next workshop stage (or the given one) */
  @RequirePermission('production.update')
  @HttpCode(200)
  @Post('orders/:id/production/advance')
  async advance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdvanceProductionDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.advance(id, dto, actor);
    return this.orders.get(id, actor);
  }

  /** Step 5 → 6: goods ready for delivery */
  @RequirePermission('production.update')
  @HttpCode(200)
  @Post('orders/:id/production/handover')
  async handover(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.handover(id, actor);
    return this.orders.get(id, actor);
  }

  // ───────────── Acceptance (step 6) ─────────────

  /** The customer signed the acceptance report: the order is completed */
  @RequirePermission('deliveries.accept')
  @HttpCode(200)
  @Post('orders/:id/accept')
  async accept(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptOrderDto, @CurrentUser() actor: AuthUser): Promise<OrderDetailDto> {
    await this.workflow.accept(id, dto, actor);
    return this.orders.get(id, actor);
  }
}
