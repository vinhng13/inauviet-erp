import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider, Result, Spin } from 'antd';
import viVN from 'antd/locale/vi_VN';
import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ApiError } from './api/client';
import { keys, useMe } from './api/hooks';
import { AppLayout } from './layout/AppLayout';
import { useCan, type Permission } from './lib/access';
import { errorMessage } from './lib/errors';
import './lib/format';
import { AccountsPage } from './pages/AccountsPage';
import { AccountingAssetsPage } from './pages/accounting/AssetsPage';
import { AccountingCashPage } from './pages/accounting/CashPage';
import { AccountingDebtsPage } from './pages/accounting/DebtsPage';
import { AccountingJournalPage } from './pages/accounting/JournalPage';
import { AccountingOverviewPage } from './pages/accounting/OverviewPage';
import { AccountingPeriodsPage } from './pages/accounting/PeriodsPage';
import { AccountingReportsPage } from './pages/accounting/ReportsPage';
import { AccountingStockPage } from './pages/accounting/StockPage';
import { AccountingTaxPage } from './pages/accounting/TaxPage';
import { ModulePickerPage } from './pages/ModulePickerPage';
import { BoardPage } from './pages/BoardPage';
import { CustomerDetailPage } from './pages/CustomerDetailPage';
import { CustomersPage } from './pages/CustomersPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { DesignPage } from './pages/DesignPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ProductionPage } from './pages/ProductionPage';
import { ForcePasswordPage } from './pages/ForcePasswordPage';
import { LoginPage } from './pages/LoginPage';
import { NewOrderPage } from './pages/NewOrderPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrdersPage } from './pages/OrdersPage';
import { ProductsPage } from './pages/ProductsPage';
import { QuoteDetailPage } from './pages/QuoteDetailPage';
import { QuoteEditorPage } from './pages/QuoteEditorPage';
import { QuotesPage } from './pages/QuotesPage';
import { RolesPage } from './pages/RolesPage';

/** Any 401 means the session ended (expired, logged out elsewhere, account locked): show the sign-in page. */
function onAuthError(err: unknown) {
  if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(keys.me, null);
  if (err instanceof ApiError && err.code === 'PASSWORD_CHANGE_REQUIRED') void queryClient.invalidateQueries({ queryKey: keys.me });
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      // No live updates: refetch when a page opens and when the tab regains focus.
      refetchOnWindowFocus: true,
      staleTime: 10_000,
      retry: (count, err) => !(err instanceof ApiError && err.body.statusCode < 500) && count < 2,
    },
  },
});

const theme = {
  token: {
    colorPrimary: '#0a6f9c',
    fontFamily: '"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif',
    borderRadius: 8,
  },
};

export function App() {
  return (
    <ConfigProvider locale={viVN} theme={theme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <SignInGate>
              <Routes>
                <Route index element={<ModulePickerPage />} />
                <Route element={<AppLayout />}>
                  <Route path="/board" element={<Allow p="orders.view"><BoardPage /></Allow>} />
                  <Route path="/quotes" element={<Allow p="quotes.view"><QuotesPage /></Allow>} />
                  <Route path="/quotes/new" element={<Allow p="quotes.create"><QuoteEditorPage /></Allow>} />
                  <Route path="/quotes/:id" element={<Allow p="quotes.view"><QuoteDetailPage /></Allow>} />
                  <Route path="/quotes/:id/edit" element={<Allow p="quotes.update"><QuoteEditorPage /></Allow>} />
                  <Route path="/orders" element={<Allow p="orders.view"><OrdersPage /></Allow>} />
                  <Route path="/orders/new" element={<Allow p="orders.create"><NewOrderPage /></Allow>} />
                  <Route path="/orders/:id" element={<Allow p="orders.view"><OrderDetailPage /></Allow>} />
                  <Route path="/design" element={<Allow p="design.view"><DesignPage /></Allow>} />
                  <Route path="/production" element={<Allow p="production.view"><ProductionPage /></Allow>} />
                  <Route path="/deliveries" element={<Allow p="deliveries.view"><DeliveriesPage /></Allow>} />
                  <Route path="/payments" element={<Allow p="payments.view"><PaymentsPage /></Allow>} />
                  <Route path="/accounting" element={<Allow p="accounting.view"><AccountingOverviewPage /></Allow>} />
                  <Route path="/accounting/periods" element={<Allow p="accounting.view"><AccountingPeriodsPage /></Allow>} />
                  <Route path="/accounting/cash" element={<Allow p="accounting.view"><AccountingCashPage /></Allow>} />
                  <Route path="/accounting/debts" element={<Allow p="accounting.view"><AccountingDebtsPage /></Allow>} />
                  <Route path="/accounting/stock" element={<Allow p="accounting.view"><AccountingStockPage /></Allow>} />
                  <Route path="/accounting/assets" element={<Allow p="accounting.view"><AccountingAssetsPage /></Allow>} />
                  <Route path="/accounting/tax" element={<Allow p="accounting.view"><AccountingTaxPage /></Allow>} />
                  <Route path="/accounting/journal" element={<Allow p="accounting.view"><AccountingJournalPage /></Allow>} />
                  <Route path="/accounting/reports" element={<Allow p="accounting.view"><AccountingReportsPage /></Allow>} />
                  <Route path="/customers" element={<Allow p="customers.view"><CustomersPage /></Allow>} />
                  <Route path="/customers/:id" element={<Allow p="customers.view"><CustomerDetailPage /></Allow>} />
                  <Route path="/products" element={<Allow p="products.view"><ProductsPage /></Allow>} />
                  <Route path="/accounts" element={<Allow p="accounts.view"><AccountsPage /></Allow>} />
                  <Route path="/roles" element={<Allow p="roles.view"><RolesPage /></Allow>} />
                  <Route path="*" element={<Result status="404" title="Không có trang này" />} />
                </Route>
              </Routes>
            </SignInGate>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}

/** Nobody signed in → sign-in page. Temporary password → choose a new one first. */
function SignInGate({ children }: { children: ReactNode }) {
  const { data: me, error, isLoading } = useMe();
  if (isLoading) return <Spin fullscreen description="Đang tải" />;
  if (error) return <Result status="warning" title="Không kết nối được máy chủ" subTitle={errorMessage(error)} />;
  if (!me) return <LoginPage />;
  if (me.mustChangePassword) return <ForcePasswordPage />;
  return <>{children}</>;
}

function Allow({ p, children }: { p: Permission; children: ReactNode }) {
  const can = useCan();
  return can(p) ? <>{children}</> : <Result status="403" title="Bạn không có quyền xem trang này" subTitle="Nhờ quản trị viên cấp thêm quyền nếu cần." />;
}
