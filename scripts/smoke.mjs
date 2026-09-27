#!/usr/bin/env node
/**
 * Smoke-тести після деплою: сайт, API, БД, пошук, SEO-файли, заголовки безпеки.
 * Код виходу ≠ 0 при будь-якому провалі — пайплайн деплою робить відкат.
 *
 *   node scripts/smoke.mjs https://voltstar.ua [--version <очікувана APP_VERSION>] [--retries 20]
 *
 * Для самопідписаного TLS (staging із `tls internal`) — NODE_EXTRA_CA_CERTS=<root.crt>.
 */
import { parseArgs } from 'node:util';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { version: { type: 'string' }, retries: { type: 'string', default: '20' } },
});
const BASE = (positionals[0] ?? process.env.SMOKE_URL ?? '').replace(/\/$/, '');
if (!BASE) {
  console.error('Використання: node scripts/smoke.mjs <https://домен> [--version X]');
  process.exit(2);
}
const HTTPS = BASE.startsWith('https://');
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};
const get = (path, init) => fetch(BASE + path, { redirect: 'manual', ...init });

// 1. Чекаємо готовності API **і сайту**: web стартує після API, а reverse-proxy (Traefik у Coolify)
//    пускає на контейнер лише після його першого успішного healthcheck — до того сайт віддає 404.
let ready = null;
let siteUp = false;
for (let i = 0; i < Number(opts.retries); i++) {
  try {
    if (!ready) {
      const r = await get('/api/health/ready');
      if (r.ok) ready = await r.json();
    }
    if (ready && !siteUp) siteUp = (await get('/uk')).status === 200;
    if (ready && siteUp) break;
  } catch {
    /* ще не піднявся */
  }
  await new Promise((r) => setTimeout(r, 3000));
}
check(
  'API готовий, база даних відповідає',
  ready?.status === 'ready' && ready.database?.ok,
  ready ? `${ready.database.latencyMs} мс` : 'немає відповіді',
);
if (!ready) process.exit(1);
if (opts.version)
  check(
    'задеплоєно очікувану версію',
    ready.version === opts.version,
    `${ready.version} ≠ ${opts.version}`.replace(/^(.+) ≠ \1$/, '$1'),
  );

// 2. Сайт і SEO
const home = await get('/uk');
const html = await home.text();
check(
  'головна сторінка',
  home.status === 200 && /<title>[^<]+<\/title>/.test(html),
  String(home.status),
);
const root = await get('/');
check('корінь веде на мовну версію', [200, 307, 308].includes(root.status), String(root.status));
check('canonical на правильний домен', html.includes(`<link rel="canonical" href="${BASE}/uk"`));
const csp = home.headers.get('content-security-policy') ?? '';
check(
  'CSP і захисні заголовки сайту',
  csp.includes("frame-ancestors 'none'") &&
    home.headers.get('x-content-type-options') === 'nosniff',
);
if (HTTPS) check('HSTS', /max-age=\d+/.test(home.headers.get('strict-transport-security') ?? ''));
for (const p of ['/robots.txt', '/sitemap.xml']) {
  const r = await get(p);
  check(p, r.status === 200 && (await r.text()).length > 20);
}

// 3. Каталог через API і сайт
const list = await get('/api/catalog/products?perPage=1');
const products = list.ok ? await list.json() : null;
check(
  'каталог API',
  list.ok && Array.isArray(products?.items),
  `${products?.total ?? '?'} товарів`,
);
check('каталог кешується публічно', /public/.test(list.headers.get('cache-control') ?? ''));
const catalog = await get('/uk/catalog');
check('сторінка каталогу', catalog.status === 200);
const slug = products?.items?.[0]?.slug;
if (slug) {
  const page = await get(`/uk/catalog/${slug}`);
  const body = await page.text();
  check(
    'сторінка товару з розміткою Product',
    page.status === 200 && body.includes('"@type":"Product"'),
    slug,
  );
}
// Пошук по крос-номеру — головний вхід у каталог: якщо він мовчить, сайт для клієнта мертвий,
// навіть коли каталог віддається. Беремо номер першого ж товару, щоб не залежати від даних.
const partNumber = products?.items?.[0]?.partNumber;
if (partNumber) {
  const spaced = partNumber.replace(/(.{3})/g, '$1 ').trim(); // те саме написання «через пробіли»
  const lookupRes = await get(`/api/catalog/lookup?number=${encodeURIComponent(spaced)}`);
  const lookup = lookupRes.ok ? await lookupRes.json() : null;
  check(
    'пошук по крос-номеру знаходить попри роздільники',
    lookup?.match === 'exact' && lookup.items.some((i) => i.partNumber === partNumber),
    `${spaced} → ${lookup?.match ?? '—'}`,
  );
  check(
    'пошук по номеру кешується публічно',
    /public/.test(lookupRes.headers.get('cache-control') ?? ''),
  );
}
const missing = await get('/api/catalog/lookup?number=SMOKE0000MISSING');
const missingBody = missing.ok ? await missing.json() : null;
check(
  'номера немає — порожній результат, а не випадкові товари',
  missingBody?.match === 'none' && missingBody.items.length === 0,
);
check('неіснуючий товар — 404', (await get('/uk/catalog/__smoke-missing__')).status === 404);

// 4. Вхід із браузера. Адресу API (NEXT_PUBLIC_API_URL = SITE_URL) Next.js вшиває під час збірки
//    і в JS, і в CSP connect-src; якщо SITE_URL не був доступний під час збірки, браузер
//    стукає на http://localhost:4000 і показує «Failed to fetch», хоча сам API працює.
const connectSrc = (csp.match(/connect-src ([^;]*)/)?.[1] ?? '').trim().split(/\s+/);
check(
  'CSP дозволяє браузеру запити до API цього домену',
  connectSrc.includes(new URL(BASE).origin),
  `connect-src ${connectSrc.join(' ') || '—'}`,
);
const login = await get('/api/accounts/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: new URL(BASE).origin },
  body: JSON.stringify({
    email: 'smoke-test@example.invalid',
    password: 'smoke-test-wrong-password',
  }),
});
check('вхід: API відповідає на невірний пароль (401)', login.status === 401, String(login.status));

// 5. Службові маршрути закриті
check('метрики не доступні ззовні', (await get('/api/metrics')).status === 404);
const docs = await get('/docs');
check('Swagger вимкнено', docs.status === 404 || docs.status >= 300);

console.log(
  failed
    ? `\n❌ Smoke-тести не пройдено: ${failed}`
    : `\n✅ Smoke-тести пройдено (${BASE}, версія ${ready.version})`,
);
process.exit(failed ? 1 : 0);
