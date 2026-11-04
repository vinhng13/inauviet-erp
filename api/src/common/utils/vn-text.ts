/**
 * Lowercase and strip Vietnamese diacritics so "Nguyễn Văn Á" and "nguyen van a" match.
 * Used to build Customer.searchText and to normalize search input.
 */
export function toSearchText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
