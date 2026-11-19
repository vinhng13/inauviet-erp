import { ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Giao diện theo mẫu DropX Admin (miễn phí): chữ Geist, màu chính chàm (indigo), nền xám rất nhạt,
 * thẻ bo 12px viền mảnh, menu trái trắng; có chế độ tối. Chỉ dùng thư viện miễn phí:
 * Ant Design (MIT), Geist (OFL, tự host qua @fontsource), biểu tượng Lucide (ISC).
 */
export type ThemeMode = 'light' | 'dark';

const PALETTE = {
  light: {
    primary: '#6366f1',
    bg: '#f9fafb',
    card: '#ffffff',
    sidebar: '#ffffff',
    border: '#e5e7eb',
    borderSoft: '#f3f4f6',
    text: '#111827',
    textSecondary: '#6b7280',
    sidebarText: '#374151',
    hover: '#f3f4f6',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
    shadow: '0 1px 3px 0 rgba(0,0,0,.05), 0 1px 2px -1px rgba(0,0,0,.05)',
  },
  dark: {
    primary: '#818cf8',
    bg: '#0f172a',
    card: '#1e293b',
    sidebar: '#1e293b',
    border: '#334155',
    borderSoft: '#273449',
    text: '#f1f5f9',
    textSecondary: '#94a3b8',
    sidebarText: '#cbd5e1',
    hover: '#334155',
    success: '#34d399',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#60a5fa',
    shadow: '0 1px 3px 0 rgba(0,0,0,.3), 0 1px 2px -1px rgba(0,0,0,.3)',
  },
} as const;

export type Palette = (typeof PALETTE)[ThemeMode];

function config(mode: ThemeMode): ThemeConfig {
  const p = PALETTE[mode];
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: p.primary,
      colorInfo: p.info,
      colorSuccess: p.success,
      colorWarning: p.warning,
      colorError: p.error,
      colorLink: p.primary,
      colorBgLayout: p.bg,
      colorBgContainer: p.card,
      colorBgElevated: p.card,
      colorBorder: p.border,
      colorBorderSecondary: p.borderSoft,
      colorText: p.text,
      colorTextSecondary: p.textSecondary,
      fontFamily: '"Geist Variable", Geist, system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: 14,
      borderRadius: 8,
      borderRadiusLG: 12,
      boxShadowTertiary: p.shadow,
      controlHeight: 34,
    },
    components: {
      Layout: { bodyBg: p.bg, siderBg: p.sidebar, headerBg: p.card },
      Menu: {
        itemBg: 'transparent',
        itemColor: p.sidebarText,
        itemHoverBg: p.hover,
        itemSelectedBg: mode === 'dark' ? 'rgba(129,140,248,.14)' : 'rgba(99,102,241,.08)',
        itemSelectedColor: p.primary,
        itemHeight: 34,
        itemBorderRadius: 6,
        itemMarginInline: 8,
        itemMarginBlock: 2,
        iconSize: 16,
        fontSize: 13,
        activeBarBorderWidth: 0,
      },
      Card: { headerFontSize: 14, headerFontSizeSM: 14 },
      Table: {
        headerBg: mode === 'dark' ? '#172033' : '#f9fafb',
        headerColor: p.textSecondary,
        headerSplitColor: 'transparent',
        rowHoverBg: p.hover,
        borderColor: p.borderSoft,
        cellPaddingInline: 12,
      },
      Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', fontWeight: 500 },
      Tag: { borderRadiusSM: 999 },
      Typography: { titleMarginBottom: 0 },
      Tabs: { itemSelectedColor: p.primary, inkBarColor: p.primary },
      Segmented: { itemSelectedBg: p.card },
    },
  };
}

const KEY = 'inauviet.theme';
const Ctx = createContext<{ mode: ThemeMode; palette: Palette; toggle: () => void }>({ mode: 'light', palette: PALETTE.light, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* trình duyệt chặn lưu trữ: dùng sáng */
    }
    return 'light';
  });
  useEffect(() => {
    const p = PALETTE[mode];
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    root.style.setProperty('--app-bg', p.bg);
    root.style.setProperty('--app-card', p.card);
    root.style.setProperty('--app-border', p.border);
    root.style.setProperty('--app-border-soft', p.borderSoft);
    root.style.setProperty('--app-text', p.text);
    root.style.setProperty('--app-text-2', p.textSecondary);
    root.style.setProperty('--app-primary', p.primary);
    root.style.setProperty('--app-shadow', p.shadow);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.sidebar);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* bỏ qua */
    }
  }, [mode]);
  const value = useMemo(() => ({ mode, palette: PALETTE[mode], toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')) }), [mode]);
  const cfg = useMemo(() => config(mode), [mode]);
  return (
    <Ctx.Provider value={value}>
      <ConfigProvider theme={cfg}>{children}</ConfigProvider>
    </Ctx.Provider>
  );
}

export const useThemeMode = () => useContext(Ctx);

/** Thẻ số liệu nổi bật, nền chuyển màu như mẫu (tím, xanh lá, xanh ngọc, cam) */
export const STAT_GRADIENTS = {
  indigo: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  emerald: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  cyan: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
  orange: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)',
} as const;
