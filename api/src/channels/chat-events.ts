import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

/** Something changed in a conversation; open browsers refresh what they show. */
export interface ChatEvent {
  conversationId: string;
  assigneeId: string | null;
  /** A customer wrote: browsers play a sound */
  inbound: boolean;
}

/** In-process event bus feeding the live stream (one API process, as deployed). */
@Injectable()
export class ChatEvents {
  readonly stream = new Subject<ChatEvent>();

  emit(event: ChatEvent): void {
    this.stream.next(event);
  }
}
