/**
 * Мінімальний клієнт Typesense REST API (без SDK): колекції, аліаси, імпорт JSONL, пошук.
 * https://typesense.org/docs/latest/api/
 */

export interface TypesenseConfig {
  /** Напр. http://localhost:8108 */
  baseUrl: string;
  apiKey: string;
  /** Таймаут запиту, мс (пошук має падати швидко, щоб спрацював резервний Postgres). */
  timeoutMs?: number;
}

export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class TypesenseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface CollectionField {
  name: string;
  type: 'string' | 'string[]' | 'int32' | 'int64' | 'float' | 'bool';
  facet?: boolean;
  optional?: boolean;
  sort?: boolean;
}

export interface SearchParams {
  q: string;
  query_by: string;
  query_by_weights?: string;
  filter_by?: string;
  sort_by?: string;
  page?: number;
  per_page?: number;
  facet_by?: string;
}

export interface SearchResponse<T> {
  found: number;
  page: number;
  hits: Array<{ document: T }>;
  facet_counts?: Array<{ field_name: string; counts: Array<{ value: string; count: number }> }>;
}

export class TypesenseClient {
  constructor(
    private readonly cfg: TypesenseConfig,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  health(): Promise<{ ok: boolean }> {
    return this.json('GET', '/health');
  }

  createCollection(
    name: string,
    fields: CollectionField[],
    defaultSortingField?: string,
    tokenSeparators?: string[],
  ): Promise<unknown> {
    return this.json('POST', '/collections', {
      name,
      fields,
      default_sorting_field: defaultSortingField,
      ...(tokenSeparators ? { token_separators: tokenSeparators } : {}),
    });
  }

  deleteCollection(name: string): Promise<unknown> {
    return this.json('DELETE', `/collections/${encodeURIComponent(name)}`);
  }

  /** Поточна колекція, на яку вказує аліас, або null, якщо аліасу ще немає. */
  async getAlias(name: string): Promise<string | null> {
    try {
      const r = await this.json<{ collection_name: string }>('GET', `/aliases/${encodeURIComponent(name)}`);
      return r.collection_name;
    } catch (e) {
      if (e instanceof TypesenseError && e.status === 404) return null;
      throw e;
    }
  }

  upsertAlias(name: string, collection: string): Promise<unknown> {
    return this.json('PUT', `/aliases/${encodeURIComponent(name)}`, { collection_name: collection });
  }

  /**
   * Пакетний імпорт документів (JSONL). Typesense відповідає 200 навіть коли окремі
   * документи відхилено — кожен рядок відповіді має success; збираємо помилки.
   */
  async importDocuments(
    collection: string,
    docs: object[],
    action: 'create' | 'upsert' | 'emplace' | 'update' = 'upsert',
  ): Promise<{ imported: number; errors: string[] }> {
    if (docs.length === 0) return { imported: 0, errors: [] };
    const body = docs.map((d) => JSON.stringify(d)).join('\n');
    const text = await this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/documents/import?action=${action}`,
      body,
      'text/plain',
    );
    const results = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { success: boolean; error?: string });
    const errors = results.filter((r) => !r.success).map((r) => r.error ?? 'unknown error');
    return { imported: results.length - errors.length, errors };
  }

  search<T>(collection: string, params: SearchParams): Promise<SearchResponse<T>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return this.json('GET', `/collections/${encodeURIComponent(collection)}/documents/search?${qs.toString()}`);
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const text = await this.request(method, path, body === undefined ? undefined : JSON.stringify(body), 'application/json');
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async request(method: string, path: string, body: string | undefined, contentType: string): Promise<string> {
    const res = await this.fetchFn(`${this.cfg.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: { 'X-TYPESENSE-API-KEY': this.cfg.apiKey, 'content-type': contentType },
      body,
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 3_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* тіло не JSON */
      }
      throw new TypesenseError(`Typesense ${method} ${path.split('?')[0]} → ${res.status}: ${message}`, res.status);
    }
    return text;
  }
}
