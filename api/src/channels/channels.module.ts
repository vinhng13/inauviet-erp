import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { ChannelsController, ConversationsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChatEvents } from './chat-events';
import { ChatFiles } from './chat-files';
import { ConversationsService } from './conversations.service';
import { EventProcessor } from './event-processor.service';
import { FacebookGraph } from './facebook-graph';
import { parseKey, SecretBox } from './secret-box';
import { WebhookController } from './webhook.controller';

/** Facebook fanpage chat and comments in the CRM (Zalo OA joins later on the same tables). */
@Module({
  controllers: [WebhookController, ChannelsController, ConversationsController],
  providers: [
    { provide: SecretBox, inject: [ENV], useFactory: (env: Env) => new SecretBox(parseKey(env.CHANNEL_SECRET_KEY)) },
    { provide: FacebookGraph, inject: [ENV], useFactory: (env: Env) => new FacebookGraph(env) },
    { provide: ChatFiles, inject: [ENV], useFactory: (env: Env) => new ChatFiles(env.CHAT_FILES_DIR) },
    ChatEvents,
    EventProcessor,
    ChannelsService,
    ConversationsService,
  ],
})
export class ChannelsModule {}
