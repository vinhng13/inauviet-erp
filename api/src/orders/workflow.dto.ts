import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { DesignFeedback, OrderStatus, Priority, ProductionStage } from '../generated/prisma/enums';
import { DateOnly } from '../common/dto/fields';

// ───────────── Input ─────────────

/** Step 2 → 3 (needs design) or straight to step 5 (customer brings print-ready files) */
export class ConfirmOrderDto {
  @IsBoolean()
  needsDesign: boolean;
}

export class AssignDesignerDto {
  /** null removes the designer */
  @ValidateIf((o: AssignDesignerDto) => o.designerId !== null) @IsUUID()
  designerId: string | null;
}

export class SendDesignDto {
  /** What was sent and how, e.g. "Gửi maket qua Zalo" */
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class DesignFeedbackDto {
  /** true: customer approved this version (step 4); false: customer asked for changes */
  @IsBoolean()
  approved: boolean;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;

  /** How the customer approved: Zalo, Email, Trực tiếp… (approval only, default Zalo) */
  @IsOptional() @IsString() @MaxLength(50)
  channel?: string;

  /** Who approved on the customer side (approval only, default the customer name) */
  @IsOptional() @IsString() @MaxLength(200)
  approvedByName?: string;
}

/** Step 4: adjust the approval record, mark the print files finished */
export class UpdateApprovalDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50)
  channel?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  approvedByName?: string;

  /** Print files are finished from the approved version (needed before locking) */
  @IsOptional() @IsBoolean()
  finalized?: boolean;
}

export class UnapproveDesignDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

export class UpdateProductionDto {
  @IsOptional() @DateOnly()
  dueDate?: string;

  @ApiProperty({ enum: Priority, enumName: 'Priority', required: false })
  @IsOptional() @IsEnum(Priority)
  priority?: Priority;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class AdvanceProductionDto {
  /** Move to this stage; omitted = the next one */
  @ApiProperty({ enum: ProductionStage, enumName: 'ProductionStage', required: false })
  @IsOptional() @IsEnum(ProductionStage)
  stage?: ProductionStage;
}

/** Step 6: the customer signed the acceptance report (biên bản nghiệm thu) */
export class AcceptOrderDto {
  /** Who signed on the customer side */
  @IsString() @IsNotEmpty() @MaxLength(200)
  signedBy: string;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

const toBool = ({ value }: { value: unknown }) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : value);

export class DesignQueueQueryDto {
  /** Only orders assigned to the signed-in designer */
  @IsOptional() @Transform(toBool) @IsBoolean()
  mine?: boolean;
}

// ───────────── Output ─────────────

export class DesignVersionDto {
  id: string;
  version: number;
  sentAt: string;
  note: string | null;
  @ApiProperty({ enum: DesignFeedback, enumName: 'DesignFeedback' })
  feedback: DesignFeedback;
  feedbackAt: string | null;
  feedbackNote: string | null;
  createdByName: string;
}

export class PersonRefDto {
  id: string;
  fullName: string;
}

/** Steps 3–4 */
export class OrderDesignDto {
  designer: PersonRefDto | null;
  versions: DesignVersionDto[];
  approvedAt: string | null;
  approvedVersion: number | null;
  approvalChannel: string | null;
  approvedByName: string | null;
  finalizedAt: string | null;
  lockedAt: string | null;
}

/** Step 5: the work order (lệnh sản xuất) */
export class OrderProductionDto {
  /** LSX-2610-0014; null for orders started before work orders existed */
  code: string | null;
  @ApiProperty({ enum: ProductionStage, enumName: 'ProductionStage', nullable: true })
  stage: ProductionStage | null;
  @ApiProperty({ type: 'string', format: 'date', nullable: true })
  dueDate: string | null;
  @ApiProperty({ enum: Priority, enumName: 'Priority' })
  priority: Priority;
  note: string | null;
  startedAt: string;
  /** Handed over to delivery */
  doneAt: string | null;
}

/** Step 6 */
export class OrderAcceptanceDto {
  acceptedAt: string;
  acceptedByName: string | null;
  note: string | null;
}

export class DesignerDto {
  id: string;
  fullName: string;
  /** Orders currently in design (steps 3–4) */
  openOrders: number;
}

export class DesignQueueItemDto {
  id: string;
  code: string;
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;
  customerId: string;
  customerName: string;
  summary: string;
  @ApiProperty({ type: 'string', format: 'date', nullable: true })
  dueDate: string | null;
  isOverdue: boolean;
  designer: PersonRefDto | null;
  /** Latest version sent, null when none yet */
  lastVersion: number | null;
  @ApiProperty({ enum: DesignFeedback, enumName: 'DesignFeedback', nullable: true })
  lastFeedback: DesignFeedback | null;
  lastSentAt: string | null;
  approvedVersion: number | null;
  finalized: boolean;
  /** TODO: chưa gửi, WAITING: chờ khách, CHANGES: cần sửa, FINAL: đã duyệt / hoàn thiện */
  @ApiProperty({ enum: ['TODO', 'WAITING', 'CHANGES', 'FINAL'] })
  state: 'TODO' | 'WAITING' | 'CHANGES' | 'FINAL';
}

export class ProductionLineDto {
  description: string;
  spec: string | null;
  quantity: number;
  unit: string | null;
}

export class ProductionItemDto {
  id: string;
  code: string;
  customerId: string;
  customerName: string;
  production: OrderProductionDto;
  /** What the workshop prints from: "File khách gửi" or "Maket v2 đã duyệt" */
  source: string;
  lines: ProductionLineDto[];
  isLate: boolean;
}
