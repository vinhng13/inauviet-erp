import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ChatEvents } from './chat-events';
import { MAX_FILE_BYTES } from './chat-files';
import {
  AssigneesDto,
  ChannelOverviewDto,
  ConnectFacebookDto,
  ConnectResultsDto,
  ConversationDto,
  ConversationListDto,
  ConversationQueryDto,
  FacebookPagesDto,
  FacebookTokenDto,
  LinkCustomerDto,
  MessageDto,
  MessageListDto,
  MessageQueryDto,
  SendMessageDto,
  UnreadDto,
  UpdateConversationDto,
} from './channels.dto';
import { ChannelsService } from './channels.service';
import { ConversationsService, type UploadedChatFile } from './conversations.service';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  /** Connected pages, configuration checklist and failed webhook events */
  @RequirePermission('channels.manage')
  @Get()
  overview(): Promise<ChannelOverviewDto> {
    return this.channels.overview();
  }

  /** Pages the token can manage. 400 FB_TOKEN_REJECTED when Facebook refuses the token. */
  @RequirePermission('channels.manage')
  @Post('facebook/pages')
  @HttpCode(200)
  pages(@Body() dto: FacebookTokenDto): Promise<FacebookPagesDto> {
    return this.channels.previewFacebook(dto.accessToken);
  }

  /** Connects the chosen pages: stores each page token encrypted and subscribes to its events */
  @RequirePermission('channels.manage')
  @Post('facebook/connect')
  @HttpCode(200)
  connect(@Body() dto: ConnectFacebookDto, @CurrentUser() actor: AuthUser): Promise<ConnectResultsDto> {
    return this.channels.connectFacebook(dto.accessToken, dto.pageIds, actor);
  }

  @RequirePermission('channels.manage')
  @Post(':id/check')
  @HttpCode(204)
  check(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.channels.check(id);
  }

  @RequirePermission('channels.manage')
  @Delete(':id')
  @HttpCode(204)
  disconnect(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.channels.disconnect(id);
  }

  @RequirePermission('channels.manage')
  @Post('events/retry')
  @HttpCode(200)
  retry(): Promise<{ count: number }> {
    return this.channels.retryFailed();
  }
}

@ApiTags('conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly events: ChatEvents,
  ) {}

  /** Newest first; 50 per page */
  @RequirePermission('conversations.view')
  @Get()
  list(@Query() q: ConversationQueryDto, @CurrentUser() user: AuthUser): Promise<ConversationListDto> {
    return this.conversations.list(user, q);
  }

  /** For the menu badge */
  @RequirePermission('conversations.view')
  @Get('unread')
  unread(@CurrentUser() user: AuthUser): Promise<UnreadDto> {
    return this.conversations.unread(user);
  }

  @RequirePermission('conversations.view')
  @Get('assignees')
  assignees(): Promise<AssigneesDto> {
    return this.conversations.assignees();
  }

  /** Server-sent events: { conversationId, inbound } whenever a visible conversation changes; "ping" every 25 s */
  @ApiExcludeEndpoint()
  @RequirePermission('conversations.view')
  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const changes = this.events.stream.pipe(
      filter((e) => this.conversations.canSee(user, e.assigneeId)),
      map((e): MessageEvent => ({ data: { conversationId: e.conversationId, inbound: e.inbound } })),
    );
    const ping = interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: '' })));
    return merge(changes, ping);
  }

  @RequirePermission('conversations.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<ConversationDto> {
    return this.conversations.get(user, id);
  }

  /** 50 messages, oldest first; pass before= to load earlier ones */
  @RequirePermission('conversations.view')
  @Get(':id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() q: MessageQueryDto, @CurrentUser() user: AuthUser): Promise<MessageListDto> {
    return this.conversations.messages(user, id, q.before);
  }

  @RequirePermission('conversations.view')
  @Post(':id/read')
  @HttpCode(204)
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.conversations.markRead(user, id);
  }

  /**
   * Messenger: 400 REPLY_WINDOW_CLOSED after 7 days of silence from the customer. Comments: public reply, or private=true
   * for the one private message Facebook allows (409 PRIVATE_REPLY_USED). A refusal by Facebook comes back as a FAILED message.
   */
  @RequirePermission('conversations.reply')
  @Post(':id/messages')
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @CurrentUser() user: AuthUser): Promise<MessageDto> {
    return this.conversations.sendText(user, id, dto.text, dto.private);
  }

  /** Image or file (field "file", up to 25 MB), Messenger chats only */
  @RequirePermission('conversations.reply')
  @Post(':id/files')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  sendFile(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedChatFile | undefined, @CurrentUser() user: AuthUser): Promise<MessageDto> {
    return this.conversations.sendFile(user, id, file);
  }

  /** Assign (conversations.assign; taking an unassigned one needs only conversations.reply) or mark done / reopen */
  @RequirePermission('conversations.view')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConversationDto, @CurrentUser() user: AuthUser): Promise<ConversationDto> {
    return this.conversations.update(user, id, dto);
  }

  @RequirePermission('conversations.reply')
  @Put(':id/customer')
  linkCustomer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkCustomerDto, @CurrentUser() user: AuthUser): Promise<ConversationDto> {
    return this.conversations.linkCustomer(user, id, dto.customerId);
  }

  @ApiExcludeEndpoint()
  @RequirePermission('conversations.view')
  @Get(':id/messages/:messageId/files/:index')
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const found = await this.conversations.attachment(user, id, messageId, index);
    if (found.url) return res.redirect(found.url);
    if (found.mime) res.type(found.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(found.name ?? 'tep')}`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(found.path!);
  }
}
