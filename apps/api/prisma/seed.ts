/**
 * Початкові довідники VOLTSTAR — те, без чого не працює імпорт і кабінет.
 * Запуск: pnpm --filter @voltstar/api seed
 *
 * Товарів тут навмисно немає. Каталог наповнюється лише з реальних джерел
 * (`catalog:import` із прайсу постачальника чи `catalog:import-pdf` із каталогу
 * застосовності) — демонстраційні позиції на робочому сайті небезпечні: клієнт
 * замовив би агрегат, якого немає.
 *
 * Запускати можна скільки завгодно разів — нічого не дублює й не перезаписує.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Прайс-листи, на які спираються ціни: роздріб для приватних, опт для організацій. */
const PRICE_LISTS = [
  { name: 'Роздріб', segment: 'B2C' as const, currency: 'UAH' as const },
  { name: 'Опт', segment: 'B2B' as const, currency: 'UAH' as const },
];

async function main() {
  for (const list of PRICE_LISTS) {
    await prisma.priceList.upsert({
      where: {
        segment_currency_name: {
          segment: list.segment,
          currency: list.currency,
          name: list.name,
        },
      },
      update: {},
      create: list,
    });
  }

  console.log(`Seed завершено ✅ прайс-листів: ${PRICE_LISTS.length}, товарів не створено.`);
  console.log('   Каталог наповнюється імпортом: catalog:import або catalog:pdf-to-csv.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
