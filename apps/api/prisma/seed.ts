/**
 * Демо-сідінг для локальної розробки VOLTSTAR.
 * Запуск: pnpm --filter @voltstar/api seed
 *
 * Дає рівно стільки даних, щоб пройти шлях клієнта: крос-номер у пошуку → товар → кошик.
 * Реальний каталог наповнюється імпортом (`catalog:import`), а не звідси.
 */
import { PrismaClient } from '@prisma/client';
import { normalizePartNumber } from '@voltstar/types';

const prisma = new PrismaClient();

async function main() {
  const bosch = await prisma.brand.upsert({
    where: { slug: 'bosch' },
    update: {},
    create: { name: 'Bosch', slug: 'bosch' },
  });

  const starters = await prisma.category.upsert({
    where: { slug: 'startery' },
    update: {},
    create: { name: 'Стартери', slug: 'startery' },
  });

  const b2cList = await prisma.priceList.upsert({
    where: { segment_currency_name: { segment: 'B2C', currency: 'UAH', name: 'Роздріб' } },
    update: {},
    create: { name: 'Роздріб', segment: 'B2C', currency: 'UAH' },
  });

  const partNumber = '0001368088';
  const product = await prisma.product.upsert({
    where: { partNumber },
    update: {},
    create: {
      slug: 'bosch-0001368088',
      name: 'Стартер Bosch 24V 6.6 кВт',
      description: 'Відновлений стартер на двигуни ЯМЗ. Продається в обмін на старий агрегат.',
      brandId: bosch.id,
      categoryId: starters.id,
      kind: 'STARTER',
      condition: 'REMANUFACTURED',
      partNumber,
      partNumberNorm: normalizePartNumber(partNumber),
      voltage: 24,
      powerKw: 6.6,
      rotation: 'CW',
      teeth: 11,
      coreDepositMinor: 300000,
      inventory: { create: { quantity: 4 } },
    },
  });

  // Крос-номери — те, за чим клієнт шукає насправді.
  for (const xref of [
    { brand: 'BOSCH', number: '0 001 368 088' },
    { brand: 'ISKRA', number: 'AZJ3151' },
    { brand: 'ЯМЗ', number: '6582.3708000' },
  ]) {
    await prisma.crossReference.upsert({
      where: {
        productId_brand_numberNorm: {
          productId: product.id,
          brand: xref.brand,
          numberNorm: normalizePartNumber(xref.number),
        },
      },
      update: {},
      create: { ...xref, productId: product.id, numberNorm: normalizePartNumber(xref.number) },
    });
  }

  const maz = await prisma.machineBrand.upsert({
    where: { slug: 'maz' },
    update: {},
    create: { name: 'МАЗ', slug: 'maz' },
  });
  const maz5440 = await prisma.machineModel.upsert({
    where: { slug: 'maz-5440' },
    update: {},
    create: { brandId: maz.id, name: '5440', slug: 'maz-5440', segment: 'TRUCK' },
  });
  await prisma.productApplication.upsert({
    where: {
      productId_machineModelId_engine: {
        productId: product.id,
        machineModelId: maz5440.id,
        engine: 'ЯМЗ-238',
      },
    },
    update: {},
    create: { productId: product.id, machineModelId: maz5440.id, engine: 'ЯМЗ-238' },
  });

  await prisma.price.upsert({
    where: { productId_priceListId: { productId: product.id, priceListId: b2cList.id } },
    update: {},
    create: { productId: product.id, priceListId: b2cList.id, amountMinor: 1450000, vatRate: 0.2 },
  });

  console.log('Seed завершено ✅');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
