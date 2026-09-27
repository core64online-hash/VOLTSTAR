# VOLTSTAR ⚡

E-commerce платформа для **продажу й відновлення стартерів та генераторів** до вантажівок,
спецтехніки, сільгосптехніки й мілтехніки, із вбудованим CRM та мультисегментною моделлю
**B2C / B2B / B2G**.

## Можливості (за дорожньою картою)

1. **Пошук по крос-номеру** — головний вхід у каталог: клієнт приходить із номером, знятим
   з агрегата або взятим із каталогу техніки.
2. **Каталог** із фасетним пошуком за типом, станом, напругою й групою техніки.
3. **Онлайн-купівля та оплата** (Україна: WayForPay/LiqPay; міжнародні: Stripe).
4. **CRM** — ліди, угоди, клієнти, історія комунікацій.
5. **B2C / B2B / B2G** — різні флоу, ціни й документообіг.

## Стек

- **Monorepo:** Turborepo + pnpm
- **Web:** Next.js 15 (App Router), React 19, Tailwind, next-intl (uk/en)
- **API:** NestJS (модульний моноліт), Swagger/OpenAPI
- **БД:** PostgreSQL + Prisma
- **Пошук:** Typesense · **Черги/кеш:** Redis + BullMQ
- **Платежі:** WayForPay/LiqPay + Stripe

Деталі — у [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Структура

```
apps/
  web/   — Next.js фронтенд
  api/   — NestJS бекенд
packages/
  config/ — спільні tsconfig/eslint
  types/  — спільні типи та zod-схеми
  ui/     — спільні React-компоненти
docs/     — архітектура, дорожня карта, чек-лист
```

## Швидкий старт (локально)

```bash
# 1. Залежності
pnpm install

# 2. Змінні середовища
cp .env.example .env

# 3. Інфраструктура (Postgres, Redis, Typesense, Mailhog)
docker-compose up -d

# 4. Prisma: клієнт + міграції + демо-дані
pnpm --filter @voltstar/api prisma:generate
pnpm --filter @voltstar/api prisma:migrate
pnpm --filter @voltstar/api seed

# 4a. Пошуковий індекс каталогу (Typesense). Без нього каталог шукає через Postgres.
pnpm --filter @voltstar/api search:reindex

# 5. Запуск усього монорепо
pnpm dev
```

- Web → http://localhost:3000
- API → http://localhost:4000/api (Swagger: http://localhost:4000/docs)
- Пошта (Mailhog UI) → http://localhost:8025
- CRM менеджера → http://localhost:3000/uk/manager/crm (потрібна роль: `pnpm --filter @voltstar/api user:role <email> MANAGER`)
- Адмін-панель → http://localhost:3000/uk/admin (менеджер: дашборд, замовлення, залишки; адміністратор — ще каталог, ціни, ролі, журнал: `user:role <email> ADMIN`)

## Команди

```bash
pnpm dev         # усі застосунки в режимі розробки
pnpm build       # збірка
pnpm lint        # лінтинг
pnpm typecheck   # перевірка типів
pnpm test        # тести
```

## Безпека й дані

```bash
# Резервна копія (ротація BACKUP_KEEP, типово 14) і відновлення
DATABASE_URL=postgresql://… scripts/db-backup.sh ./backups
TARGET_DATABASE_URL=postgresql://… scripts/db-restore.sh backups/voltstar-<дата>.dump
# Перевірка бекапу: відновлення в тимчасову БД і звірка таблиць (робочу БД не змінює)
DATABASE_URL=postgresql://… scripts/db-verify-restore.sh

# Очищення за строками зберігання персональних даних (щодня, cron)
pnpm --filter @voltstar/api data:retention --dry-run
pnpm --filter @voltstar/api data:retention
```

У production API не стартує з небезпечною конфігурацією (дефолтний `JWT_SECRET`, http-адреси, `*` у CORS, `LIQPAY_SANDBOX=true`) — див. лог запуску. За балансувальником задайте `TRUST_PROXY`, щоб ліміти запитів рахувались за IP клієнта.

## Навантажувальний тест

```bash
# API й web мають бути запущені; для стенду з лімітами запитів — RATE_LIMIT_DISABLED=true
node scripts/load-test.mjs --api http://localhost:4000 --web http://localhost:3000 --duration 30 --concurrency 10
```

Виводить RPS і p50/p95/p99 для кожного сценарію; код виходу ≠ 0, якщо не виконано поріг p95 або помилок ≥ 1%.

## Документація

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — системна архітектура
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — покроковий план по фазах
- [`docs/CHECKLIST.md`](docs/CHECKLIST.md) — детальний чек-лист
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — деплой (Coolify / VPS), відкат, відновлення БД, інциденти

## CI

GitHub Actions: `.github/workflows/ci.yml`. Пайплайн на кожен push/PR:
install → prisma generate → lint → typecheck → test → build.
