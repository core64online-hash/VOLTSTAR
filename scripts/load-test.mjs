#!/usr/bin/env node
/**
 * Навантажувальний тест без залежностей (Node ≥ 20): кілька сценаріїв паралельно,
 * перцентилі затримки, RPS і частка помилок; ненульовий код виходу, якщо пороги не виконано.
 *
 *   node scripts/load-test.mjs --api http://localhost:4000 --web http://localhost:3000 \
 *        --duration 30 --concurrency 20 [--scenarios catalog,product,search,facets,lookup,web-catalog,web-product,checkout]
 *
 * Для API з увімкненими лімітами запитів (production) з однієї IP частина сценаріїв упреться
 * в 429 — запускайте проти стенду з RATE_LIMIT_DISABLED=true або з кількох машин.
 */
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:4000' },
    web: { type: 'string', default: 'http://localhost:3000' },
    duration: { type: 'string', default: '20' },
    concurrency: { type: 'string', default: '10' },
    scenarios: { type: 'string', default: 'catalog,product,search,facets,lookup,web-catalog,web-product,checkout' },
    product: { type: 'string', default: 'bosch-0001368088' },
    number: { type: 'string', default: '0 001 368 088' },
  },
});
const API = `${args.api.replace(/\/$/, '')}/api`;
const WEB = args.web.replace(/\/$/, '');
const DURATION_MS = Number(args.duration) * 1000;
const CONCURRENCY = Number(args.concurrency);

const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function ok(res) {
  // Тіло читаємо повністю — інакше зʼєднання не повертається в пул keep-alive.
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text;
}

let productId = null;
/** Сценарії: одна «ітерація» = одна дія користувача; поріг p95 — у мс. */
const SCENARIOS = {
  catalog: { p95: 300, run: async () => ok(await fetch(`${API}/catalog/products?perPage=24`)) },
  search: { p95: 400, run: async () => ok(await fetch(`${API}/catalog/products?q=starter&kind=STARTER&perPage=24`)) },
  product: { p95: 200, run: async () => ok(await fetch(`${API}/catalog/products/${args.product}`)) },
  facets: { p95: 200, run: async () => ok(await fetch(`${API}/catalog/facets`)) },
  // Пошук по крос-номеру — найчастіший запит у цій справі, тож і поріг найжорсткіший.
  lookup: {
    p95: 200,
    run: async () => ok(await fetch(`${API}/catalog/lookup?number=${encodeURIComponent(args.number)}`)),
  },
  'web-catalog': { p95: 800, run: async () => ok(await fetch(`${WEB}/uk/catalog`)) },
  'web-product': { p95: 300, run: async () => ok(await fetch(`${WEB}/uk/catalog/${args.product}`)) },
  // Повний шлях покупки гостем: кошик → товар → оформлення (оплата за провайдером не виконується).
  checkout: {
    p95: 1500,
    weight: 0.2,
    run: async () => {
      if (!productId) productId = JSON.parse(await ok(await fetch(`${API}/catalog/products/${args.product}`))).id;
      const cart = JSON.parse(await ok(await fetch(`${API}/cart`, json({}))));
      await ok(await fetch(`${API}/cart/${cart.id}/items`, json({ productId, quantity: 1 })));
      await ok(
        await fetch(
          `${API}/checkout`,
          json({
            cartId: cart.id,
            deliveryMethod: 'PICKUP',
            returnUrl: `${WEB}/uk/checkout/return`,
            contact: { name: 'Навантажувальний тест', email: 'load@test.invalid', phone: '+380500000000' },
          }),
        ),
      );
    },
  },
};

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

async function runScenario(name, s) {
  const workers = Math.max(1, Math.round(CONCURRENCY * (s.weight ?? 1)));
  const latencies = [];
  const errors = new Map();
  const deadline = Date.now() + DURATION_MS;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (Date.now() < deadline) {
        const t0 = performance.now();
        try {
          await s.run();
          latencies.push(performance.now() - t0);
        } catch (e) {
          const key = e.message ?? String(e);
          errors.set(key, (errors.get(key) ?? 0) + 1);
        }
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  const failed = [...errors.values()].reduce((a, b) => a + b, 0);
  const total = latencies.length + failed;
  return {
    name,
    workers,
    total,
    rps: total / (DURATION_MS / 1000),
    p50: pct(latencies, 50),
    p95: pct(latencies, 95),
    p99: pct(latencies, 99),
    errorRate: total ? failed / total : 0,
    errors: Object.fromEntries(errors),
    threshold: s.p95,
  };
}

const names = args.scenarios.split(',').map((n) => n.trim()).filter(Boolean);
for (const n of names) if (!SCENARIOS[n]) throw new Error(`Невідомий сценарій: ${n}`);
console.log(`Навантаження: ${names.length} сценаріїв паралельно, до ${CONCURRENCY} конкурентних користувачів кожен, ${args.duration} с`);
const results = await Promise.all(names.map((n) => runScenario(n, SCENARIOS[n])));

const f = (ms) => `${ms.toFixed(0).padStart(5)} мс`;
let failedChecks = 0;
console.log('\nсценарій       потоки  запитів    RPS    p50       p95       p99    помилки  поріг p95');
for (const r of results) {
  const pass = r.p95 <= r.threshold && r.errorRate < 0.01;
  if (!pass) failedChecks++;
  console.log(
    `${pass ? '✓' : '✗'} ${r.name.padEnd(13)} ${String(r.workers).padStart(4)} ${String(r.total).padStart(8)} ${r.rps.toFixed(1).padStart(7)} ${f(r.p50)} ${f(r.p95)} ${f(r.p99)} ${(r.errorRate * 100).toFixed(2).padStart(6)}%  ≤${r.threshold} мс`,
  );
  if (Object.keys(r.errors).length) console.log(`    помилки: ${JSON.stringify(r.errors)}`);
}
console.log(failedChecks ? `\n❌ Пороги не виконано: ${failedChecks}` : '\n✅ Усі пороги виконано (p95 і помилки < 1%)');
process.exit(failedChecks ? 1 : 0);
