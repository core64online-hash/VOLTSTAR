import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SearchService } from './search.service';

/**
 * Контрактний тест: SearchService проти локального HTTP-сервера, що відтворює
 * підмножину REST API Typesense (колекції, аліаси, імпорт JSONL, пошук). Перевіряє
 * реальний HTTP-обмін і сценарій переіндексації без простою; семантику пошуку
 * самого Typesense тут не емулюємо.
 */
interface FakeState {
  collections: Map<string, Map<string, Record<string, unknown>>>;
  aliases: Map<string, string>;
  failImport: boolean;
  requests: string[];
}

const state: FakeState = { collections: new Map(), aliases: new Map(), failImport: false, requests: [] };
let server: Server;
let baseUrl: string;

function resolve(name: string): Map<string, Record<string, unknown>> | undefined {
  return state.collections.get(state.aliases.get(name) ?? name);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      state.requests.push(`${req.method} ${url.pathname}`);
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(typeof data === 'string' ? data : JSON.stringify(data));
      };
      if (req.headers['x-typesense-api-key'] !== 'test-key') return send(401, { message: 'Forbidden' });

      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'POST' && url.pathname === '/collections') {
        const { name } = JSON.parse(body);
        state.collections.set(name, new Map());
        return send(201, { name });
      }
      if (req.method === 'DELETE' && parts[0] === 'collections' && parts.length === 2) {
        state.collections.delete(parts[1]);
        return send(200, { name: parts[1] });
      }
      if (parts[0] === 'aliases') {
        if (req.method === 'PUT') {
          state.aliases.set(parts[1], JSON.parse(body).collection_name);
          return send(200, {});
        }
        const target = state.aliases.get(parts[1]);
        return target ? send(200, { name: parts[1], collection_name: target }) : send(404, { message: 'Not Found' });
      }
      if (parts[2] === 'documents' && parts[3] === 'import') {
        const coll = resolve(parts[1]);
        if (!coll) return send(404, { message: 'Not found' });
        const lines = body.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
        const out = lines.map((doc, i) => {
          if (state.failImport && i === 0) return JSON.stringify({ success: false, error: 'Field `voltage` must be an int32.' });
          coll.set(String(doc.id), { ...(coll.get(String(doc.id)) ?? {}), ...doc });
          return JSON.stringify({ success: true });
        });
        return send(200, out.join('\n'));
      }
      if (parts[2] === 'documents' && parts[3] === 'search') {
        const coll = resolve(parts[1]);
        if (!coll) return send(404, { message: 'Not found' });
        const q = url.searchParams.get('q') ?? '*';
        const docs = [...coll.values()]
          .filter((d) => q === '*' || String(d.name).toLowerCase().includes(q.toLowerCase()))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return send(200, { found: docs.length, page: 1, hits: docs.map((document) => ({ document })) });
      }
      send(404, { message: 'unknown route' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  baseUrl = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  state.collections.clear();
  state.aliases.clear();
  state.failImport = false;
  state.requests = [];
});

const products = [
  { id: 'p2', slug: 'b', name: 'Генератор Iskra 28V', description: 'на сільгосптехніку', brand: { name: 'Iskra', slug: 'iskra' }, category: { slug: 'c' }, kind: 'ALTERNATOR', condition: 'NEW', partNumberNorm: 'AAK5573', voltage: 28, crossReferences: [], applications: [], inventory: { quantity: 2 } },
  { id: 'p1', slug: 'a', name: 'Стартер Bosch 24V', description: null, brand: { name: 'Bosch', slug: 'bosch' }, category: { slug: 'c' }, kind: 'STARTER', condition: 'REMANUFACTURED', partNumberNorm: '0001368088', voltage: 24, crossReferences: [{ numberNorm: 'AZJ3151' }], applications: [], inventory: null },
];

function makeService(rows: Array<{ id: string } & Record<string, unknown>> = products) {
  const prisma = {
    product: {
      findMany: async (args: { where?: { id?: { in: string[] } }; cursor?: unknown }) => {
        if (args.cursor) return []; // одна сторінка
        return args.where?.id ? rows.filter((r) => args.where!.id!.in.includes(r.id)) : rows;
      },
    },
  };
  const [host, port] = baseUrl.split(':');
  const env: Record<string, string> = { TYPESENSE_HOST: host, TYPESENSE_PORT: port, TYPESENSE_API_KEY: 'test-key' };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new SearchService(prisma as never, config);
}

describe('SearchService ↔ Typesense HTTP API', () => {
  it('переіндексація: нова колекція → імпорт → аліас; пошук іде через аліас', async () => {
    const service = makeService();
    const first = await service.reindexAll();
    expect(first.indexed).toBe(2);
    expect(state.aliases.get('products')).toBe(first.collection);

    const res = await service.searchProductIds({ page: 1, perPage: 24 });
    expect(res).toEqual({ ids: ['p2', 'p1'], total: 2 }); // «Генератор…» перед «Стартер…»
    expect((await service.searchProductIds({ q: 'iskra', page: 1, perPage: 24 })).ids).toEqual(['p2']);
  });

  it('повторна переіндексація перемикає аліас і видаляє стару колекцію (без простою)', async () => {
    const service = makeService();
    const first = await service.reindexAll();
    await new Promise((r) => setTimeout(r, 2));
    const second = await service.reindexAll();
    expect(second.collection).not.toBe(first.collection);
    expect(state.aliases.get('products')).toBe(second.collection);
    expect(state.collections.has(first.collection)).toBe(false);
    // аліас перемкнуто ДО видалення старої колекції
    const swap = state.requests.lastIndexOf('PUT /aliases/products');
    const drop = state.requests.lastIndexOf(`DELETE /collections/${first.collection}`);
    expect(swap).toBeLessThan(drop);
  });

  it('збій імпорту: аліас лишається на робочому індексі, недобудована колекція видаляється', async () => {
    const service = makeService();
    const good = await service.reindexAll();
    state.failImport = true;
    await expect(service.reindexAll()).rejects.toThrow(/int32/);
    expect(state.aliases.get('products')).toBe(good.collection);
    expect([...state.collections.keys()]).toEqual([good.collection]);
  });

  it('часткова синхронізація оновлює документ через аліас (наявність після оформлення)', async () => {
    const service = makeService();
    const { collection } = await service.reindexAll();
    expect(state.collections.get(collection)!.get('p2')!.inStock).toBe(true);

    const soldOut = products.map((p) => (p.id === 'p2' ? { ...p, inventory: { quantity: 0 } } : p));
    await makeService(soldOut).syncProducts(['p2']);
    expect(state.collections.get(collection)!.get('p2')!.inStock).toBe(false);
  });

  it('невірний ключ — помилка пошуку (для резервного Postgres), синхронізація не кидає', async () => {
    const [host, port] = baseUrl.split(':');
    const env: Record<string, string> = { TYPESENSE_HOST: host, TYPESENSE_PORT: port, TYPESENSE_API_KEY: 'wrong' };
    const service = new SearchService({ product: { findMany: async () => products } } as never, { get: (k: string) => env[k] } as never);
    await expect(service.searchProductIds({ page: 1, perPage: 24 })).rejects.toThrow(/401/);
    await expect(service.syncProducts(['p1'])).resolves.toBeUndefined();
  });
});
