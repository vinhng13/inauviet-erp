import { ArrowRightOutlined } from '@ant-design/icons';
import { Card, Col, Flex, Result, Row, Typography, theme } from 'antd';
import { useNavigate } from 'react-router';
import { useMe } from '../api/hooks';
import { Brand, UserMenu, firstPathOf } from '../layout/AppLayout';
import { useCan } from '../lib/access';
import { allowedModules } from '../lib/modules';

/** Shown after sign-in: the modules this account may use. Each opens with its own menu. */
export function ModulePickerPage() {
  const can = useCan();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { token } = theme.useToken();
  const modules = allowedModules(can);

  return (
    <div style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <Flex align="center" justify="space-between" style={{ padding: '8px 16px', background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Brand inline />
        <UserMenu />
      </Flex>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '40px 16px' }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Xin chào {me?.fullName}
        </Typography.Title>
        <Typography.Paragraph type="secondary">Chọn phân hệ để làm việc. Bạn có thể đổi phân hệ bất cứ lúc nào ở góc trên menu.</Typography.Paragraph>
        {modules.length === 0 ? (
          <Result status="info" title="Tài khoản chưa được cấp quyền nào" subTitle="Nhờ quản trị viên thêm quyền cho nhóm của bạn." />
        ) : (
          <Row gutter={[16, 16]}>
            {modules.map((m) => {
              const path = firstPathOf(m, can)!;
              return (
                <Col key={m.key} xs={24} md={8}>
                  <Card
                    hoverable
                    role="button"
                    tabIndex={0}
                    aria-label={`Vào ${m.name}`}
                    onClick={() => navigate(path)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(path)}
                    style={{ height: '100%', borderTop: `4px solid ${m.color}` }}
                  >
                    <Flex vertical gap={10}>
                      <div style={{ fontSize: 30, color: m.color }}>{m.icon}</div>
                      <Typography.Title level={4} style={{ margin: 0 }}>
                        {m.name}
                      </Typography.Title>
                      <Typography.Text type="secondary">{m.description}</Typography.Text>
                      <Typography.Text style={{ fontSize: 13 }}>{m.allowed.map((n) => n.label).join(' · ')}</Typography.Text>
                      <Typography.Link style={{ color: m.color }}>
                        Vào {m.name} <ArrowRightOutlined />
                      </Typography.Link>
                    </Flex>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </div>
    </div>
  );
}
