import type { CatalogFacets, LookupResult, Product } from '@voltstar/types';

const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const IS_SERVER = typeof window === 'undefined';
/**
 * Браузер звертається до публічної адреси API, а серверний рендер — напряму внутрішньою мережею
 * (API_INTERNAL_URL, напр. http://api:4000), без зайвого кола через reverse-proxy.
 */
const API_BASE = IS_SERVER ? (process.env.API_INTERNAL_URL ?? PUBLIC_API) : PUBLIC_API;

/** Повний URL до ендпоінта API (усі маршрути під префіксом /api). */
export const apiUrl = (path: string): string => `${API_BASE}/api${path}`;

/**
 * Заголовки серверних запитів до API: SSR ходить з однієї адреси, тож позначається спільним
 * секретом INTERNAL_API_TOKEN, щоб не впиратись у ліміти за IP. У браузер секрет не потрапляє.
 */
export function serverHeaders(): Record<string, string> {
  const token = IS_SERVER ? process.env.INTERNAL_API_TOKEN : undefined;
  return token ? { 'x-internal-token': token } : {};
}

/**
 * Серверний рендер каталогу кешує відповіді API на хвилину (ISR): сторінки віддаються миттєво,
 * а зміни з адмінки зʼявляються протягом REVALIDATE секунд. Наявність і ціну при оформленні
 * все одно перевіряє API.
 */
export const CATALOG_REVALIDATE_SEC = 60;

export interface ProductListResult {
  items: Product[];
  total: number;
  page: number;
  perPage: number;
}

/** Список товарів каталогу. Кидає помилку при неуспішній відповіді. */
export async function fetchProducts(
  search: Record<string, string | undefined>,
): Promise<ProductListResult> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) if (v) qs.set(k, v);
  const res = await fetch(apiUrl(`/catalog/products?${qs.toString()}`), {
    headers: serverHeaders(),
    next: { revalidate: CATALOG_REVALIDATE_SEC },
  });
  if (!res.ok) throw new Error(`catalog request failed: ${res.status}`);
  return res.json();
}

/** Один товар за slug; null — якщо такого немає (для справжньої відповіді 404). */
export async function fetchProduct(slug: string, segment = 'B2C'): Promise<Product | null> {
  const res = await fetch(
    apiUrl(`/catalog/products/${encodeURIComponent(slug)}?segment=${segment}`),
    {
      headers: serverHeaders(),
      next: { revalidate: CATALOG_REVALIDATE_SEC },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`product request failed: ${res.status}`);
  return res.json();
}

/** Доступні бренди, типи агрегатів і групи техніки для фільтрів каталогу. */
export async function fetchFacets(): Promise<CatalogFacets> {
  const res = await fetch(apiUrl('/catalog/facets'), {
    headers: serverHeaders(),
    next: { revalidate: CATALOG_REVALIDATE_SEC },
  });
  if (!res.ok) throw new Error(`facets request failed: ${res.status}`);
  return res.json();
}

/**
 * Пошук по крос-номеру — головний вхід у каталог. GET, тож відповідь кешується браузером і CDN
 * так само, як каталог (заголовки ставить API); `cache` навмисно не перевизначаємо.
 */
export async function lookupByNumber(number: string, segment = 'B2C'): Promise<LookupResult> {
  const qs = new URLSearchParams({ number, segment });
  const res = await fetch(apiUrl(`/catalog/lookup?${qs.toString()}`), {
    headers: serverHeaders(),
  });
  if (!res.ok) throw new Error(`lookup request failed: ${res.status}`);
  return res.json();
}

/** Форматування ціни з мінімальних одиниць (копійки) у рядок з валютою. */
export function formatPrice(amountMinor: number, currency: string, locale = 'uk-UA'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 100);
}
