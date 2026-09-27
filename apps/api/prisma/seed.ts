/**
 * Демонстраційний каталог для локальної розробки й для щойно піднятого стенду.
 * Запуск: pnpm --filter @voltstar/api seed
 *
 * Навіщо стільки позицій. Міграція розвороту видаляє каталог генераторних установок, і після
 * неї сайт лишається порожнім — а на порожньому не видно ні фасетів, ні сторінок техніки,
 * ні групування крос-номерів, тобто саме того, заради чого робився розворот. Тут рівно
 * стільки товарів, щоб усе це ожило: обидва типи агрегатів, усі чотири групи техніки,
 * три стани, 12 і 24 В, обмінний фонд.
 *
 * Це НЕ заміна прайсу. Кожен товар позначений характеристикою `demo`, seed відмовляється
 * працювати поверх справжнього каталогу, а прибрати демо можна одним рядком:
 *   pnpm --filter @voltstar/api catalog:clear-demo
 */
import { PrismaClient, type PartCondition, type PartKind, type Rotation } from '@prisma/client';
import { normalizePartNumber } from '@voltstar/types';
// Та сама транслітерація, що і в імпорті прайсу, — щоб машинні назви не розʼїхалися
// («МТЗ» → mtz, а не «mt», як вийшло б із нормалізації номерів).
import { slugify } from '../src/scripts/catalog-import';

const prisma = new PrismaClient();

/** Характеристика-маркер: за нею демо-товари видно в адмінці й прибираються скриптом. */
const DEMO_SPEC = { key: 'demo', value: 'true' };

interface DemoProduct {
  partNumber: string;
  name: string;
  brand: string;
  category: string;
  kind: PartKind;
  condition: PartCondition;
  voltage: number;
  powerKw?: number;
  amperageA?: number;
  rotation?: Rotation;
  teeth?: number;
  /** Застава за старий агрегат, грн. */
  coreDeposit?: number;
  priceUah: number;
  stock: number;
  description: string;
  /** Крос-номери: виробник → номери як у його каталозі. */
  xrefs: Record<string, string[]>;
  /** Техніка: група → «Марка|Модель|Двигун». */
  fits: Array<{
    segment: 'TRUCK' | 'CONSTRUCTION' | 'AGRICULTURAL' | 'MILITARY';
    brand: string;
    model: string;
    /** Двигун обовʼязковий: він частина унікального ключа застосовності. */
    engine: string;
  }>;
}

const PRODUCTS: DemoProduct[] = [
  {
    partNumber: '0001368088',
    name: 'Стартер Bosch 24V 6.6 кВт',
    brand: 'Bosch',
    category: 'Стартери',
    kind: 'STARTER',
    condition: 'REMANUFACTURED',
    voltage: 24,
    powerKw: 6.6,
    rotation: 'CW',
    teeth: 11,
    coreDeposit: 3000,
    priceUah: 14500,
    stock: 4,
    description: 'Відновлений стартер на двигуни ЯМЗ. Продається в обмін на старий агрегат.',
    xrefs: { BOSCH: ['0 001 368 088'], ISKRA: ['AZJ3151'], OEM: ['6582.3708000'] },
    fits: [
      { segment: 'TRUCK', brand: 'МАЗ', model: '5440', engine: 'ЯМЗ-238' },
      { segment: 'TRUCK', brand: 'КрАЗ', model: '6322', engine: 'ЯМЗ-238' },
    ],
  },
  {
    partNumber: '0001231018',
    name: 'Стартер Bosch 24V 5.5 кВт',
    brand: 'Bosch',
    category: 'Стартери',
    kind: 'STARTER',
    condition: 'NEW',
    voltage: 24,
    powerKw: 5.5,
    rotation: 'CW',
    teeth: 10,
    priceUah: 19800,
    stock: 2,
    description: 'Новий редукторний стартер на вантажівки з двигунами Cummins.',
    xrefs: { BOSCH: ['0 001 231 018'], OEM: ['3957593'] },
    fits: [{ segment: 'TRUCK', brand: 'DAF', model: 'CF 85', engine: 'Cummins 6BT' }],
  },
  {
    partNumber: 'CS1268',
    name: 'Стартер HC-Cargo 24V 4.5 кВт',
    brand: 'HC-Cargo',
    category: 'Стартери',
    kind: 'STARTER',
    condition: 'EXCHANGE',
    voltage: 24,
    powerKw: 4.5,
    rotation: 'CCW',
    teeth: 10,
    coreDeposit: 2500,
    priceUah: 11900,
    stock: 3,
    description: 'Редукторний стартер на екскаватори з двигуном Cummins 6BT.',
    xrefs: { BOSCH: ['0 001 231 019'], OEM: ['4934633'] },
    fits: [{ segment: 'CONSTRUCTION', brand: 'Caterpillar', model: '320', engine: 'Cummins 6BT' }],
  },
  {
    partNumber: 'AZE2555',
    name: 'Стартер Iskra 24V 7.8 кВт',
    brand: 'Iskra',
    category: 'Стартери',
    kind: 'STARTER',
    condition: 'REMANUFACTURED',
    voltage: 24,
    powerKw: 7.8,
    rotation: 'CW',
    teeth: 12,
    coreDeposit: 4000,
    priceUah: 26500,
    stock: 1,
    description: 'Відновлений стартер на бронетехніку з двигуном УТД-20.',
    xrefs: { ISKRA: ['AZE2555'], OEM: ['СТ-142Б'] },
    fits: [{ segment: 'MILITARY', brand: 'БТР', model: '80', engine: 'УТД-20' }],
  },
  {
    partNumber: 'CT2221',
    name: 'Стартер 12V 2.7 кВт',
    brand: 'АТЕ',
    category: 'Стартери',
    kind: 'STARTER',
    condition: 'REMANUFACTURED',
    voltage: 12,
    powerKw: 2.7,
    rotation: 'CW',
    teeth: 9,
    coreDeposit: 1200,
    priceUah: 5400,
    stock: 6,
    description: 'Відновлений стартер на трактори МТЗ із двигуном Д-243.',
    xrefs: { OEM: ['СТ-222А', '24.3708000'] },
    fits: [{ segment: 'AGRICULTURAL', brand: 'МТЗ', model: '82', engine: 'Д-243' }],
  },
  {
    partNumber: '0001417075',
    name: 'Стартер Bosch 24V 6.0 кВт',
    brand: 'Bosch',
    category: 'Стартери',
    kind: 'STARTER',
    condition: 'NEW',
    voltage: 24,
    powerKw: 6.0,
    rotation: 'CW',
    teeth: 11,
    priceUah: 22400,
    stock: 2,
    description: 'Новий стартер на самоскиди й тягачі з двигунами Deutz.',
    xrefs: { BOSCH: ['0 001 417 075'], OEM: ['01182265'] },
    fits: [{ segment: 'CONSTRUCTION', brand: 'Liebherr', model: 'R 924', engine: 'Deutz BF4M' }],
  },
  {
    partNumber: 'AZF4581',
    name: 'Стартер Iskra 12V 3.2 кВт',
    brand: 'Iskra',
    category: 'Стартери',
    kind: 'STARTER',
    condition: 'NEW',
    voltage: 12,
    powerKw: 3.2,
    rotation: 'CCW',
    teeth: 9,
    priceUah: 8900,
    stock: 5,
    description: 'Новий стартер на комбайни з двигуном Perkins.',
    xrefs: { ISKRA: ['AZF4581'], OEM: ['2873K401'] },
    fits: [
      { segment: 'AGRICULTURAL', brand: 'New Holland', model: 'TC5.90', engine: 'Perkins 1104' },
    ],
  },
  {
    partNumber: '0120468131',
    name: 'Генератор Bosch 28V 80A',
    brand: 'Bosch',
    category: 'Генератори',
    kind: 'ALTERNATOR',
    condition: 'NEW',
    voltage: 28,
    amperageA: 80,
    rotation: 'CW',
    priceUah: 18900,
    stock: 6,
    description: 'Новий генератор на сільгосптехніку John Deere.',
    xrefs: { BOSCH: ['0 120 468 131'], OEM: ['AL120851'] },
    fits: [
      { segment: 'AGRICULTURAL', brand: 'John Deere', model: '8400', engine: 'PowerTech 8.1' },
    ],
  },
  {
    partNumber: '0124655025',
    name: 'Генератор Bosch 28V 120A',
    brand: 'Bosch',
    category: 'Генератори',
    kind: 'ALTERNATOR',
    condition: 'REMANUFACTURED',
    voltage: 28,
    amperageA: 120,
    rotation: 'CW',
    coreDeposit: 2800,
    priceUah: 15600,
    stock: 3,
    description: 'Відновлений генератор на магістральні тягачі.',
    xrefs: { BOSCH: ['0 124 655 025'], OEM: ['1811725'] },
    fits: [{ segment: 'TRUCK', brand: 'Scania', model: 'R 440', engine: 'DC13' }],
  },
  {
    partNumber: 'AAK5573',
    name: 'Генератор Iskra 28V 100A',
    brand: 'Iskra',
    category: 'Генератори',
    kind: 'ALTERNATOR',
    condition: 'NEW',
    voltage: 28,
    amperageA: 100,
    rotation: 'CW',
    priceUah: 16700,
    stock: 4,
    description: 'Новий генератор на навантажувачі й екскаватори.',
    xrefs: { ISKRA: ['AAK5573'], OEM: ['11.203.535'] },
    fits: [{ segment: 'CONSTRUCTION', brand: 'JCB', model: '3CX', engine: 'JCB Dieselmax' }],
  },
  {
    partNumber: '1100128',
    name: 'Генератор Prestolite 28V 140A',
    brand: 'Prestolite',
    category: 'Генератори',
    kind: 'ALTERNATOR',
    condition: 'EXCHANGE',
    voltage: 28,
    amperageA: 140,
    rotation: 'CW',
    coreDeposit: 3500,
    priceUah: 24300,
    stock: 1,
    description: 'Генератор підвищеної віддачі на техніку зі складним електрообладнанням.',
    xrefs: { PRESTOLITE: ['1100128'], OEM: ['8600018'] },
    fits: [{ segment: 'MILITARY', brand: 'HMMWV', model: 'M1151', engine: 'GEP 6.5L' }],
  },
  {
    partNumber: 'G1221',
    name: 'Генератор 14V 90A',
    brand: 'АТЕ',
    category: 'Генератори',
    kind: 'ALTERNATOR',
    condition: 'REMANUFACTURED',
    voltage: 14,
    amperageA: 90,
    rotation: 'CW',
    coreDeposit: 900,
    priceUah: 4800,
    stock: 8,
    description: 'Відновлений генератор на трактори МТЗ.',
    xrefs: { OEM: ['Г1221', '14.3701'] },
    fits: [{ segment: 'AGRICULTURAL', brand: 'МТЗ', model: '82', engine: 'Д-243' }],
  },
  {
    partNumber: 'SBH0011',
    name: 'Бендикс стартера 11 зубів',
    brand: 'HC-Cargo',
    category: 'Вузли стартерів',
    kind: 'COMPONENT',
    condition: 'NEW',
    voltage: 24,
    teeth: 11,
    priceUah: 1450,
    stock: 12,
    description: 'Обгінна муфта на стартери Bosch серії 0 001 368.',
    xrefs: { BOSCH: ['1 006 209 528'] },
    fits: [{ segment: 'TRUCK', brand: 'МАЗ', model: '5440', engine: 'ЯМЗ-238' }],
  },
  {
    partNumber: 'RKB0245',
    name: 'Ремкомплект генератора 28V',
    brand: 'HC-Cargo',
    category: 'Ремкомплекти',
    kind: 'REPAIR_KIT',
    condition: 'NEW',
    voltage: 28,
    priceUah: 2100,
    stock: 9,
    description: 'Підшипники, щітки й регулятор напруги на генератори Bosch 28 В.',
    xrefs: { BOSCH: ['1 197 311 517'] },
    fits: [{ segment: 'TRUCK', brand: 'Scania', model: 'R 440', engine: 'DC13' }],
  },
];

const toMinor = (uah: number): number => Math.round(uah * 100);

async function main() {
  // Демо не має лягати поверх справжнього каталогу: у бойовій базі це виглядало б як товар,
  // якого насправді немає, і клієнт замовив би агрегат, що не існує.
  const real = await prisma.product.count({
    where: { specs: { none: { key: DEMO_SPEC.key, value: DEMO_SPEC.value } } },
  });
  if (real > 0) {
    console.error(
      `❌ У каталозі вже є ${real} товарів без позначки «demo» — схоже на справжній прайс.\n` +
        '   Seed нічого не змінив. Якщо демо тут таки потрібне, спершу приберіть реальні товари.',
    );
    process.exit(1);
  }

  const b2c = await prisma.priceList.upsert({
    where: { segment_currency_name: { segment: 'B2C', currency: 'UAH', name: 'Роздріб' } },
    update: {},
    create: { name: 'Роздріб', segment: 'B2C', currency: 'UAH' },
  });

  for (const p of PRODUCTS) {
    const brand = await prisma.brand.upsert({
      where: { slug: slugify(p.brand) },
      update: {},
      create: { name: p.brand, slug: slugify(p.brand) },
    });
    const category = await prisma.category.upsert({
      where: { slug: slugify(p.category) },
      update: {},
      create: { name: p.category, slug: slugify(p.category) },
    });

    const product = await prisma.product.upsert({
      where: { partNumber: p.partNumber },
      update: {},
      create: {
        slug: `${slugify(p.brand)}-${slugify(p.partNumber)}`,
        partNumber: p.partNumber,
        partNumberNorm: normalizePartNumber(p.partNumber),
        name: p.name,
        description: p.description,
        brandId: brand.id,
        categoryId: category.id,
        kind: p.kind,
        condition: p.condition,
        voltage: p.voltage,
        ...(p.powerKw === undefined ? {} : { powerKw: p.powerKw }),
        ...(p.amperageA === undefined ? {} : { amperageA: p.amperageA }),
        ...(p.rotation === undefined ? {} : { rotation: p.rotation }),
        ...(p.teeth === undefined ? {} : { teeth: p.teeth }),
        ...(p.coreDeposit === undefined ? {} : { coreDepositMinor: toMinor(p.coreDeposit) }),
        specs: { create: [DEMO_SPEC] },
        inventory: { create: { quantity: p.stock } },
      },
    });

    for (const [xrefBrand, numbers] of Object.entries(p.xrefs)) {
      for (const number of numbers) {
        await prisma.crossReference.upsert({
          where: {
            productId_brand_numberNorm: {
              productId: product.id,
              brand: xrefBrand,
              numberNorm: normalizePartNumber(number),
            },
          },
          update: {},
          create: {
            productId: product.id,
            brand: xrefBrand,
            number,
            numberNorm: normalizePartNumber(number),
          },
        });
      }
    }

    for (const f of p.fits) {
      const machineBrand = await prisma.machineBrand.upsert({
        where: { name: f.brand },
        update: {},
        create: { name: f.brand, slug: slugify(f.brand) },
      });
      const model = await prisma.machineModel.upsert({
        where: { brandId_name: { brandId: machineBrand.id, name: f.model } },
        update: {},
        create: {
          brandId: machineBrand.id,
          name: f.model,
          slug: `${slugify(f.brand)}-${slugify(f.model)}`,
          segment: f.segment,
        },
      });
      await prisma.productApplication.upsert({
        where: {
          productId_machineModelId_engine: {
            productId: product.id,
            machineModelId: model.id,
            engine: f.engine,
          },
        },
        update: {},
        create: { productId: product.id, machineModelId: model.id, engine: f.engine },
      });
    }

    await prisma.price.upsert({
      where: { productId_priceListId: { productId: product.id, priceListId: b2c.id } },
      update: {},
      create: {
        productId: product.id,
        priceListId: b2c.id,
        amountMinor: toMinor(p.priceUah),
        vatRate: 0.2,
      },
    });
  }

  console.log(`Seed завершено ✅ демо-товарів: ${PRODUCTS.length}`);
  console.log('   Прибрати: pnpm --filter @voltstar/api catalog:clear-demo');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
