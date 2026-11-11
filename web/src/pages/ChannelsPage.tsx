import { CheckCircleFilled, CloseCircleFilled, FacebookFilled, ReloadOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, App, Avatar, Button, Card, Checkbox, Flex, Input, Modal, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useState } from 'react';
import type { Schemas } from '../api/client';
import { useChannelActions, useChannels } from '../api/chat';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

dayjs.extend(relativeTime);

const STATUS: Record<Schemas['ChannelStatus'], { color: string; label: string }> = {
  ACTIVE: { color: 'green', label: 'Đang nhận tin' },
  ERROR: { color: 'red', label: 'Lỗi' },
  DISCONNECTED: { color: 'default', label: 'Đã ngắt' },
};

function Check({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <Flex gap={8} align="flex-start">
      {ok ? <CheckCircleFilled style={{ color: '#389e0d', marginTop: 4 }} /> : <CloseCircleFilled style={{ color: '#cf1322', marginTop: 4 }} />}
      <div>
        <Typography.Text strong>{label}</Typography.Text>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{hint}</div>
      </div>
    </Flex>
  );
}

/** "Kết nối kênh" (Quản trị): connect fanpages with an access token and watch whether events arrive. */
export function ChannelsPage() {
  const { message } = App.useApp();
  const { data, isLoading } = useChannels();
  const actions = useChannelActions();
  const [connecting, setConnecting] = useState(false);
  const setup = data?.setup;
  const callback = `${window.location.origin}${setup?.callbackPath ?? '/api/v1/webhooks/facebook'}`;
  const ready = !!setup && setup.appSecret && setup.verifyToken && setup.secretKey;

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      message.success(ok);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Kết nối kênh
        </Typography.Title>
        <Button type="primary" icon={<FacebookFilled />} disabled={!setup?.secretKey} onClick={() => setConnecting(true)}>
          Kết nối Facebook
        </Button>
      </Flex>

      <Card size="small" title="Cấu hình máy chủ" loading={isLoading} extra={ready ? <Tag color="green">Đủ</Tag> : <Tag color="orange">Còn thiếu</Tag>}>
        {setup && (
          <Flex vertical gap={10}>
            <Check ok={setup.secretKey} label="CHANNEL_SECRET_KEY" hint="Khoá mã hoá mã truy cập trước khi lưu. Thiếu thì không kết nối được." />
            <Check ok={setup.appSecret} label="FB_APP_SECRET" hint="App Secret của ứng dụng Meta, dùng kiểm chữ ký mỗi sự kiện. Thiếu thì CRM từ chối mọi sự kiện." />
            <Check ok={setup.verifyToken} label="FB_VERIFY_TOKEN" hint="Chuỗi ngẫu nhiên tự đặt, nhập giống hệt vào mục Webhooks của ứng dụng Meta." />
            <div>
              <Typography.Text strong>Callback URL</Typography.Text> <Typography.Text type="secondary">(nhập vào Meta → Webhooks, đối tượng Page)</Typography.Text>
              <div>
                <Typography.Text code copyable>
                  {callback}
                </Typography.Text>
              </div>
              {window.location.protocol !== 'https:' && (
                <Typography.Text type="warning" style={{ fontSize: 12 }}>
                  Meta chỉ gọi được địa chỉ HTTPS công khai: dùng tên miền của máy chủ chạy thật, không dùng localhost.
                </Typography.Text>
              )}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Ba biến trên nằm trong tệp .env của API; sửa xong khởi động lại API. Graph API {setup.graphVersion}.
            </Typography.Text>
          </Flex>
        )}
      </Card>

      {!!data?.failedEvents.length && (
        <Alert
          type="error"
          showIcon
          title={`${data.failedEvents.length} sự kiện không xử lý được sau 5 lần thử`}
          description={
            <Flex vertical gap={4}>
              {data.failedEvents.slice(0, 5).map((e) => (
                <Typography.Text key={e.id} style={{ fontSize: 12 }}>
                  {formatDateTime(e.receivedAt)}: {e.lastError}
                </Typography.Text>
              ))}
            </Flex>
          }
          action={
            <Button size="small" icon={<ReloadOutlined />} loading={actions.retry.isPending} onClick={() => run(actions.retry.mutateAsync(), 'Đã đưa lại vào hàng đợi')}>
              Chạy lại
            </Button>
          }
        />
      )}
      {!!data?.pendingEvents && <Alert type="info" showIcon title={`${data.pendingEvents} sự kiện đang chờ xử lý`} />}

      <Table<Schemas['ChannelDto']>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.channels}
        pagination={false}
        scroll={{ x: 900 }}
        locale={{ emptyText: 'Chưa kết nối fanpage nào' }}
        columns={[
          {
            title: 'Fanpage',
            render: (_, c) => (
              <Space>
                <Avatar src={c.pictureUrl ?? undefined} icon={<UserOutlined />} />
                <div>
                  <div style={{ fontWeight: 500 }}>{c.name}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    ID {c.externalId}
                  </Typography.Text>
                </div>
              </Space>
            ),
          },
          { title: 'Trạng thái', width: 130, render: (_, c) => <Tag color={STATUS[c.status].color}>{STATUS[c.status].label}</Tag> },
          {
            title: 'Sự kiện cuối',
            width: 150,
            render: (_, c) => (c.lastEventAt ? <Tooltip title={formatDateTime(c.lastEventAt)}>{dayjs(c.lastEventAt).fromNow()}</Tooltip> : <Typography.Text type="secondary">Chưa có</Typography.Text>),
          },
          { title: 'Hội thoại', dataIndex: 'conversations', width: 90, align: 'right' },
          {
            title: 'Lỗi gần nhất',
            render: (_, c) =>
              c.lastError ? (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  {c.lastErrorAt && `${formatDateTime(c.lastErrorAt)}: `}
                  {c.lastError}
                </Typography.Text>
              ) : (
                '—'
              ),
          },
          {
            title: 'Kết nối bởi',
            width: 160,
            render: (_, c) => (
              <span style={{ fontSize: 12 }}>
                {c.connectedBy ?? '—'}
                <br />
                <Typography.Text type="secondary">{formatDateTime(c.connectedAt)}</Typography.Text>
              </span>
            ),
          },
          {
            title: '',
            width: 200,
            render: (_, c) =>
              c.status === 'DISCONNECTED' ? (
                <Button size="small" onClick={() => setConnecting(true)}>
                  Kết nối lại
                </Button>
              ) : (
                <Space>
                  <Button size="small" loading={actions.check.isPending && actions.check.variables === c.id} onClick={() => run(actions.check.mutateAsync(c.id), 'Đã kiểm tra')}>
                    Kiểm tra
                  </Button>
                  <Popconfirm
                    title="Ngắt kết nối fanpage này?"
                    description="CRM sẽ không nhận tin mới và không gửi được tin. Hội thoại cũ vẫn giữ."
                    okText="Ngắt"
                    cancelText="Không"
                    onConfirm={() => run(actions.disconnect.mutateAsync(c.id), 'Đã ngắt kết nối')}
                  >
                    <Button size="small" danger>
                      Ngắt
                    </Button>
                  </Popconfirm>
                </Space>
              ),
          },
        ]}
      />

      <ConnectModal open={connecting} onClose={() => setConnecting(false)} />
    </Flex>
  );
}

function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const { preview, connect } = useChannelActions();
  const [token, setToken] = useState('');
  const [pages, setPages] = useState<Schemas['FacebookPageDto'][] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [results, setResults] = useState<Schemas['ConnectResultDto'][] | null>(null);

  const reset = () => {
    setToken('');
    setPages(null);
    setChosen([]);
    setResults(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  async function load() {
    try {
      const res = await preview.mutateAsync(token.trim());
      setPages(res.pages);
      setChosen(res.pages.filter((p) => !p.connected).map((p) => p.id));
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  async function save() {
    try {
      const res = await connect.mutateAsync({ accessToken: token.trim(), pageIds: chosen });
      setResults(res.results);
      const ok = res.results.filter((r) => r.ok).length;
      if (ok) message.success(`Đã kết nối ${ok} fanpage`);
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  const footer = results ? (
    <Button type="primary" onClick={close}>
      Xong
    </Button>
  ) : pages ? (
    <Space>
      <Button onClick={() => setPages(null)}>Quay lại</Button>
      <Button type="primary" disabled={!chosen.length} loading={connect.isPending} onClick={save}>
        Kết nối {chosen.length || ''} fanpage
      </Button>
    </Space>
  ) : (
    <Button type="primary" disabled={token.trim().length < 20} loading={preview.isPending} onClick={load}>
      Lấy danh sách fanpage
    </Button>
  );

  return (
    <Modal open={open} title="Kết nối fanpage Facebook" onCancel={close} footer={footer} destroyOnHidden width={560}>
      {results ? (
        <Flex vertical gap={8}>
          {results.map((r) => (
            <Alert key={r.pageId} type={r.ok ? 'success' : 'error'} showIcon title={r.name} description={r.ok ? 'Đã đăng ký nhận tin nhắn và bình luận.' : r.error} />
          ))}
        </Flex>
      ) : pages ? (
        <Flex vertical gap={10}>
          <Typography.Text>Chọn fanpage cần đưa tin nhắn về CRM:</Typography.Text>
          <Checkbox.Group value={chosen} onChange={(v) => setChosen(v as string[])} style={{ width: '100%' }}>
            <Flex vertical gap={8} style={{ width: '100%' }}>
              {pages.map((p) => (
                <Checkbox key={p.id} value={p.id}>
                  <Space>
                    <Avatar size="small" src={p.pictureUrl ?? undefined} icon={<UserOutlined />} />
                    {p.name}
                    {p.connected && <Tag color="green">Đang kết nối</Tag>}
                  </Space>
                </Checkbox>
              ))}
            </Flex>
          </Checkbox.Group>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            CRM lấy mã riêng của từng fanpage, mã hoá rồi lưu; mã bạn vừa dán không được lưu.
          </Typography.Text>
        </Flex>
      ) : (
        <Flex vertical gap={10}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            Dán mã truy cập (access token) lấy từ Meta. Nên dùng mã của <b>người dùng hệ thống</b> trong Business Manager, hạn &quot;Không bao giờ&quot;, có quyền
            pages_show_list, pages_messaging, pages_manage_metadata, pages_read_engagement, pages_manage_engagement. Mã của một fanpage cũng dùng được.
          </Typography.Paragraph>
          <Input.Password id="fb-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG…" autoComplete="off" />
        </Flex>
      )}
    </Modal>
  );
}
