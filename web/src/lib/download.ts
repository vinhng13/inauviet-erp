import { ApiError, type Schemas } from '../api/client';

export type DocKind = Schemas['DocKind'];

const BASE = '/api/v1';
export const docUrl = (kind: DocKind, id: string) => `${BASE}/documents/${kind}/${id}`;
export const orderZipUrl = (orderId: string, kinds?: DocKind[]) => `${BASE}/orders/${orderId}/documents/zip${kinds?.length ? `?kinds=${kinds.join(',')}` : ''}`;
export const customerZipUrl = (customerId: string, kinds?: DocKind[]) =>
  `${BASE}/customers/${customerId}/documents/zip${kinds?.length ? `?kinds=${kinds.join(',')}` : ''}`;

/** Open a document in a new tab (the browser's PDF viewer prints or saves it). */
export function openDoc(kind: DocKind, id: string): void {
  window.open(docUrl(kind, id), '_blank', 'noopener');
}

function fileNameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="([^"]+)"/i.exec(cd);
  return plain?.[1] ?? fallback;
}

/** Fetch a file from the API and save it; API errors are thrown as ApiError so callers can show the message. */
export async function downloadFile(url: string, fallbackName = 'tai-lieu'): Promise<void> {
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'download=true', { credentials: 'include' });
  if (!res.ok) {
    let body: { code?: string; message?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    throw new ApiError({ statusCode: res.status, code: body.code ?? `HTTP_${res.status}`, message: body.message ?? res.statusText });
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileNameFrom(res, fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export const downloadDoc = (kind: DocKind, id: string) => downloadFile(docUrl(kind, id), `${kind}.pdf`);
