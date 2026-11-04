import { DeleteOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, App, Badge, Button, Card, Checkbox, Col, Empty, Flex, Form, Input, Row, Skeleton, Space, Table, Tag, Tooltip, Typography, theme } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { Schemas } from '../api/client';
import { useMe, usePermissionCatalog, useRoleMutations, useRoles } from '../api/hooks';
import { useCan } from '../lib/access';
import { errorMessage } from '../lib/errors';

type Role = Schemas['RoleDto'];
type Module = Schemas['PermissionModuleDto'];
type Action = Schemas['PermissionActionDto'];

/** Matrix columns. Actions not in a fixed column are listed under "Khác". */
const COLUMNS: Array<{ key: string; title: string; match: (a: string) => boolean }> = [
  { key: 'view', title: 'Xem', match: (a) => a === 'view' },
  { key: 'create', title: 'Thêm', match: (a) => a === 'create' },
  { key: 'update', title: 'Sửa', match: (a) => a === 'update' },
  { key: 'cancel', title: 'Huỷ', match: (a) => a === 'cancel' || a === 'void' },
];
const isFixed = (a: string) => COLUMNS.some((c) => c.match(a));

export function RolesPage() {
  const can = useCan();
  const { data: me } = useMe();
  const { data: roles, isLoading } = useRoles();
  const { data: catalog } = usePermissionCatalog();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const { token } = theme.useToken();

  useEffect(() => {
    if (!selected && roles?.length) setSelected(roles[0].id);
  }, [roles, selected]);

  const current = selected === 'new' ? null : roles?.find((r) => r.id === selected);

  return (
    <Flex vertical gap={16} style={{ maxWidth: 1240 }}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Nhóm quyền
        </Typography.Title>
        {can('roles.manage') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setSelected('new')}>
            Thêm nhóm
          </Button>
        )}
      </Flex>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7}>
          <Card size="small" styles={{ body: { padding: 4 } }}>
            {isLoading && <Skeleton active style={{ padding: 12 }} />}
            <Flex vertical gap={2} role="list">
              {(roles ?? []).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="listitem"
                  onClick={() => setSelected(r.id)}
                  aria-current={r.id === selected}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    padding: '10px 12px',
                    borderRadius: token.borderRadius,
                    background: r.id === selected ? token.colorPrimaryBg : undefined,
                  }}
                >
                  <Space size={6}>
                    {r.isSystem && <SafetyCertificateOutlined style={{ color: token.colorWarning }} />}
                    <Typography.Text strong>{r.name}</Typography.Text>
                    {r.id === me?.roleId && <Tag>Nhóm của bạn</Tag>}
                  </Space>
                  <div style={{ fontSize: 13, color: token.colorTextSecondary }}>
                    {r.userCount} tài khoản · {r.isSystem ? 'toàn quyền' : `${r.permissions.length} quyền`}
                  </div>
                </button>
              ))}
            </Flex>
          </Card>
        </Col>
        <Col xs={24} lg={17}>
          {catalog && (selected === 'new' || current) ? (
            <RoleEditor
              key={selected ?? 'none'}
              role={current ?? undefined}
              catalog={catalog}
              readOnly={!can('roles.manage') || !!current?.isSystem || (current?.id === me?.roleId && !me?.isAdmin)}
              ownGroup={current?.id === me?.roleId}
              onSaved={(r) => setSelected(r.id)}
              onDeleted={() => setSelected(null)}
            />
          ) : (
            <Card>
              <Empty description="Chọn một nhóm quyền" />
            </Card>
          )}
        </Col>
      </Row>
    </Flex>
  );
}

function RoleEditor({
  role,
  catalog,
  readOnly,
  ownGroup,
  onSaved,
  onDeleted,
}: {
  role?: Role;
  catalog: Module[];
  readOnly: boolean;
  ownGroup: boolean;
  onSaved: (r: Role) => void;
  onDeleted: () => void;
}) {
  const { message, modal } = App.useApp();
  const { create, update, remove } = useRoleMutations();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);

  const actions = useMemo(() => catalog.flatMap((m) => m.actions), [catalog]);
  const byKey = useMemo(() => new Map(actions.map((a) => [a.permission, a])), [actions]);

  /** Ticking adds what it implies; unticking removes what depends on it. */
  function toggle(permission: string, on: boolean) {
    const next = new Set(perms);
    if (on) {
      const add = (p: string) => {
        if (next.has(p)) return;
        next.add(p);
        byKey.get(p)?.implies.forEach(add);
      };
      add(permission);
    } else {
      const drop = (p: string) => {
        if (!next.delete(p)) return;
        actions.filter((a) => a.implies.includes(p)).forEach((a) => drop(a.permission));
      };
      drop(permission);
    }
    setPerms(next);
    setError(null);
  }

  function toggleModule(m: Module, on: boolean) {
    let next = new Set(perms);
    for (const a of m.actions) {
      if (on) {
        const add = (p: string) => {
          if (next.has(p)) return;
          next.add(p);
          byKey.get(p)?.implies.forEach(add);
        };
        add(a.permission);
      } else next.delete(a.permission);
    }
    if (!on) {
      // also drop permissions elsewhere that depended on this module
      next = new Set([...next].filter((p) => (byKey.get(p)?.implies ?? []).every((q) => next.has(q))));
    }
    setPerms(next);
  }

  async function save() {
    if (!name.trim()) {
      setError('Nhập tên nhóm');
      return;
    }
    const body = { name: name.trim(), description: description.trim() || undefined, permissions: [...perms] };
    try {
      const saved = role ? await update.mutateAsync({ id: role.id, body }) : await create.mutateAsync(body);
      message.success(role ? `Đã lưu nhóm ${saved.name}` : `Đã tạo nhóm ${saved.name}`);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function confirmDelete() {
    if (!role) return;
    modal.confirm({
      title: `Xoá nhóm ${role.name}?`,
      content: role.userCount ? `Còn ${role.userCount} tài khoản trong nhóm. Chuyển họ sang nhóm khác trước.` : 'Không còn tài khoản nào dùng nhóm này.',
      okText: 'Xoá',
      okButtonProps: { danger: true, disabled: role.userCount > 0 },
      cancelText: 'Đóng',
      onOk: async () => {
        try {
          await remove.mutateAsync(role.id);
          message.success('Đã xoá nhóm');
          onDeleted();
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });
  }

  const check = (a: Action | undefined) =>
    a ? (
      <Tooltip title={a.description}>
        <Checkbox
          id={`perm-${a.permission}`}
          checked={role?.isSystem || perms.has(a.permission)}
          disabled={readOnly}
          onChange={(e) => toggle(a.permission, e.target.checked)}
          aria-label={a.permission}
        />
      </Tooltip>
    ) : (
      <Typography.Text type="secondary">—</Typography.Text>
    );

  return (
    <Card
      size="small"
      title={role ? role.name : 'Nhóm quyền mới'}
      extra={
        !readOnly && (
          <Space>
            {role && (
              <Button danger icon={<DeleteOutlined />} onClick={confirmDelete}>
                Xoá
              </Button>
            )}
            <Button type="primary" loading={create.isPending || update.isPending} onClick={save}>
              {role ? 'Lưu' : 'Tạo nhóm'}
            </Button>
          </Space>
        )
      }
    >
      <Flex vertical gap={16}>
        {role?.isSystem && <Alert type="info" showIcon title="Nhóm có sẵn, luôn có toàn quyền. Không sửa hoặc xoá được." />}
        {readOnly && !role?.isSystem && ownGroup && (
          <Alert type="info" showIcon title="Đây là nhóm của bạn. Chỉ quản trị viên mới sửa được, để không ai tự cấp thêm quyền cho mình." />
        )}
        {error && <Alert type="error" showIcon title={error} />}
        <Form layout="vertical" component="div">
          <Row gutter={12}>
            <Col xs={24} md={9}>
              <Form.Item label="Tên nhóm" style={{ marginBottom: 0 }}>
                <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} maxLength={80} placeholder="Ví dụ: Giao hàng" />
              </Form.Item>
            </Col>
            <Col xs={24} md={15}>
              <Form.Item label="Mô tả" style={{ marginBottom: 0 }}>
                <Input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} maxLength={300} />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <Table<Module>
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={catalog}
          scroll={{ x: 720 }}
          columns={[
            {
              title: 'Module',
              width: 190,
              render: (_, m) => {
                const on = m.actions.filter((a) => role?.isSystem || perms.has(a.permission)).length;
                return (
                  <Checkbox
                    id={`mod-${m.key}`}
                    checked={on === m.actions.length}
                    indeterminate={on > 0 && on < m.actions.length}
                    disabled={readOnly}
                    onChange={(e) => toggleModule(m, e.target.checked)}
                  >
                    <Typography.Text strong>{m.label}</Typography.Text>
                  </Checkbox>
                );
              },
            },
            ...COLUMNS.map((c) => ({
              title: c.title,
              key: c.key,
              width: 70,
              align: 'center' as const,
              render: (_: unknown, m: Module) => check(m.actions.find((a) => c.match(a.key))),
            })),
            {
              title: 'Khác',
              key: 'other',
              render: (_: unknown, m: Module) => {
                const others = m.actions.filter((a) => !isFixed(a.key));
                if (!others.length) return <Typography.Text type="secondary">—</Typography.Text>;
                return (
                  <Flex wrap gap="4px 16px">
                    {others.map((a) => (
                      <Tooltip key={a.permission} title={a.description}>
                        <Checkbox
                          id={`perm-${a.permission}`}
                          checked={role?.isSystem || perms.has(a.permission)}
                          disabled={readOnly}
                          onChange={(e) => toggle(a.permission, e.target.checked)}
                        >
                          {a.label}
                        </Checkbox>
                      </Tooltip>
                    ))}
                  </Flex>
                );
              },
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
          Rê chuột lên ô để xem quyền đó cho làm gì. Tick một quyền sẽ tự tick quyền cần thiết đi kèm (ví dụ <em>Thêm đơn</em> cần <em>Xem đơn</em>).
          Thay đổi có hiệu lực ngay ở thao tác tiếp theo của mọi tài khoản trong nhóm.{' '}
          {role && <Badge status="processing" text={`${role.userCount} tài khoản đang dùng nhóm này`} />}
        </Typography.Paragraph>
      </Flex>
    </Card>
  );
}
