import { Module } from '@nestjs/common';
import { DeliveriesController } from '../deliveries/deliveries.controller';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { QuotesController } from '../quotes/quotes.controller';
import { QuotesService } from '../quotes/quotes.service';
import { OrderRecalcService } from './order-recalc.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { WorkflowController } from './workflow.controller';
import { OrderWorkflowService } from './workflow.service';

/** Quotes, orders, their delivery trips and payments share one module because each of them (re)calculates the order. */
@Module({
  controllers: [QuotesController, OrdersController, WorkflowController, DeliveriesController, PaymentsController],
  providers: [QuotesService, OrdersService, OrderWorkflowService, DeliveriesService, PaymentsService, OrderRecalcService],
  exports: [QuotesService, OrdersService],
})
export class OrdersModule {}
