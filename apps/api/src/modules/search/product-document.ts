import type { CatalogQuery } from '@voltstar/types';
import { normalizePartNumber } from '@voltstar/types';
import type { CollectionField, SearchParams } from './typesense.client';

/** Аліас, через який API читає/пише індекс; фізичні колекції — products_<версія>. */
export const PRODUCTS_ALIAS = 'products';

/** Документ товару в пошуковому індексі. */
export interface ProductDocument {
  id: string;
  slug: string;
  name: string;
  description?: string;
  brand: string;
  brandSlug: string;
  categorySlug: string;
  kind: string;
  condition: string;
  /** Наш артикул у нормалізованій формі — те, за чим шукають найчастіше. */
  partNumber: string;
  /** Крос-номери, теж нормалізовані. */
  crossNumbers: string[];
  voltage: number;
  machineModels: string[];
  machineSegments: string[];
  inStock: boolean;
}

export const PRODUCT_FIELDS: CollectionField[] = [
  { name: 'slug', type: 'string' },
  { name: 'name', type: 'string', sort: true },
  { name: 'description', type: 'string', optional: true },
  { name: 'brand', type: 'string', facet: true },
  { name: 'brandSlug', type: 'string', facet: true },
  { name: 'categorySlug', type: 'string', facet: true },
  { name: 'kind', type: 'string', facet: true },
  { name: 'condition', type: 'string', facet: true },
  { name: 'partNumber', type: 'string' },
  { name: 'crossNumbers', type: 'string[]' },
  { name: 'voltage', type: 'int32', facet: true },
  { name: 'machineModels', type: 'string[]', facet: true },
  { name: 'machineSegments', type: 'string[]', facet: true },
  { name: 'inStock', type: 'bool', facet: true },
];

export const PRODUCT_DEFAULT_SORT = 'name';

/**
 * Роздільники, які Typesense розрізає на окремі токени. Без них «0-001-368-088» у документі
 * лишався б одним словом і не знаходився б за «0001368088». Нормалізацію номерів у запиті це
 * не заміняє, але рятує, коли клієнт вводить номер частинами.
 */
export const PRODUCT_TOKEN_SEPARATORS = ['-', '.', '/', ' '];

/** Мінімальна форма товару з Prisma, потрібна для індексу. */
export interface IndexableProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  brand: { name: string; slug: string };
  category: { slug: string };
  kind: string;
  condition: string;
  partNumberNorm: string;
  voltage: number | null;
  crossReferences: { numberNorm: string }[];
  applications: { machineModel: { slug: string; segment: string } }[];
  inventory: { quantity: number } | null;
}

export function toProductDocument(p: IndexableProduct): ProductDocument {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    brand: p.brand.name,
    brandSlug: p.brand.slug,
    categorySlug: p.category.slug,
    kind: p.kind,
    condition: p.condition,
    partNumber: p.partNumberNorm,
    crossNumbers: [...new Set(p.crossReferences.map((x) => x.numberNorm))],
    // Typesense не індексує null: «напруга невідома» кодуємо нулем, фільтр її не зачепить.
    voltage: p.voltage ?? 0,
    machineModels: [...new Set(p.applications.map((a) => a.machineModel.slug))],
    machineSegments: [...new Set(p.applications.map((a) => a.machineModel.segment))],
    inStock: (p.inventory?.quantity ?? 0) > 0,
  };
}

/** Рядкове значення у filter_by — у зворотних лапках, щоб коми/пробіли/дужки не ламали синтаксис. */
function quote(value: string): string {
  return '`' + value.replace(/`/g, '') + '`';
}

/** Фільтри каталогу → filter_by Typesense (ті самі, що й у Postgres-запиті). */
export function buildFilterBy(q: CatalogQuery): string | undefined {
  const parts: string[] = [];
  if (q.brand?.length) parts.push(`brandSlug:=[${q.brand.map(quote).join(',')}]`);
  if (q.kind?.length) parts.push(`kind:=[${q.kind.map(quote).join(',')}]`);
  if (q.condition?.length) parts.push(`condition:=[${q.condition.map(quote).join(',')}]`);
  if (q.voltage != null) parts.push(`voltage:=${Math.floor(q.voltage)}`);
  if (q.machineSegment) parts.push(`machineSegments:=${quote(q.machineSegment)}`);
  if (q.machineModel) parts.push(`machineModels:=${quote(q.machineModel)}`);
  if (q.inStock) parts.push('inStock:=true');
  return parts.length ? parts.join(' && ') : undefined;
}

/**
 * Параметри пошуку. Номер важить найбільше: у цій справі клієнт вводить саме номер, і збіг
 * по ньому не має програвати збігу в описі. Текст запиту шукаємо і як є (назва, бренд), і в
 * нормалізованій формі (артикул, крос-номери) — інакше «0 001 368 088» не знайшло б «0001368088».
 */
export function buildSearchParams(q: CatalogQuery): SearchParams {
  const text = q.q?.trim();
  // Нормалізовану форму додаємо лише до того, що схоже на номер (є цифра). Інакше кирилична
  // назва перетворилася б на латиничну абракадабру («стартер» → «CTAPTEP») і засмічувала запит.
  const norm = text && /\d/.test(text) ? normalizePartNumber(text) : '';
  const terms = text ? [text, ...(norm && norm !== text ? [norm] : [])].join(' ') : '*';
  return {
    q: terms,
    query_by: 'partNumber,crossNumbers,name,brand,description',
    query_by_weights: '8,8,3,2,1',
    filter_by: buildFilterBy(q),
    sort_by: text ? '_text_match:desc,name:asc' : 'name:asc',
    page: q.page,
    per_page: q.perPage,
  };
}
