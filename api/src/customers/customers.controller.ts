import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import {
  CreateCustomerDto,
  CustomerDto,
  CustomerListDto,
  CustomerQueryDto,
  CustomerSummaryDto,
  UpdateCustomerDto,
} from './customers.dto';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** Search by name, company, phone or code. Diacritics are ignored: "nguyen" finds "Nguyễn". */
  @RequirePermission('customers.view')
  @Get()
  list(@Query() query: CustomerQueryDto): Promise<CustomerListDto> {
    return this.customers.list(query);
  }

  /** Exact match by phone number; 404 when no customer has it */
  @RequirePermission('customers.view')
  @Get('lookup/:phone')
  lookup(@Param('phone') phone: string): Promise<CustomerDto> {
    return this.customers.lookupByPhone(phone);
  }

  /** Customer profile with order count and balance */
  @RequirePermission('customers.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerSummaryDto> {
    return this.customers.get(id);
  }

  /** 409 PHONE_EXISTS (with the existing customer in details) when the phone is already used */
  @RequirePermission('customers.create')
  @Post()
  create(@Body() dto: CreateCustomerDto, @CurrentUser() actor: AuthUser): Promise<CustomerDto> {
    return this.customers.create(dto, actor);
  }

  @RequirePermission('customers.update')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto): Promise<CustomerDto> {
    return this.customers.update(id, dto);
  }
}
