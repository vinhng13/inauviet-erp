import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ActivityEntryDto } from '../activity/activity.dto';
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { CloseQuoteDto, CloseQuoteResultDto, LoseQuoteDto, QuoteDto, QuoteListDto, QuoteQueryDto, SaveQuoteDto } from './quotes.dto';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly activity: ActivityService,
  ) {}

  /** Search quotes; counts per status come with every page */
  @RequirePermission('quotes.view')
  @Get()
  list(@Query() query: QuoteQueryDto): Promise<QuoteListDto> {
    return this.quotes.list(query);
  }

  @RequirePermission('quotes.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<QuoteDto> {
    return this.quotes.get(id);
  }

  @RequirePermission('quotes.view')
  @Get(':id/activity')
  history(@Param('id', ParseUUIDPipe) id: string): Promise<ActivityEntryDto[]> {
    return this.activity.forEntity('QUOTE', id);
  }

  /** New quote (DRAFT). Lines from the catalog are priced on the server. */
  @RequirePermission('quotes.create')
  @Post()
  create(@Body() dto: SaveQuoteDto, @CurrentUser() user: AuthUser): Promise<QuoteDto> {
    return this.quotes.create(dto, user);
  }

  /** Replace header and lines (DRAFT or SENT only) */
  @RequirePermission('quotes.update')
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveQuoteDto, @CurrentUser() user: AuthUser): Promise<QuoteDto> {
    return this.quotes.update(id, dto, user);
  }

  @RequirePermission('quotes.update')
  @Post(':id/send')
  @HttpCode(200)
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<QuoteDto> {
    return this.quotes.markSent(id, user);
  }

  /** The customer did not order */
  @RequirePermission('quotes.update')
  @Post(':id/lose')
  @HttpCode(200)
  lose(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LoseQuoteDto, @CurrentUser() user: AuthUser): Promise<QuoteDto> {
    return this.quotes.lose(id, dto, user);
  }

  @RequirePermission('quotes.update')
  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<QuoteDto> {
    return this.quotes.reopen(id, user);
  }

  /** The customer agreed: create the order (DH-…) from this quote */
  @RequirePermission('quotes.close')
  @Post(':id/close')
  @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseQuoteDto, @CurrentUser() user: AuthUser): Promise<CloseQuoteResultDto> {
    return this.quotes.close(id, dto, user);
  }
}
