import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsBoolean, IsEnum, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { ChannelPlatform, ChannelStatus, ConversationKind, ConversationStatus, MessageDirection, MessageStatus, MessageType } from '../generated/prisma/enums';

// ───────────── Kết nối kênh ─────────────

export class FacebookTokenDto {
  /** User, system-user or page access token from Meta */
  @IsString() @IsNotEmpty() @MaxLength(2000)
  accessToken: string;
}

export class ConnectFacebookDto extends FacebookTokenDto {
  /** Pages to connect, from the preview */
  @ArrayMinSize(1) @IsString({ each: true })
  pageIds: string[];
}

export class FacebookPageDto {
  id: string;
  name: string;
  pictureUrl?: string;
  /** Already connected and active */
  connected: boolean;
}

export class FacebookPagesDto {
  pages: FacebookPageDto[];
}

export class ConnectResultDto {
  pageId: string;
  name: string;
  ok: boolean;
  error?: string;
}

export class ConnectResultsDto {
  results: ConnectResultDto[];
}

export class ChannelDto {
  id: string;
  @ApiProperty({ enum: ChannelPlatform, enumName: 'ChannelPlatform' })
  platform: ChannelPlatform;
  externalId: string;
  name: string;
  pictureUrl: string | null;
  @ApiProperty({ enum: ChannelStatus, enumName: 'ChannelStatus' })
  status: ChannelStatus;
  lastEventAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  connectedAt: Date;
  connectedBy: string | null;
  conversations: number;
}

export class FailedEventDto {
  id: string;
  receivedAt: Date;
  attempts: number;
  lastError: string | null;
}

export class ChannelSetupDto {
  /** FB_APP_SECRET is set: webhook signatures can be checked */
  appSecret: boolean;
  /** FB_VERIFY_TOKEN is set */
  verifyToken: boolean;
  /** CHANNEL_SECRET_KEY is set and valid: tokens can be stored */
  secretKey: boolean;
  /** Path of the callback URL to enter in the Meta app (after the public address) */
  callbackPath: string;
  graphVersion: string;
}

export class ChannelOverviewDto {
  channels: ChannelDto[];
  setup: ChannelSetupDto;
  pendingEvents: number;
  failedEvents: FailedEventDto[];
}

// ───────────── Hội thoại ─────────────

export const CONVERSATION_FILTERS = ['all', 'mine', 'unassigned', 'waiting'] as const;
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];

export class ConversationQueryDto {
  /** all; mine = assigned to me; unassigned; waiting = the customer wrote last */
  @IsOptional() @IsIn(CONVERSATION_FILTERS)
  filter?: ConversationFilter;

  @IsOptional() @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @IsOptional() @IsEnum(ConversationKind)
  kind?: ConversationKind;

  @IsOptional() @IsUUID()
  channelId?: string;

  /** Name or phone of the person */
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  /** Load conversations older than this (lastMessageAt of the last row shown) */
  @IsOptional() @IsISO8601()
  before?: string;
}

export class PersonRefDto {
  id: string;
  fullName: string;
}

export class CustomerRefDto {
  id: string;
  code: string;
  name: string;
  phone: string;
}

export class ReplyWindowDto {
  /** RESPONSE: within 24 h of the customer's last message; HUMAN_AGENT: day 2–7, staff only; CLOSED: past 7 days; COMMENT: public reply under the post */
  @ApiProperty({ enum: ['RESPONSE', 'HUMAN_AGENT', 'CLOSED', 'COMMENT'] })
  mode: 'RESPONSE' | 'HUMAN_AGENT' | 'CLOSED' | 'COMMENT';
  /** When the current mode ends */
  until: Date | null;
}

export class ConversationRowDto {
  id: string;
  @ApiProperty({ enum: ConversationKind, enumName: 'ConversationKind' })
  kind: ConversationKind;
  @ApiProperty({ enum: ConversationStatus, enumName: 'ConversationStatus' })
  status: ConversationStatus;
  channelId: string;
  channelName: string;
  contactName: string;
  contactAvatarUrl: string | null;
  customerName: string | null;
  assignee: PersonRefDto | null;
  lastMessageAt: Date;
  lastMessageText: string;
  /** The customer wrote last: waiting for an answer */
  lastMessageIn: boolean;
  unreadCount: number;
  window: ReplyWindowDto;
}

export class ConversationListDto {
  items: ConversationRowDto[];
  /** More rows exist after the last one */
  hasMore: boolean;
}

export class UnreadDto {
  /** Visible open conversations with unread messages */
  conversations: number;
}

export class ContactDto {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** First phone number the person wrote */
  phone: string | null;
  customer: CustomerRefDto | null;
}

export class ConversationDto extends ConversationRowDto {
  contact: ContactDto;
  postId: string | null;
  postUrl: string | null;
  /** Comment threads: a private message can still be sent (once per comment, within 7 days) */
  canPrivateReply: boolean;
}

export class AttachmentDto {
  @ApiProperty({ enum: ['image', 'video', 'audio', 'file', 'sticker', 'other'] })
  type: 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'other';
  name: string | null;
  mime: string | null;
  size: number | null;
  /** Download through the CRM (copy kept on the server, or Facebook's link) */
  href: string | null;
}

export class MessageDto {
  id: string;
  @ApiProperty({ enum: MessageDirection, enumName: 'MessageDirection' })
  direction: MessageDirection;
  @ApiProperty({ enum: MessageType, enumName: 'MessageType' })
  type: MessageType;
  text: string | null;
  attachments: AttachmentDto[];
  sender: PersonRefDto | null;
  /** Sent by the page from Facebook / Meta Business Suite, not from the CRM */
  outsideCrm: boolean;
  privateReply: boolean;
  @ApiProperty({ enum: MessageStatus, enumName: 'MessageStatus' })
  status: MessageStatus;
  error: string | null;
  sentAt: Date;
}

export class MessageListDto {
  items: MessageDto[];
  hasMore: boolean;
}

export class MessageQueryDto {
  /** Messages sent before this time (sentAt of the oldest one shown) */
  @IsOptional() @IsISO8601()
  before?: string;
}

export class SendMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(2000)
  text: string;

  /** Comment threads: send as a private Messenger message instead of a public reply */
  @IsOptional() @IsBoolean()
  private?: boolean;
}

export class UpdateConversationDto {
  /** null = nobody */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  assigneeId?: string | null;

  @IsOptional() @IsEnum(ConversationStatus)
  status?: ConversationStatus;
}

export class LinkCustomerDto {
  /** null removes the link */
  @ValidateIf((_, v) => v !== null) @IsUUID()
  customerId: string | null;
}

export class AssigneesDto {
  people: PersonRefDto[];
}
