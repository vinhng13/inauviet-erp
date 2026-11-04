import { ApiProperty } from '@nestjs/swagger';

export class ActivityEntryDto {
  id: string;
  /** ORDER, DELIVERY or PAYMENT */
  entityType: string;
  entityId: string;
  /** e.g. ORDER_CREATED, STATUS_CHANGED, DELIVERY_DELIVERED, PAYMENT_RECORDED */
  action: string;
  fromValue: string | null;
  toValue: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  data: Record<string, unknown> | null;
  /** Staff member who made the change; null for system changes */
  userName: string | null;
  /** ISO timestamp */
  createdAt: string;
}
