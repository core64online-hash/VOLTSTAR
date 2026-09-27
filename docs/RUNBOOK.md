# VOLTSTAR — runbook: деплой, відкат, відновлення

Production-стек описано в [`docker-compose.prod.yml`](../docker-compose.prod.yml): `postgres`, `typesense`,
`migrate` (одноразові міграції перед кожним стартом API), `api`, `web`, `backup` (щоденні копії БД),
`offsite` (копії бекапів у зовнішнє S3-сховище — вмикається змінними, розділ 6),
`retention` (щоденне очищення персональних даних за строками). Образи — на Node 22 LTS. Сайт і API працюють на **одному домені**:
API — під `/api` (без CORS; вебхуки оплат — `https://<домен>/api/payments/webhooks/<провайдер>`).

Основний спосіб розгортання — **Coolify** (домени й TLS від його Traefik). На звичайному VPS без Coolify
той самий стек запускається з `docker-compose.caddy.yml` (TLS від Caddy) — див. [розділ 7](#7-vps-без-coolify).

---

## 1. Разове налаштування Coolify

1. **DNS.** Запис `A` (і `AAAA`, якщо є IPv6) для `voltstar.ua` і `staging.voltstar.ua` → IP сервера Coolify.
2. **Доступ до репозиторію.** Coolify → *Sources* → GitHub App → надати доступ до `core64online-hash/VOLTSTART`.
3. **Гілка production.** Один раз створіть її з `main` (далі її рухає лише workflow деплою):
   `git push origin main:production`
4. **Два ресурси** (Project → *+ New* → *Docker Compose*, джерело — GitHub App):

   | | staging | production |
   |---|---|---|
   | Гілка | `main` | `production` |
   | Compose-файл | `/docker-compose.prod.yml` | `/docker-compose.prod.yml` |
   | Домен сервісу `web` | `https://staging.voltstar.ua:3000` | `https://voltstar.ua:3000` |
   | Домен сервісу `api` | `https://staging.voltstar.ua:4000/api` | `https://voltstar.ua:4000/api` |
   | Auto Deploy | **вимкнути** (деплой запускає workflow після зеленого CI) | **вимкнути** |

   Порт після домену — це порт контейнера, на який Traefik проксує `443` (формат Coolify). Для `api`
   шлях `/api` **не** має обрізатися (API сам обслуговує маршрути з префіксом `/api`) — за замовчуванням
   Coolify його обрізає, тому вимкніть *Strip prefixes* (п. 6).
5. **Змінні середовища** ресурсу (*Environment Variables*) — за зразком [`deploy/.env.prod.example`](../deploy/.env.prod.example).
   Секрети генеруйте окремо для кожного середовища: `openssl rand -hex 32`.
   Обовʼязкові: `SITE_URL`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `INTERNAL_API_TOKEN`, `TYPESENSE_API_KEY`.
   Для staging — **тестові** ключі оплат (sandbox), для production — бойові.
   Версія = SHA коміту: Coolify передає `SOURCE_COMMIT` сам (її перевіряють smoke-тести після деплою).
   Рядок `SOURCE_COMMIT`, який Coolify може додати в список змінних, видаліть або лишіть порожнім.
   ⚠️ Coolify позначає «Required» лише частину змінних — `SITE_URL` і `POSTGRES_PASSWORD` теж обовʼязкові
   (вони входять у довші рядки compose, тому Coolify їх не розпізнає). `SITE_URL` — з `https://`, без порту
   й `/` у кінці, і з позначкою *Available during build* (сайт вшиває адресу під час збірки).
   `SITE_URL` у кожного ресурсу **свій**: staging — `https://staging.<домен>`, production — `https://<домен>`.
   Якщо staging зібрано з адресою production, сайт відкривається, але вхід і кошик падають з
   «Failed to fetch» (браузер іде на API іншого домену). Після зміни `SITE_URL` — **Redeploy** (нова збірка).
   Без `openssl` (Windows PowerShell) секрет генерує:
   `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [BitConverter]::ToString($b).Replace('-','').ToLower()`
6. **Налаштування ресурсу**, без яких стек не працює як слід:

   | Де | Параметр | Значення | Чому |
   |---|---|---|---|
   | General → Build pipeline | Preserve repository during deployment | **увімкнено** | сервіс `backup` запускає скрипти з репозиторію (`scripts/`, `deploy/`) |
   | Advanced → Build | Source commit availability | **Available during build** | SHA коміту = версія образів; за нею smoke-тести перевіряють деплой |
   | Advanced → Build | Build arguments | **Managed manually in Dockerfile** | аргументи збірки вже задано в compose; інакше Coolify передає у збірку всі змінні, зокрема секрети |
   | Advanced → Deployment | Auto deploy | **Manual deployments only** | деплой запускає workflow після зеленого CI |
   | Advanced → Proxy | Strip prefixes | **вимкнено** | інакше Traefik обрізає `/api`, і API відповідає 404 на всі запити |
   | Domains | `web` / `api` | той самий домен, порти `3000` / `4000`, шлях `/api` для `api` | сайт і API на одному домені |

7. **API-токен** для GitHub Actions: Coolify → *Keys & Tokens* → *API tokens* → права `deploy` і `read` (read — щоб стежити за статусом деплою).
   API має бути ввімкнено: *Settings* → *API Access* (без обмеження IP — адреси GitHub Actions змінюються).
   UUID ресурсів — з адреси сторінки ресурсу в Coolify.
8. **Сповіщення Coolify** (Telegram/email) про збої деплою й перезапуски контейнерів — *Notifications*.

## 2. Налаштування GitHub

*Settings → Environments*: створіть `staging` і `production`; для `production` увімкніть
**Required reviewers** — без підтвердження деплой у production не піде.

*Settings → Secrets and variables → Actions*:

| Тип | Назва | Значення |
|---|---|---|
| variable | `DEPLOY_ENABLED` | `true` (без неї workflow деплою нічого не робить) |
| variable | `STAGING_URL` | `https://staging.voltstar.ua` |
| variable | `PRODUCTION_URL` | `https://voltstar.ua` — потрібна лише для **автоматичного** деплою production після мержу |
| secret | `COOLIFY_URL` | адреса вашого Coolify, напр. `https://mycoolify.pp.ua` |
| secret | `COOLIFY_TOKEN` | API-токен із п. 1.7 |
| secret | `COOLIFY_STAGING_UUID` | UUID ресурсу staging |
| secret | `COOLIFY_PRODUCTION_UUID` | UUID ресурсу production |

`DEPLOY_ENABLED`, `STAGING_URL` і секрети staging можна тримати в environment `staging`, а
`COOLIFY_PRODUCTION_UUID` — в environment `production`. **`PRODUCTION_URL` — лише на рівні репозиторію**
(*Repository variables*): від неї залежить, чи деплоїти production автоматично, а умова job бачить тільки їх.

**Деплой production вручну — без цієї змінної.** *Actions → Deploy → Run workflow*, увімкнути
«Задеплоїти production»; адреса для smoke береться з поля «Адреса production» (типово
`https://voltstar.pp.ua`). Спершу як завжди їде staging і його smoke — production без зеленого
staging не піде. Змінна лишається головною: доки її не задано, мерж у `main` бойовий домен
не чіпає, і кожне оновлення production — явне рішення.

## 3. Як відбувається деплой

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml):

1. Мерж у `main` → CI (lint, типи, тести, збірка, **збірка Docker-образів**) зелений →
2. **staging**: Coolify збирає й запускає `main` → `scripts/smoke.mjs` перевіряє, що задеплоєно саме цей коміт
   і що сайт, API, БД, пошук, SEO-файли й заголовки безпеки в порядку →
3. **production** (після підтвердження рецензента): гілка `production` переміщується на перевірений коміт →
   Coolify деплоїть → smoke-тести. **Якщо smoke-тести не пройшли — автоматичний відкат** на попередній
   коміт `production` і повторна перевірка.

Smoke-тести, крім доступності, перевіряють те, що ламається непомітно: CSP сайту дозволяє запити до API
**цього** домену (інакше — «Failed to fetch» при вході), `POST /api/accounts/login` з невірним паролем → 401,
пресети техніки для підбору без дублікатів, canonical на правильний домен.

**Перевірка без деплою** (напр., після зміни змінних у Coolify): *Actions → Deploy → Run workflow* →
`smoke_only` ✓ (і `smoke_url` — для іншої адреси, напр. production). Деплой і job production пропускаються.

Міграції БД виконує сервіс `migrate` перед стартом API. Міграції проєкту адитивні (нові таблиці/індекси);
для руйнівних змін (перейменування, видалення стовпців) — двохетапний деплой: спершу код, сумісний з
обома схемами, потім міграція.

Ручний деплой певного коміту: *Actions → Deploy → Run workflow* → `ref`.

## 4. Перший запуск production

Команди нижче — у терміналі Coolify (*Terminal*). ⚠️ Контейнер вибирається у списку вгорі терміналу;
назва містить UUID ресурсу: `api-<UUID production>-…` ≠ `api-<UUID staging>-…`. Бази staging і production
окремі — команда, виконана не в тому контейнері, змінює не той сайт.

1. Задеплоїти (розділ 3), дочекатися зелених smoke-тестів.
2. **Довідники каталогу** (бренди, категорії, прайс-листи B2C/B2B, пресети техніки для підбору) — seed
   і переіндексація пошуку в контейнері `api`:
   `npx tsx prisma/seed.ts`, потім `npx tsx src/scripts/reindex-search.ts`.
   Seed можна запускати повторно — дублікатів не створює. Демо-товар потім відредагуйте або приберіть
   в адмін-панелі.
3. **Адміністратор**: зареєструйтеся на сайті **цього** середовища, далі в терміналі `api`:
   `npx tsx src/scripts/set-role.ts <email> ADMIN` (роль діє з наступного входу).
   Помилка `P2025 … No record was found` — такого email у цій базі немає (не той контейнер або не зареєстровано).
4. **Наповнити каталог** — розділ 4.1.
5. У кабінетах платіжних систем вкажіть URL вебхуків і повернення:
   `https://voltstar.ua/api/payments/webhooks/WAYFORPAY` (аналогічно `LIQPAY`, `STRIPE`).
6. Перевірити пошту: «Забули пароль» → лист прийшов.
7. Зовнішній моніторинг доступності (UptimeRobot / Better Stack) на `https://voltstar.ua/api/health/ready`
   з інтервалом 1 хв і сповіщенням у Telegram.


### 4.1. Наповнення каталогу з прайсу (CSV)

Товари можна заводити по одному в адмін-панелі, а весь прайс — одним файлом:

```bash
# у терміналі контейнера api
npx tsx src/scripts/import-catalog.ts <файл або посилання> --dry-run   # лише перевірка
npx tsx src/scripts/import-catalog.ts <файл або посилання>             # запис
```

Замість файлу можна дати **https-посилання**: ведіть прайс у Google Таблиці, опублікуйте аркуш як CSV
(*Файл → Оприлюднити в інтернеті → CSV*) і передайте це посилання — нічого копіювати в контейнер не треба.

Прапорці: `--dry-run` (нічого не пише, лише показує, що буде), `--no-reindex` (без переіндексації пошуку).

**Що важливо знати:**

- **Ключ — колонка `partNumber` (артикул).** Повторний запуск того самого файлу оновлює товари,
  а не дублює їх. Роздільники в номері значення не мають: `0 001 368 088` і `0001368088` — один товар.
- **Колонки, яких немає в заголовку, не чіпаються.** Файл лише з `partNumber` і `priceB2C` оновить
  ціни й не зачепить склад, описи, характеристики, крос-номери та техніку. Порожня клітинка — теж
  «не змінювати», а не «нуль».
- **Крос-номери й техніка замінюються повністю**, коли відповідне сімейство колонок (`xref:` / `fits:`)
  є в заголовку: у вивантаженні постачальника це завжди повний перелік, а не доповнення.
- **Один битий рядок не зриває імпорт**: решта записується, а в кінці виводиться перелік помилок із
  номерами рядків. Код виходу ≠ 0, якщо хоч один рядок не пройшов.
- **Бренди, категорії й техніка створюються автоматично** за назвою (машинна назва — транслітерацією),
  але **не перейменовуються**: одруківка в прайсі не змінить назву бренду для всього каталогу.
- **Прайс-лист** для сегмента створюється, якщо його ще немає (`Роздріб` для B2C, `Опт` для B2B).

**Колонки.** Обовʼязкові: `partNumber`, `name`, `brand`, `category`, `kind`.
Решта — за потреби: `condition` (типово `NEW`), `slug` (інакше виводиться з бренду й артикула),
`description`, `brandSlug`, `categorySlug`, `voltage`, `powerKw`, `amperageA`, `rotation`, `teeth`,
`coreDeposit` (застава за старий агрегат, грн), `images` (через `;`), `currency`, `priceB2C`,
`priceB2B` (у гривнях), `vatRate`, `stock`.

`kind`: `STARTER`, `ALTERNATOR`, `COMPONENT`, `REPAIR_KIT`.
`condition`: `NEW`, `REMANUFACTURED`, `EXCHANGE`. `rotation`: `CW`, `CCW`.

**Сімейства колонок** (кілька значень у клітинці — через `;`):

| Префікс | Приклад колонки | Приклад значення |
|---|---|---|
| `xref:` — крос-номери | `xref:BOSCH` | `0 001 368 088; 0001368089` |
| `fits:` — техніка | `fits:TRUCK` | `МАЗ\|5440\|ЯМЗ-238\|2005-2015; КрАЗ\|6322` |
| `spec:` — характеристики | `spec:Кріплення` | `3 отвори` |

Назва колонки `xref:` — виробник каталогу (`BOSCH`, `ISKRA`, `OEM`…). Назва колонки `fits:` — група
техніки: `TRUCK`, `CONSTRUCTION`, `AGRICULTURAL`, `MILITARY`. Запис техніки — поля через `|`:
`Марка|Модель|Двигун|Роки`, де двигун і роки необовʼязкові (`2005-2015`, `2010-`, `-2015` або `2008`).
Роздільник саме `|`, а не пробіл, бо марки бувають із двох слів («John Deere»).

Зразок із усіма колонками — [`deploy/catalog-example.csv`](../deploy/catalog-example.csv). Файл можна
зберігати з Excel або LibreOffice: BOM, CRLF і крапка з комою як роздільник розпізнаються, ціни можна
писати як `18 990,50`.

## 5. Моніторинг і журнали

- **Liveness** `GET /api/health`, **readiness** `GET /api/health/ready` (перевіряє БД; 503 — якщо недоступна).
  Healthcheck-и є в образах — Coolify/Docker перезапускає завислі контейнери.
- **Метрики Prometheus**: `GET /api/metrics` з `Authorization: Bearer $METRICS_TOKEN`
  (без токена в production — 404). Є лічильники й гістограми запитів за маршрутами, памʼять, затримка
  event loop, `voltstar_build_info`. Корисні алерти: частка 5xx > 1% за 5 хв; p95
  `http_request_duration_seconds` > 1 с; `up == 0`.
- **Журнали** — у Coolify (*Logs* сервісу). Caddy (VPS-варіант) пише доступи в JSON.
- **Дії персоналу** — журнал аудиту в адмін-панелі (*Журнал*).
- **Звіти про помилки (Sentry або сумісний сервіс, напр. GlitchTip)** — змінна `SENTRY_DSN` (одна на API
  й сайт; позначка *Available during build* — DSN для браузера вшивається під час збірки) і
  `SENTRY_ENVIRONMENT` (`staging` / `production`). Надсилаються: 5xx і необроблені винятки API (без 4xx,
  помилок валідації й `/api/health`), помилки серверного рендеру сайту з маршрутом, помилки в браузері.
  Без персональних даних: без IP, cookies, користувача, тіла й заголовків запиту; URL — без query-рядка
  (там бувають email і токени скидання пароля). Версія (`release`) = SHA коміту. Без DSN нічого не
  надсилається, а SDK браузера навіть не завантажується. Після зміни DSN — **Redeploy**.

## 6. Відкат і відновлення

**Автоматичний відкат** — див. розділ 3.

**Ручний відкат коду** (напр., проблема помічена пізніше):
1. Coolify → ресурс production → *Deployments* → попередній успішний деплой → *Redeploy*; або
2. `git push origin <попередній-sha>:production --force` і *Deploy* у Coolify.

Відкат коду **не відкочує міграції** — тому вони адитивні (старий код працює з новою схемою).

**Відновлення БД із резервної копії** (втрата/пошкодження даних):
```bash
# 1. Знайти копію (том backups сервісу backup; .last-success — час останньої вдалої)
docker compose exec backup ls -lt /backups
# 2. Зупинити запис: api і web
docker compose stop api web retention
# 3. Відновити (контрольна сума перевіряється автоматично)
docker compose exec backup sh -c 'TARGET_DATABASE_URL="$DATABASE_URL" /scripts/db-restore.sh /backups/voltstar-<дата>.dump'
# 4. Запустити й перевірити
docker compose start api web retention && node scripts/smoke.mjs https://voltstar.ua
```
У Coolify ті самі команди — у терміналі контейнера `backup` (без `docker compose exec backup`), а зупинка
й запуск сервісів — на сторінці ресурсу.
Перед відновленням у production потренуйтеся на staging: `/scripts/db-verify-restore.sh` (у контейнері
`backup`) знімає копію, відновлює її в тимчасову БД і звіряє кількість рядків.

### Копії поза сервером (сервіс `offsite`)

Том `backups` лежить на тому ж сервері, тож від втрати сервера захищають лише копії в зовнішньому
S3-сумісному сховищі (Cloudflare R2, Backblaze B2, AWS S3, Wasabi). Сервіс `offsite` (rclone) щогодини
копіює туди нові завершені бекапи й видаляє там копії, старші за `OFFSITE_KEEP_DAYS`. Поки не задано
`OFFSITE_S3_BUCKET`, сервіс нічого не робить.

1. У кабінеті сховища створіть **бакет** і **ключ доступу** лише до нього (читання й запис).
2. Змінні ресурсу в Coolify (для кожного середовища — свій бакет або свій `OFFSITE_S3_PREFIX`):

   | Змінна | Приклад | |
   |---|---|---|
   | `OFFSITE_S3_BUCKET` | `voltstar-backups` | вмикає сервіс |
   | `OFFSITE_S3_ENDPOINT` | R2: `https://<account-id>.r2.cloudflarestorage.com`, B2: `https://s3.<регіон>.backblazeb2.com` | для AWS S3 — порожньо |
   | `OFFSITE_S3_PROVIDER` | `Cloudflare` / `AWS` / `Other` | типово `Other` |
   | `OFFSITE_S3_REGION` | `auto` (R2), `eu-central-003` (B2) | типово `auto` |
   | `OFFSITE_S3_ACCESS_KEY_ID`, `OFFSITE_S3_SECRET_ACCESS_KEY` | ключ із п. 1 | секрети |
   | `OFFSITE_CRYPT_PASSWORD` | `openssl rand -hex 32` | рекомендовано: шифрування на сервері, сховище бачить лише шифротекст |
   | `OFFSITE_S3_PREFIX`, `OFFSITE_KEEP_DAYS`, `OFFSITE_INTERVAL_SEC` | `voltstar`, `30`, `3600` | необовʼязково |

   ⚠️ `OFFSITE_CRYPT_PASSWORD` збережіть ще й поза сервером (менеджер паролів): без нього зашифровані
   копії не відновити.
3. **Redeploy** → у журналі сервісу `offsite`: `✅ Зовнішні копії синхронізовано … N шт.`

**Відновлення з зовнішнього сховища** (сервер втрачено або локальні копії пошкоджені) — на новому
сервері підніміть стек із тими самими змінними `OFFSITE_*`, далі:
```bash
# у контейнері offsite: перелік копій і завантаження потрібної (розшифровується автоматично)
sh /deploy/offsite-loop.sh list
sh /deploy/offsite-loop.sh fetch voltstar-<дата>.dump      # → /backups/restore/
# у контейнері backup (api, web, retention зупинено):
TARGET_DATABASE_URL="$DATABASE_URL" /scripts/db-restore.sh /backups/restore/voltstar-<дата>.dump
```

## 7. VPS без Coolify

```bash
cp deploy/.env.prod.example deploy/.env.prod   # заповнити, додати SITE_DOMAIN і ACME_EMAIL
docker compose -f docker-compose.prod.yml -f docker-compose.caddy.yml --env-file deploy/.env.prod up -d --build
node scripts/smoke.mjs https://voltstar.ua
```
Caddy отримує сертифікати Let's Encrypt автоматично (потрібні відкриті порти 80/443 і DNS на сервер),
закриває `/api/metrics` ззовні, редіректить `www` на основний домен.

## 8. Інцидент: короткий чек-лист

1. `curl https://voltstar.ua/api/health/ready` — API й БД живі? Повна перевірка ззовні — *Run workflow* з `smoke_only` (розділ 3).
2. Coolify → *Logs* `api`/`web` за останні хвилини; `docker compose ps` — чи немає рестартів.
3. Помилка з'явилася після деплою → **відкат** (розділ 6), потім розбір.
4. Оплати: чи доходять вебхуки (журнал `api`, розділ `payments`), чи не змінились ключі.
5. Після усунення — запис в історії змін і, за потреби, повідомлення клієнтам.
