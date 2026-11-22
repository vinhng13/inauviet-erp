import { Select, type SelectProps } from 'antd';
import { Plus } from 'lucide-react';
import { useState } from 'react';

/** Giá trị của dòng "Thêm …" khi gõ một tên chưa có trong danh mục */
export const NEW_PREFIX = 'new:';
export const isNew = (v?: string | null): v is string => !!v && v.startsWith(NEW_PREFIX);
export const newName = (v?: string | null) => (isNew(v) ? v.slice(NEW_PREFIX.length).trim() : '');

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

type Opt = { value: string; label: string };
type Group = { label: string; options: Opt[] };

/**
 * Ô chọn danh mục: có rồi thì chọn; chưa có thì gõ tên rồi chọn dòng "Thêm …".
 * Giá trị khi thêm mới là `new:<tên>` (hoặc `<prefixNew><tên>`); máy chủ tự thêm vào danh mục khi lưu.
 */
export function CreatableSelect({
  options = [],
  newPrefix = NEW_PREFIX,
  addLabel = 'Thêm',
  value,
  ...rest
}: Omit<SelectProps<string>, 'options' | 'showSearch' | 'filterOption' | 'onSearch' | 'searchValue'> & { options?: Array<Opt | Group>; newPrefix?: string; addLabel?: string }) {
  const [search, setSearch] = useState('');
  const flat = options.flatMap((o) => ('options' in o ? o.options : [o]));
  const typed = search.trim();
  const exists = !!typed && flat.some((o) => fold(o.label) === fold(typed));
  const extra: Opt[] = [];
  // giữ dòng của giá trị mới đang chọn để ô hiện đúng tên
  if (value && value.startsWith(newPrefix) && !flat.some((o) => o.value === value)) extra.push({ value, label: value.slice(newPrefix.length) });
  const add: Opt[] = typed && !exists ? [{ value: newPrefix + typed, label: typed }] : [];
  const shown = [
    ...add.map((o) => ({ ...o, title: `${addLabel} “${o.label}”` })),
    ...extra,
    ...options.map((o) => ('options' in o ? { ...o, options: o.options.filter((x) => !typed || fold(x.label).includes(fold(typed))) } : o)).filter((o) => !('options' in o) || o.options.length),
  ].filter((o) => 'options' in o || !typed || o.value.startsWith(newPrefix) || fold((o as Opt).label).includes(fold(typed)));
  return (
    <Select<string>
      {...rest}
      value={value}
      showSearch
      filterOption={false}
      searchValue={search}
      onSearch={setSearch}
      onBlur={(e) => {
        setSearch('');
        rest.onBlur?.(e);
      }}
      onSelect={(v, o) => {
        setSearch('');
        rest.onSelect?.(v, o);
      }}
      optionRender={(o) =>
        String(o.value).startsWith(newPrefix) && o.data.title ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--app-primary)' }}>
            <Plus size={14} /> {addLabel} “{String(o.label)}”
          </span>
        ) : (
          o.label
        )
      }
      options={shown}
      notFoundContent={typed ? null : undefined}
    />
  );
}
