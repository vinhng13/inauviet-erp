import { CopyOutlined, KeyOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, App, Button, Dropdown, Flex, Form, Input, Modal, Radio, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { Schemas } from '../api/client';
import { useAccountMutations, useAccounts, useMe, useRoles } from '../api/hooks';
import { useCan } from '../lib/access';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

type Account = Schemas['AccountDto'];

/** Accounts are created by hand here. The password is either typed in or generated and shown once. */
export function AccountsPage() {
  const { modal, message } = App.useApp();
  const can = useCan();
  const { data: me } = useMe();
  const { data: accounts, isLoading } = useAccounts();
  const { data: roles } = useRoles(can('roles.view'));
  const mutations = useAccountMutations();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [resetting, setResetting] = useState<Account | null>(null);
  const [issued, setIssued] = useState<{ account: Account; password: string } | null>(null);

  const canTouch = (a: Account) => !a.isAdmin || !!me?.isAdmin;

  async function toggleActive(a: Account) {
    const lock = a.isActive;
    modal.confirm({
      title: lock ? `Khoá tài khoản ${a.username}?` : `Mở khoá ${a.username}?`,
      content: lock ? 'Người này bị đăng xuất ngay và không đăng nhập được cho tới khi mở khoá.' : 'Người này đăng nhập lại được bằng mật khẩu hiện có.',
      okText: lock ? 'Khoá' : 'Mở khoá',
      okButtonProps: { danger: lock },
      cancelText: 'Đóng',
      onOk: async () => {
        try {
          await mutations.update.mutateAsync({ id: a.id, body: { isActive: !a.isActive } });
          message.success(lock ? `Đã khoá ${a.username}` : `Đã mở khoá ${a.username}`);
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });
  }

  async function signOut(a: Account) {
    try {
      const r = await mutations.signOut.mutateAsync(a.id);
      message.success(r.count ? `Đã đăng xuất ${a.username} khỏi ${r.count} thiết bị` : `${a.username} không đăng nhập ở đâu`);
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  return (
    <Flex vertical gap={16} style={{ maxWidth: 1100 }}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Tài khoản
        </Typography.Title>
        {can('accounts.create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            Tạo tài khoản
          </Button>
        )}
      </Flex>
      <Table<Account>
        rowKey="id"
        loading={isLoading}
        dataSource={accounts}
        pagination={false}
        scroll={{ x: 900 }}
        rowClassName={(a) => (a.isActive ? '' : 'row-voided')}
        columns={[
          {
            title: 'Tài khoản',
            render: (_, a) => (
              <div>
                <Typography.Text strong>{a.fullName}</Typography.Text>
                {a.id === me?.id && <Tag style={{ marginLeft: 6 }}>Bạn</Tag>}
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {a.username}
                  {a.email ? ` · ${a.email}` : ''}
                </div>
              </div>
            ),
          },
          { title: 'Nhóm quyền', dataIndex: 'roleName', width: 160, render: (v, a) => <Tag color={a.isAdmin ? 'gold' : 'blue'}>{v}</Tag> },
          {
            title: 'Trạng thái',
            width: 190,
            render: (_, a) =>
              !a.isActive ? (
                <Tag>Đã khoá</Tag>
              ) : !a.hasPassword ? (
                <Tag color="orange">Chưa có mật khẩu</Tag>
              ) : a.mustChangePassword ? (
                <Tag color="orange">Chờ đổi mật khẩu tạm</Tag>
              ) : (
                <Tag color="green">Hoạt động</Tag>
              ),
          },
          { title: 'Lần cuối dùng', dataIndex: 'lastSeenAt', width: 160, render: (v) => (v ? formatDateTime(v) : 'Chưa đăng nhập') },
          {
            title: '',
            width: 60,
            render: (_, a) => {
              if (!canTouch(a)) return null;
              const self = a.id === me?.id;
              const items = [
                can('accounts.update') && { key: 'edit', label: 'Sửa thông tin, nhóm quyền' },
                can('accounts.resetPassword') && !self && { key: 'reset', label: 'Đặt lại mật khẩu', icon: <KeyOutlined /> },
                can('accounts.update') && !self && { key: 'signout', label: 'Đăng xuất mọi thiết bị' },
                can('accounts.update') && !self && { key: 'toggle', label: a.isActive ? 'Khoá tài khoản' : 'Mở khoá', danger: a.isActive },
              ].filter(Boolean) as Array<{ key: string; label: string; danger?: boolean }>;
              if (!items.length) return null;
              return (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items,
                    onClick: ({ key }) => {
                      if (key === 'edit') setEditing(a);
                      if (key === 'reset') setResetting(a);
                      if (key === 'signout') void signOut(a);
                      if (key === 'toggle') void toggleActive(a);
                    },
                  }}
                >
                  <Button type="text" icon={<MoreOutlined />} aria-label={`Thao tác với ${a.username}`} />
                </Dropdown>
              );
            },
          },
        ]}
      />

      {editing && (
        <AccountModal
          account={editing === 'new' ? undefined : editing}
          roles={(roles ?? []).filter((r) => !r.isSystem || me?.isAdmin)}
          isSelf={editing !== 'new' && editing.id === me?.id}
          onClose={() => setEditing(null)}
          onIssued={(account, password) => setIssued({ account, password })}
        />
      )}
      {resetting && (
        <ResetModal
          account={resetting}
          onClose={() => setResetting(null)}
          onIssued={(account, password) => setIssued({ account, password })}
        />
      )}
      <IssuedPasswordModal issued={issued} onClose={() => setIssued(null)} />
    </Flex>
  );
}

interface AccountValues {
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  roleId: string;
  passwordMode: 'generate' | 'manual';
  password?: string;
}

function AccountModal({
  account,
  roles,
  isSelf,
  onClose,
  onIssued,
}: {
  account?: Account;
  roles: Schemas['RoleDto'][];
  isSelf: boolean;
  onClose: () => void;
  onIssued: (a: Account, password: string) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<AccountValues>();
  const { create, update } = useAccountMutations();
  const mode = Form.useWatch('passwordMode', form);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const v = await form.validateFields();
    setError(null);
    const base = { username: v.username.trim().toLowerCase(), fullName: v.fullName.trim(), email: v.email?.trim() || undefined, phone: v.phone?.trim() || undefined, roleId: v.roleId };
    try {
      if (account) {
        await update.mutateAsync({ id: account.id, body: base });
        message.success('Đã lưu tài khoản');
        onClose();
      } else {
        const r = await create.mutateAsync({ ...base, password: v.passwordMode === 'manual' ? v.password : undefined });
        message.success(`Đã tạo tài khoản ${r.account.username}`);
        onClose();
        onIssued(r.account, r.temporaryPassword ?? v.password ?? '');
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      open
      title={account ? `Sửa tài khoản ${account.username}` : 'Tạo tài khoản'}
      okText={account ? 'Lưu' : 'Tạo tài khoản'}
      cancelText="Đóng"
      confirmLoading={create.isPending || update.isPending}
      onCancel={onClose}
      onOk={save}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={
          account
            ? { username: account.username, fullName: account.fullName, email: account.email ?? undefined, phone: account.phone ?? undefined, roleId: account.roleId }
            : { passwordMode: 'generate', roleId: roles.find((r) => !r.isSystem)?.id }
        }
      >
        <Form.Item name="fullName" label="Họ tên" rules={[{ required: true, whitespace: true, message: 'Nhập họ tên' }]}>
          <Input id="acc-name" maxLength={120} autoFocus />
        </Form.Item>
        <Form.Item
          name="username"
          label="Tên đăng nhập"
          extra="3–32 ký tự: chữ thường không dấu, số, dấu chấm, gạch ngang. Ví dụ: lan.nguyen"
          normalize={(v: string) => v?.toLowerCase().replace(/\s/g, '')}
          rules={[
            { required: true, message: 'Nhập tên đăng nhập' },
            { pattern: /^[a-z0-9][a-z0-9._-]{2,31}$/, message: 'Chỉ dùng chữ thường không dấu, số, . - _ (3–32 ký tự)' },
          ]}
        >
          <Input id="acc-username" maxLength={32} autoCapitalize="none" />
        </Form.Item>
        <Form.Item name="roleId" label="Nhóm quyền" rules={[{ required: true, message: 'Chọn nhóm quyền' }]} extra={isSelf ? 'Không tự đổi nhóm quyền của chính mình được.' : undefined}>
          <Select
            id="acc-role"
            disabled={isSelf}
            options={roles.map((r) => ({ value: r.id, label: r.name + (r.isSystem ? ' (toàn quyền)' : '') }))}
            notFoundContent="Bạn cần quyền xem nhóm quyền"
          />
        </Form.Item>
        <Space.Compact block>
          <Form.Item name="email" label="Email (không bắt buộc)" rules={[{ type: 'email', message: 'Email không hợp lệ' }]} style={{ flex: 1, marginRight: 12 }}>
            <Input id="acc-email" maxLength={200} />
          </Form.Item>
          <Form.Item name="phone" label="Điện thoại" style={{ width: 160 }}>
            <Input id="acc-phone" maxLength={20} />
          </Form.Item>
        </Space.Compact>
        {!account && (
          <>
            <Form.Item name="passwordMode" label="Mật khẩu ban đầu">
              <Radio.Group
                id="acc-pw-mode"
                options={[
                  { value: 'generate', label: 'Tạo mật khẩu tạm ngẫu nhiên' },
                  { value: 'manual', label: 'Tự nhập' },
                ]}
              />
            </Form.Item>
            {mode === 'manual' && (
              <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: 'Nhập mật khẩu' }, { min: 8, message: 'Ít nhất 8 ký tự' }]}>
                <Input.Password id="acc-password" autoComplete="new-password" />
              </Form.Item>
            )}
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Người dùng phải đổi mật khẩu này ở lần đăng nhập đầu tiên.
            </Typography.Paragraph>
          </>
        )}
      </Form>
    </Modal>
  );
}

function ResetModal({ account, onClose, onIssued }: { account: Account; onClose: () => void; onIssued: (a: Account, password: string) => void }) {
  const { message } = App.useApp();
  const { resetPassword } = useAccountMutations();
  const [manual, setManual] = useState(false);
  const [password, setPassword] = useState('');
  return (
    <Modal
      open
      title={`Đặt lại mật khẩu cho ${account.username}`}
      okText="Đặt lại"
      cancelText="Đóng"
      confirmLoading={resetPassword.isPending}
      okButtonProps={{ disabled: manual && password.length < 8 }}
      onCancel={onClose}
      onOk={async () => {
        try {
          const r = await resetPassword.mutateAsync({ id: account.id, password: manual ? password : undefined });
          message.success('Đã đặt lại mật khẩu');
          onClose();
          onIssued(r.account, r.temporaryPassword ?? password);
        } catch (err) {
          message.error(errorMessage(err));
        }
      }}
    >
      <Flex vertical gap={12}>
        <Typography.Text>{account.fullName} sẽ bị đăng xuất khỏi mọi thiết bị và phải đổi mật khẩu khi đăng nhập lại.</Typography.Text>
        <Radio.Group
          id="reset-mode"
          value={manual ? 'manual' : 'generate'}
          onChange={(e) => setManual(e.target.value === 'manual')}
          options={[
            { value: 'generate', label: 'Tạo mật khẩu tạm ngẫu nhiên' },
            { value: 'manual', label: 'Tự nhập' },
          ]}
        />
        {manual && <Input.Password id="reset-password" placeholder="Ít nhất 8 ký tự" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
      </Flex>
    </Modal>
  );
}

/** The only place a generated password is ever shown. */
function IssuedPasswordModal({ issued, onClose }: { issued: { account: Account; password: string } | null; onClose: () => void }) {
  const { message } = App.useApp();
  if (!issued) return null;
  const text = `Tên đăng nhập: ${issued.account.username}\nMật khẩu tạm: ${issued.password}`;
  return (
    <Modal open title="Gửi thông tin đăng nhập" okText="Đã ghi lại" onOk={onClose} onCancel={onClose} cancelButtonProps={{ style: { display: 'none' } }}>
      <Flex vertical gap={12}>
        <Alert type="warning" showIcon title="Mật khẩu này chỉ hiện một lần. Gửi cho người dùng qua Zalo hoặc nói trực tiếp." />
        <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '12px 16px', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 15, lineHeight: 1.8 }}>
          <div>
            Tên đăng nhập: <strong>{issued.account.username}</strong>
          </div>
          <div>
            Mật khẩu tạm: <strong>{issued.password}</strong>
          </div>
        </div>
        <Button
          icon={<CopyOutlined />}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              message.success('Đã chép');
            } catch {
              message.info('Không chép tự động được, hãy bôi đen và chép tay');
            }
          }}
        >
          Chép
        </Button>
      </Flex>
    </Modal>
  );
}
