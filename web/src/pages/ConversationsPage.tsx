import {
  ArrowLeftOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CommentOutlined,
  ExclamationCircleOutlined,
  FacebookFilled,
  FileOutlined,
  FileDoneOutlined,
  LinkOutlined,
  LockOutlined,
  MessageOutlined,
  PaperClipOutlined,
  SendOutlined,
  UndoOutlined,
  UserAddOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  App,
  Avatar,
  Badge,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Grid,
  Image,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Upload,
  theme,
} from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Schemas } from '../api/client';
import {
  loadMoreConversations,
  loadOlderMessages,
  useAssignees,
  useChannels,
  useConversation,
  useConversationActions,
  useConversations,
  useMessages,
  type ConversationFilter,
  type ConversationQuery,
} from '../api/chat';
import { useMe } from '../api/hooks';
import { CustomerFormModal, CustomerSelect } from '../components/CustomerSelect';
import { useCan } from '../lib/access';
import { errorMessage } from '../lib/errors';

dayjs.extend(relativeTime);

type Row = Schemas['ConversationRowDto'];
type Detail = Schemas['ConversationDto'];
type Msg = Schemas['MessageDto'];

/** "10:24" today, "T3 10:24" this week, "02/11" before */
function when(iso: string): string {
  const d = dayjs(iso);
  if (d.isSame(dayjs(), 'day')) return d.format('HH:mm');
  if (d.isAfter(dayjs().subtract(6, 'day'))) return d.format('dd HH:mm');
  return d.format('DD/MM');
}

function left(until: string): string {
  const mins = Math.max(0, dayjs(until).diff(dayjs(), 'minute'));
  if (mins >= 48 * 60) return `${Math.floor(mins / 1440)} ngày`;
  if (mins >= 60) return `${Math.floor(mins / 60)} giờ ${mins % 60 ? `${mins % 60} phút` : ''}`.trim();
  return `${mins} phút`;
}

/** How long the page may still answer this conversation on Messenger */
function WindowTag({ window: w, compact }: { window: Schemas['ReplyWindowDto']; compact?: boolean }) {
  if (w.mode === 'COMMENT') return null;
  if (w.mode === 'CLOSED') {
    return (
      <Tooltip title="Đã quá 7 ngày từ tin cuối của khách: chỉ nhắn được khi khách nhắn lại">
        <Tag color="default" icon={<LockOutlined />}>Hết hạn trả lời</Tag>
      </Tooltip>
    );
  }
  if (w.mode === 'HUMAN_AGENT') {
    return (
      <Tooltip title="Đã quá 24 giờ: nhân viên vẫn trả lời được tới hết ngày thứ 7 (gắn nhãn hỗ trợ của Facebook)">
        <Tag color="orange" icon={<ClockCircleOutlined />}>{compact ? left(w.until!) : `Còn ${left(w.until!)} (hạn 7 ngày)`}</Tag>
      </Tooltip>
    );
  }
  const soon = dayjs(w.until).diff(dayjs(), 'hour') < 4;
  if (compact && !soon) return null;
  return (
    <Tooltip title="Trong 24 giờ kể từ tin cuối của khách, trang trả lời thoải mái">
      <Tag color={soon ? 'gold' : 'green'} icon={<ClockCircleOutlined />}>{compact ? left(w.until!) : `Còn ${left(w.until!)} trong 24 giờ`}</Tag>
    </Tooltip>
  );
}

function KindIcon({ kind }: { kind: Schemas['ConversationKind'] }) {
  return kind === 'COMMENT' ? (
    <Tooltip title="Bình luận trên fanpage">
      <CommentOutlined style={{ color: '#d46b08' }} />
    </Tooltip>
  ) : (
    <Tooltip title="Tin nhắn Messenger">
      <MessageOutlined style={{ color: '#0866ff' }} />
    </Tooltip>
  );
}

const FILTERS: Array<{ value: ConversationFilter; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'mine', label: 'Của tôi' },
  { value: 'unassigned', label: 'Chưa nhận' },
  { value: 'waiting', label: 'Chờ trả lời' },
];

/** "Hội thoại": Messenger chats and fanpage comments in three columns (list · chat · customer). */
export function ConversationsPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('id') ?? undefined;
  const screens = Grid.useBreakpoint();
  const { token } = theme.useToken();
  const [query, setQuery] = useState<ConversationQuery>({ filter: 'all' });
  const height = screens.lg ? 'calc(100vh - 64px - 48px)' : 'calc(100vh - 64px - 24px)';
  const open = (id?: string) => setParams(id ? { id } : {}, { replace: !!selected && !!id });

  const list = <ConversationList query={query} setQuery={setQuery} selected={selected} onOpen={open} />;
  const chat = selected ? <ChatPanel key={selected} id={selected} onBack={() => open(undefined)} showBack={!screens.lg} showInfo={!!screens.xl} /> : null;

  if (!screens.lg) {
    return <div style={{ height, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{chat ?? list}</div>;
  }
  return (
    <div style={{ height, display: 'flex', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, background: token.colorBgContainer, overflow: 'hidden' }}>
      <div style={{ width: 360, flexShrink: 0, borderInlineEnd: `1px solid ${token.colorBorderSecondary}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{list}</div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', minHeight: 0 }}>
        {chat ?? (
          <Flex flex={1} align="center" justify="center">
            <Empty description="Chọn một hội thoại ở cột bên trái" />
          </Flex>
        )}
      </div>
    </div>
  );
}

function ConversationList({
  query,
  setQuery,
  selected,
  onOpen,
}: {
  query: ConversationQuery;
  setQuery: (q: ConversationQuery) => void;
  selected?: string;
  onOpen: (id: string) => void;
}) {
  const { token } = theme.useToken();
  const can = useCan();
  const channels = useChannels(can('channels.manage'));
  const { data, isLoading, isFetching } = useConversations(query);
  const [more, setMore] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setMore([]);
    setHasMore(!!data?.hasMore);
  }, [data]);

  const items = useMemo(() => {
    const first = data?.items ?? [];
    const seen = new Set(first.map((r) => r.id));
    return [...first, ...more.filter((r) => !seen.has(r.id))];
  }, [data, more]);

  async function loadMore() {
    const last = items.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await loadMoreConversations(query, last.lastMessageAt);
      setMore((m) => [...m, ...res.items]);
      setHasMore(res.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }

  const pageOptions = (channels.data?.channels ?? []).map((c) => ({ value: c.id, label: c.name }));

  return (
    <>
      <Flex vertical gap={8} style={{ padding: 12, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Flex justify="space-between" align="center">
          <Typography.Title level={4} style={{ margin: 0 }}>
            Hội thoại
          </Typography.Title>
          {isFetching && <Spin size="small" />}
        </Flex>
        <Segmented<ConversationFilter> size="small" value={query.filter ?? 'all'} options={FILTERS} onChange={(filter) => setQuery({ ...query, filter })} />
        <Input.Search id="chat-search" placeholder="Tên, số điện thoại" allowClear size="small" onSearch={(v) => setQuery({ ...query, q: v.trim() || undefined })} />
        <Flex gap={6}>
          <Select
            size="small"
            style={{ flex: 1 }}
            value={query.kind ?? ''}
            onChange={(v) => setQuery({ ...query, kind: (v || undefined) as Schemas['ConversationKind'] | undefined })}
            options={[
              { value: '', label: 'Tin nhắn + bình luận' },
              { value: 'MESSAGE', label: 'Tin nhắn' },
              { value: 'COMMENT', label: 'Bình luận' },
            ]}
          />
          <Select
            size="small"
            style={{ width: 104 }}
            value={query.status ?? 'OPEN'}
            onChange={(status) => setQuery({ ...query, status })}
            options={[
              { value: 'OPEN', label: 'Đang mở' },
              { value: 'DONE', label: 'Đã xong' },
            ]}
          />
        </Flex>
        {can('channels.manage') && pageOptions.length > 1 && (
          <Select size="small" allowClear placeholder="Mọi fanpage" value={query.channelId} onChange={(channelId) => setQuery({ ...query, channelId })} options={pageOptions} />
        )}
      </Flex>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {isLoading ? (
          <Flex justify="center" style={{ padding: 32 }}>
            <Spin />
          </Flex>
        ) : items.length === 0 ? (
          <Empty style={{ marginTop: 48 }} description={query.filter === 'all' && !query.q ? 'Chưa có hội thoại nào' : 'Không có hội thoại phù hợp'} />
        ) : (
          items.map((r) => (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(r.id)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}
              style={{
                display: 'flex',
                gap: 10,
                padding: '10px 12px',
                cursor: 'pointer',
                borderBottom: `1px solid ${token.colorFillSecondary}`,
                background: r.id === selected ? token.controlItemBgActive : undefined,
              }}
            >
              <Badge count={r.unreadCount} size="small" offset={[-4, 4]}>
                <Avatar src={r.contactAvatarUrl ?? undefined} icon={<UserOutlined />} size={40} />
              </Badge>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Flex justify="space-between" gap={6}>
                  <Typography.Text strong={r.unreadCount > 0} ellipsis style={{ flex: 1 }}>
                    {r.contactName}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                    {when(r.lastMessageAt)}
                  </Typography.Text>
                </Flex>
                <Flex gap={6} align="center">
                  <KindIcon kind={r.kind} />
                  <Typography.Text type={r.unreadCount ? undefined : 'secondary'} strong={r.unreadCount > 0} ellipsis style={{ flex: 1, fontSize: 13 }}>
                    {r.lastMessageIn ? '' : 'Bạn: '}
                    {r.lastMessageText}
                  </Typography.Text>
                </Flex>
                <Flex gap={4} wrap style={{ marginTop: 2 }}>
                  {r.assignee ? (
                    <Tag style={{ fontSize: 11, marginInlineEnd: 0 }}>{r.assignee.fullName}</Tag>
                  ) : (
                    <Tag color="blue" style={{ fontSize: 11, marginInlineEnd: 0 }}>Chưa nhận</Tag>
                  )}
                  {r.customerName && <Tag color="green" style={{ fontSize: 11, marginInlineEnd: 0 }}>KH: {r.customerName}</Tag>}
                  {r.lastMessageIn && <WindowTag window={r.window} compact />}
                </Flex>
              </div>
            </div>
          ))
        )}
        {hasMore && (
          <Flex justify="center" style={{ padding: 12 }}>
            <Button size="small" loading={loadingMore} onClick={loadMore}>
              Xem thêm
            </Button>
          </Flex>
        )}
      </div>
    </>
  );
}

function ChatPanel({ id, onBack, showBack, showInfo }: { id: string; onBack: () => void; showBack: boolean; showInfo: boolean }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const can = useCan();
  const conv = useConversation(id);
  const msgs = useMessages(id);
  const actions = useConversationActions(id);
  const [text, setText] = useState('');
  const [asPrivate, setAsPrivate] = useState(false);
  const [older, setOlder] = useState<Msg[]>([]);
  const [hasOlder, setHasOlder] = useState<boolean | undefined>(undefined);
  const [infoOpen, setInfoOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const c = conv.data;

  // mark read when opened and whenever new messages arrive while looking at it
  const unread = c?.unreadCount ?? 0;
  const { mutate: markRead } = actions.markRead;
  useEffect(() => {
    if (unread > 0) markRead();
  }, [unread, markRead]);

  const items = useMemo(() => {
    const latest = msgs.data?.items ?? [];
    const seen = new Set(latest.map((m) => m.id));
    return [...older.filter((m) => !seen.has(m.id)), ...latest];
  }, [msgs.data, older]);
  const moreAvailable = hasOlder ?? msgs.data?.hasMore ?? false;

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  if (conv.isLoading) {
    return (
      <Flex flex={1} align="center" justify="center">
        <Spin />
      </Flex>
    );
  }
  if (!c) {
    return (
      <Flex flex={1} vertical align="center" justify="center" gap={12}>
        <Empty description="Không mở được hội thoại này (có thể đã giao cho người khác)" />
        <Button onClick={onBack}>Quay lại danh sách</Button>
      </Flex>
    );
  }

  const isComment = c.kind === 'COMMENT';
  const closed = c.window.mode === 'CLOSED';
  const canReply = can('conversations.reply');
  const sending = actions.send.isPending || actions.sendFile.isPending;

  async function send() {
    const body = text.trim();
    if (!body) return;
    stick.current = true;
    try {
      const sent = await actions.send.mutateAsync({ text: body, private: isComment && asPrivate ? true : undefined });
      setText('');
      setAsPrivate(false);
      if (sent.status === 'FAILED') message.error(sent.error ?? 'Facebook không nhận tin');
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  async function sendFile(file: File) {
    stick.current = true;
    try {
      const sent = await actions.sendFile.mutateAsync(file);
      if (sent.status === 'FAILED') message.error(sent.error ?? 'Facebook không nhận tệp');
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  async function loadOlder() {
    const first = items[0];
    if (!first) return;
    stick.current = false;
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    const res = await loadOlderMessages(id, first.sentAt);
    setOlder((o) => [...res.items, ...o]);
    setHasOlder(res.hasMore);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before;
    });
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const placeholder = isComment
    ? asPrivate
      ? 'Nhắn riêng qua Messenger cho người bình luận (chỉ được 1 lần)…'
      : 'Trả lời công khai dưới bình luận…'
    : 'Nhập tin nhắn… (Enter để gửi, Shift + Enter xuống dòng)';

  return (
    <>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Flex align="center" gap={10} wrap style={{ padding: '10px 14px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          {showBack && <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} aria-label="Quay lại danh sách" style={{ marginInlineStart: -8 }} />}
          <Avatar src={c.contactAvatarUrl ?? undefined} icon={<UserOutlined />} />
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <Typography.Text strong ellipsis style={{ display: 'block' }}>
              {c.contactName}
            </Typography.Text>
            <Typography.Text type="secondary" ellipsis style={{ fontSize: 12, display: 'block' }}>
              <FacebookFilled style={{ color: '#0866ff' }} /> {c.channelName} · {isComment ? 'Bình luận' : 'Messenger'}
              {c.postUrl && (
                <>
                  {' · '}
                  <a href={c.postUrl} target="_blank" rel="noreferrer">
                    Xem bài viết <LinkOutlined />
                  </a>
                </>
              )}
            </Typography.Text>
          </div>
          {!showInfo && <Button icon={<UserOutlined />} onClick={() => setInfoOpen(true)} aria-label="Thông tin khách hàng" />}
          {c.window.mode !== 'COMMENT' && (
            <div style={showBack ? { flexBasis: '100%' } : undefined}>
              <WindowTag window={c.window} />
            </div>
          )}
        </Flex>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', background: token.colorFillQuaternary, minHeight: 0 }}
        >
          {moreAvailable && (
            <Flex justify="center" style={{ marginBottom: 8 }}>
              <Button size="small" onClick={loadOlder}>
                Tin cũ hơn
              </Button>
            </Flex>
          )}
          {msgs.isLoading && <Spin />}
          {items.map((m, i) => (
            <Bubble key={m.id} m={m} showDay={i === 0 || !dayjs(items[i - 1].sentAt).isSame(m.sentAt, 'day')} contactName={c.contactName} />
          ))}
        </div>

        <div style={{ padding: 10, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          {!canReply ? (
            <Typography.Text type="secondary">Bạn chỉ có quyền xem hội thoại.</Typography.Text>
          ) : closed ? (
            <Typography.Text type="secondary">
              <LockOutlined /> Đã quá 7 ngày từ tin cuối của khách nên Facebook không cho trang nhắn trước. Tin sẽ mở lại khi khách nhắn; nếu có số điện thoại hãy gọi cho khách.
            </Typography.Text>
          ) : (
            <Flex vertical gap={6}>
              {isComment && (
                <Segmented
                  size="small"
                  value={asPrivate ? 'private' : 'public'}
                  onChange={(v) => setAsPrivate(v === 'private')}
                  options={[
                    { value: 'public', label: 'Trả lời công khai' },
                    { value: 'private', label: 'Nhắn riêng', disabled: !c.canPrivateReply },
                  ]}
                />
              )}
              <Flex gap={8} align="flex-end">
                {!isComment && (
                  <Upload
                    showUploadList={false}
                    beforeUpload={(file) => {
                      if (file.size > 25 * 1024 * 1024) {
                        message.error('Tệp quá 25 MB, Messenger không nhận.');
                      } else {
                        void sendFile(file);
                      }
                      return false;
                    }}
                  >
                    <Tooltip title="Gửi ảnh hoặc tệp (tối đa 25 MB)">
                      <Button icon={<PaperClipOutlined />} disabled={sending} aria-label="Đính kèm" />
                    </Tooltip>
                  </Upload>
                )}
                <Input.TextArea
                  id="chat-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  maxLength={2000}
                  placeholder={placeholder}
                  style={{ flex: 1 }}
                />
                <Button type="primary" icon={<SendOutlined />} loading={sending} disabled={!text.trim()} onClick={send}>
                  Gửi
                </Button>
              </Flex>
            </Flex>
          )}
        </div>
      </div>
      {showInfo ? (
        <div style={{ width: 300, flexShrink: 0, borderInlineStart: `1px solid ${token.colorBorderSecondary}`, overflowY: 'auto', padding: 14 }}>
          <InfoPanel c={c} />
        </div>
      ) : (
        <Modal open={infoOpen} onCancel={() => setInfoOpen(false)} footer={null} title="Khách hàng">
          <InfoPanel c={c} />
        </Modal>
      )}
    </>
  );
}

function Bubble({ m, showDay, contactName }: { m: Msg; showDay: boolean; contactName: string }) {
  const { token } = theme.useToken();
  const out = m.direction === 'OUT';
  const bg = out ? (m.status === 'FAILED' ? token.colorErrorBg : '#0866ff') : token.colorBgContainer;
  const fg = out && m.status !== 'FAILED' ? '#fff' : token.colorText;
  const who = out ? (m.sender?.fullName ?? (m.outsideCrm ? 'Gửi từ Facebook' : 'Trang')) : contactName;
  return (
    <>
      {showDay && (
        <Flex justify="center" style={{ margin: '10px 0 6px' }}>
          <Tag style={{ fontSize: 11 }}>{dayjs(m.sentAt).format('dddd, DD/MM/YYYY').replace(/^./, (ch) => ch.toUpperCase())}</Tag>
        </Flex>
      )}
      <Flex justify={out ? 'flex-end' : 'flex-start'} style={{ marginBottom: 6 }}>
        <div style={{ maxWidth: '72%' }}>
          <div
            style={{
              background: bg,
              color: fg,
              padding: '7px 11px',
              borderRadius: 14,
              borderEndEndRadius: out ? 4 : 14,
              borderEndStartRadius: out ? 14 : 4,
              boxShadow: out ? undefined : `0 0 0 1px ${token.colorBorderSecondary}`,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {m.privateReply && (
              <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 2 }}>
                <LockOutlined /> Nhắn riêng qua Messenger
              </div>
            )}
            {m.attachments.map((a, i) =>
              a.type === 'image' || a.type === 'sticker' ? (
                a.href ? <Image key={i} src={a.href} width={a.type === 'sticker' ? 96 : 200} style={{ borderRadius: 8, display: 'block', marginBottom: m.text ? 6 : 0 }} /> : <span key={i}>[Ảnh không còn]</span>
              ) : (
                <div key={i} style={{ marginBottom: m.text ? 6 : 0 }}>
                  <a href={a.href ?? undefined} target="_blank" rel="noreferrer" style={{ color: fg, textDecoration: 'underline' }}>
                    <FileOutlined /> {a.name ?? (a.type === 'video' ? 'Video' : a.type === 'audio' ? 'Ghi âm' : 'Tệp đính kèm')}
                  </a>
                  {a.size ? <span style={{ opacity: 0.7, fontSize: 12 }}> · {Math.ceil(a.size / 1024)} KB</span> : null}
                </div>
              ),
            )}
            {m.text}
          </div>
          <div style={{ fontSize: 11, color: token.colorTextTertiary, textAlign: out ? 'right' : 'left', marginTop: 2 }}>
            {who} · {dayjs(m.sentAt).format('HH:mm')}
            {m.status === 'SENDING' && ' · đang gửi'}
            {m.status === 'FAILED' && (
              <Typography.Text type="danger" style={{ fontSize: 11 }}>
                {' '}
                · <ExclamationCircleOutlined /> {m.error ?? 'Không gửi được'}
              </Typography.Text>
            )}
          </div>
        </div>
      </Flex>
    </>
  );
}

function InfoPanel({ c }: { c: Detail }) {
  const { message, modal } = App.useApp();
  const can = useCan();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const actions = useConversationActions(c.id);
  const assignees = useAssignees();
  const [linking, setLinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pick, setPick] = useState<string>();
  const customer = c.contact.customer;

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      message.success(ok);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Flex vertical gap={14}>
      <Flex vertical align="center" gap={6}>
        <Avatar src={c.contact.avatarUrl ?? undefined} icon={<UserOutlined />} size={64} />
        <Typography.Text strong>{c.contact.name}</Typography.Text>
        {c.contact.phone && (
          <Typography.Text copyable>
            <a href={`tel:${c.contact.phone}`}>{c.contact.phone}</a>
          </Typography.Text>
        )}
      </Flex>

      <Card size="small" title="Khách hàng trong CRM">
        {customer ? (
          <Flex vertical gap={8}>
            <Descriptions size="small" column={1} items={[
              { key: 'c', label: 'Mã', children: <Link to={`/customers/${customer.id}`}>{customer.code}</Link> },
              { key: 'n', label: 'Tên', children: customer.name },
              { key: 'p', label: 'SĐT', children: customer.phone },
            ]} />
            <Flex gap={8} wrap>
              {can('quotes.create') && (
                <Button type="primary" icon={<FileDoneOutlined />} onClick={() => navigate(`/quotes/new?customerId=${customer.id}`)}>
                  Lập báo giá
                </Button>
              )}
              {can('conversations.reply') && (
                <Button
                  onClick={() =>
                    modal.confirm({
                      title: 'Bỏ gắn khách hàng?',
                      content: `${c.contact.name} sẽ không còn gắn với ${customer.code}.`,
                      okText: 'Bỏ gắn',
                      cancelText: 'Không',
                      onOk: () => run(actions.linkCustomer.mutateAsync(null), 'Đã bỏ gắn'),
                    })
                  }
                >
                  Bỏ gắn
                </Button>
              )}
            </Flex>
          </Flex>
        ) : (
          <Flex vertical gap={8}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              Chưa gắn với khách hàng nào. Gắn để lập báo giá và xem đơn của khách.
            </Typography.Text>
            {can('conversations.reply') && can('customers.view') && (
              <Space wrap>
                <Button icon={<LinkOutlined />} onClick={() => setLinking(true)}>
                  Gắn khách có sẵn
                </Button>
                {can('customers.create') && (
                  <Button icon={<UserAddOutlined />} onClick={() => setCreating(true)}>
                    Tạo khách mới
                  </Button>
                )}
              </Space>
            )}
          </Flex>
        )}
      </Card>

      <Card size="small" title="Phụ trách">
        <Flex vertical gap={8}>
          {can('conversations.assign') ? (
            <Select
              id="chat-assignee"
              allowClear
              placeholder="Chưa giao"
              value={c.assignee?.id}
              loading={assignees.isLoading}
              options={(assignees.data?.people ?? []).map((p) => ({ value: p.id, label: p.fullName }))}
              onChange={(v) => run(actions.update.mutateAsync({ assigneeId: v ?? null }), v ? 'Đã giao hội thoại' : 'Đã bỏ giao')}
            />
          ) : (
            <Typography.Text>{c.assignee?.fullName ?? 'Chưa ai nhận'}</Typography.Text>
          )}
          {!c.assignee && can('conversations.reply') && !can('conversations.assign') && me && (
            <Button onClick={() => run(actions.update.mutateAsync({ assigneeId: me.id }), 'Bạn đã nhận hội thoại')}>Nhận hội thoại</Button>
          )}
          {can('conversations.reply') &&
            (c.status === 'OPEN' ? (
              <Button icon={<CheckOutlined />} onClick={() => run(actions.update.mutateAsync({ status: 'DONE' }), 'Đã đánh dấu xong')}>
                Đánh dấu xong
              </Button>
            ) : (
              <Button icon={<UndoOutlined />} onClick={() => run(actions.update.mutateAsync({ status: 'OPEN' }), 'Đã mở lại')}>
                Mở lại
              </Button>
            ))}
        </Flex>
      </Card>

      <Modal
        open={linking}
        title="Gắn với khách hàng có sẵn"
        okText="Gắn"
        cancelText="Đóng"
        okButtonProps={{ disabled: !pick, loading: actions.linkCustomer.isPending }}
        onCancel={() => setLinking(false)}
        onOk={async () => {
          await run(actions.linkCustomer.mutateAsync(pick!), 'Đã gắn khách hàng');
          setLinking(false);
        }}
        destroyOnHidden
      >
        <CustomerSelect value={pick} onChange={(id) => setPick(id)} />
        {c.contact.phone && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            Khách đã nhắn số {c.contact.phone}: gõ số này để tìm.
          </Typography.Paragraph>
        )}
      </Modal>
      <CustomerFormModal
        open={creating}
        initialName={c.contact.name === 'Khách Facebook' ? undefined : c.contact.name}
        initialPhone={c.contact.phone ?? undefined}
        onClose={() => setCreating(false)}
        onSaved={async (saved) => {
          setCreating(false);
          await run(actions.linkCustomer.mutateAsync(saved.id), `Đã gắn ${saved.code}`);
        }}
      />
    </Flex>
  );
}
