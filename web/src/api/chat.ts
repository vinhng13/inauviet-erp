import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, ApiError, unwrap, type Schemas } from './client';

export type ConversationFilter = 'all' | 'mine' | 'unassigned' | 'waiting';
export interface ConversationQuery {
  filter?: ConversationFilter;
  status?: Schemas['ConversationStatus'];
  kind?: Schemas['ConversationKind'];
  channelId?: string;
  q?: string;
}

/** Chat data. The live stream (useChatStream) refreshes these whenever a conversation changes. */
export const chatKeys = {
  all: ['chat'] as const,
  list: (q: ConversationQuery) => ['chat', 'list', q] as const,
  unread: ['chat', 'unread'] as const,
  one: (id: string) => ['chat', 'one', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
  assignees: ['chat', 'assignees'] as const,
  channels: ['channels'] as const,
};

export const useConversations = (q: ConversationQuery) =>
  useQuery({
    queryKey: chatKeys.list(q),
    queryFn: () => unwrap(api.GET('/api/v1/conversations', { params: { query: q } })),
    placeholderData: (prev) => prev,
  });

export const useUnreadConversations = (enabled: boolean) =>
  useQuery({ queryKey: chatKeys.unread, enabled, queryFn: () => unwrap(api.GET('/api/v1/conversations/unread')), refetchInterval: 120_000 });

export const useConversation = (id?: string) =>
  useQuery({ queryKey: chatKeys.one(id ?? ''), enabled: !!id, queryFn: () => unwrap(api.GET('/api/v1/conversations/{id}', { params: { path: { id: id! } } })) });

export const useMessages = (id?: string) =>
  useQuery({
    queryKey: chatKeys.messages(id ?? ''),
    enabled: !!id,
    queryFn: () => unwrap(api.GET('/api/v1/conversations/{id}/messages', { params: { path: { id: id! } } })),
  });

export const useAssignees = () =>
  useQuery({ queryKey: chatKeys.assignees, queryFn: () => unwrap(api.GET('/api/v1/conversations/assignees')), staleTime: 300_000 });

export async function loadOlderMessages(id: string, before: string) {
  return unwrap(api.GET('/api/v1/conversations/{id}/messages', { params: { path: { id }, query: { before } } }));
}

export async function loadMoreConversations(q: ConversationQuery, before: string) {
  return unwrap(api.GET('/api/v1/conversations', { params: { query: { ...q, before } } }));
}

export function useConversationActions(id: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: chatKeys.all });
  const p = { params: { path: { id } } };
  return {
    send: useMutation({
      mutationFn: (body: Schemas['SendMessageDto']) => unwrap(api.POST('/api/v1/conversations/{id}/messages', { ...p, body })),
      onSettled: refresh,
    }),
    sendFile: useMutation({
      mutationFn: async (file: File) => {
        const form = new FormData();
        form.set('file', file);
        const res = await fetch(`/api/v1/conversations/${id}/files`, { method: 'POST', body: form, credentials: 'include' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError({ statusCode: res.status, code: body.code ?? `HTTP_${res.status}`, message: body.message ?? res.statusText });
        return body as Schemas['MessageDto'];
      },
      onSettled: refresh,
    }),
    update: useMutation({
      mutationFn: (body: Schemas['UpdateConversationDto']) => unwrap(api.PATCH('/api/v1/conversations/{id}', { ...p, body })),
      onSuccess: refresh,
    }),
    linkCustomer: useMutation({
      mutationFn: (customerId: string | null) => unwrap(api.PUT('/api/v1/conversations/{id}/customer', { ...p, body: { customerId } })),
      onSuccess: refresh,
    }),
    markRead: useMutation({
      mutationFn: () => unwrap(api.POST('/api/v1/conversations/{id}/read', p)),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: chatKeys.unread });
        void qc.invalidateQueries({ queryKey: ['chat', 'list'] });
      },
    }),
  };
}

/** A short two-tone chime made with Web Audio (no sound file to ship). Browsers allow it after the first click on the page. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // no audio: the badge still shows
  }
}

/**
 * Live updates from the server (server-sent events). Mounted once in the layout: refreshes chat queries when a
 * conversation changes and chimes when a customer writes. EventSource reconnects by itself after a network drop.
 */
export function useChatStream(enabled: boolean) {
  const qc = useQueryClient();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/v1/conversations/stream', { withCredentials: true });
    source.onmessage = (ev) => {
      let data: { conversationId?: string; inbound?: boolean } = {};
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (data.inbound) chime();
      // several events in a burst → one refresh
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void qc.invalidateQueries({ queryKey: chatKeys.all }), 150);
    };
    return () => {
      window.clearTimeout(timer.current);
      source.close();
    };
  }, [enabled, qc]);
}

// ───────────── Kết nối kênh ─────────────

export const useChannels = (enabled = true) => useQuery({ queryKey: chatKeys.channels, enabled, queryFn: () => unwrap(api.GET('/api/v1/channels')) });

export function useChannelActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: chatKeys.channels });
  return {
    preview: useMutation({ mutationFn: (accessToken: string) => unwrap(api.POST('/api/v1/channels/facebook/pages', { body: { accessToken } })) }),
    connect: useMutation({
      mutationFn: (body: Schemas['ConnectFacebookDto']) => unwrap(api.POST('/api/v1/channels/facebook/connect', { body })),
      onSuccess: refresh,
    }),
    check: useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/channels/{id}/check', { params: { path: { id } } })), onSettled: refresh }),
    disconnect: useMutation({ mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/channels/{id}', { params: { path: { id } } })), onSuccess: refresh }),
    retry: useMutation({ mutationFn: () => unwrap(api.POST('/api/v1/channels/events/retry')), onSuccess: refresh }),
  };
}
