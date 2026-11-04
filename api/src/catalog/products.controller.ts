import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { CreateProductDto, ProductDto, ProductQueryDto, UpdateProductDto } from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Product catalog. Prices are removed for accounts without money.view. */
  @RequirePermission('products.view')
  @Get()
  list(@Query() query: ProductQueryDto): Promise<ProductDto[]> {
    return this.products.list(query);
  }

  @RequirePermission('products.manage')
  @Post()
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthUser): Promise<ProductDto> {
    return this.products.create(dto, user);
  }

  /** Edit, change price, stop or resume selling. Existing quotes and orders keep their own prices. */
  @RequirePermission('products.manage')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: AuthUser): Promise<ProductDto> {
    return this.products.update(id, dto, user);
  }
}
