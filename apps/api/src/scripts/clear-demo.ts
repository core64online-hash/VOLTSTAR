/**
 * Прибирає демонстраційні товари, коли в каталог заходить справжній прайс.
 *
 *   pnpm --filter @voltstar/api catalog:clear-demo --dry-run   # лише показати
 *   pnpm --filter @voltstar/api catalog:clear-demo
 *
 * Демо позначається характеристикою `demo=true` (див. prisma/seed.ts). Товари без цієї
 * позначки не чіпаються — реальний каталог у безпеці навіть при випадковому запуску.
 *
 * Товар, на який уже посилається оформлене замовлення, не видаляється: історія й документи
 * по ньому мають лишитися читабельними. Такі товари перелічуються окремо.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

function loadEnv(): void {
  for (const file of [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../../.env')]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

const DEMO = { key: 'demo', value: 'true' };

async function main(): Promise<void> {
  loadEnv();
  const dryRun = process.argv.slice(2).includes('--dry-run');
  const prisma = new PrismaService();

  try {
    const demo = await prisma.product.findMany({
      where: { specs: { some: DEMO } },
      select: { id: true, partNumber: true, name: true, _count: { select: { orderItems: true } } },
      orderBy: { partNumber: 'asc' },
    });

    if (demo.length === 0) {
      console.log('Демонстраційних товарів немає.');
      return;
    }

    const sold = demo.filter((p) => p._count.orderItems > 0);
    const removable = demo.filter((p) => p._count.orderItems === 0);

    for (const p of removable) console.log(`− ${p.partNumber} ${p.name}`);
    for (const p of sold) {
      console.log(`• ${p.partNumber} ${p.name} — лишається: є в оформлених замовленнях`);
    }

    if (dryRun) {
      console.log(`\nПеревірка: буде видалено ${removable.length}, лишиться ${sold.length}.`);
      return;
    }

    // Крос-номери, застосовність, характеристики, залишки й ціни підуть каскадом за товаром.
    const { count } = await prisma.product.deleteMany({
      where: { id: { in: removable.map((p) => p.id) } },
    });
    console.log(`\nВидалено демонстраційних товарів: ${count}, лишилося ${sold.length}.`);
    console.log(
      'ℹ️  Не забудьте переіндексувати пошук: pnpm --filter @voltstar/api search:reindex',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌', (e as Error).message);
  process.exit(1);
});
