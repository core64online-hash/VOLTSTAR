import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SearchService } from '../search/search.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService.setRole', () => {
  const user = (role: string) => ({
    id: 'u2',
    email: 'u@x.ua',
    firstName: null,
    lastName: null,
    phone: null,
    role,
    organization: null,
    _count: { orders: 0 },
    createdAt: new Date(),
  });
  function setup(role: string, admins = 2) {
    const prisma = {
      user: {
        findUnique: vi.fn(async () => (role ? { role } : null)),
        count: vi.fn(async () => admins),
        update: vi.fn(async ({ data }: { data: { role: string } }) => user(data.role)),
      },
    };
    return { svc: new AdminUsersService(prisma as unknown as PrismaService), prisma };
  }

  it('призначає роль', async () => {
    const { svc } = setup('CUSTOMER');
    await expect(svc.setRole('u2', 'MANAGER', 'admin')).resolves.toMatchObject({ role: 'MANAGER' });
  });

  it('власну роль змінити не можна; неіснуючий користувач — 404', async () => {
    await expect(setup('ADMIN').svc.setRole('me', 'CUSTOMER', 'me')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup('').svc.setRole('u2', 'MANAGER', 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('останнього адміністратора не можна понизити', async () => {
    const { svc, prisma } = setup('ADMIN', 1);
    await expect(svc.setRole('u2', 'MANAGER', 'admin')).rejects.toThrow(/останнього/);
    expect(prisma.user.update).not.toHaveBeenCalled();
    await expect(setup('ADMIN', 2).svc.setRole('u2', 'MANAGER', 'admin')).resolves.toMatchObject({ role: 'MANAGER' });
  });
});

describe('AdminCatalogService', () => {
  const row = {
    id: 'p1',
    slug: 'bosch-0001368088',
    name: 'Стартер Bosch 24V',
    description: null,
    brand: { id: 'b1', name: 'Bosch' },
    category: { id: 'c1', name: 'Стартери' },
    partNumber: '0001368088',
    partNumberNorm: '0001368088',
    kind: 'STARTER',
    condition: 'REMANUFACTURED',
    voltage: 24,
    powerKw: null,
    amperageA: null,
    rotation: null,
    teeth: null,
    coreDepositMinor: null,
    images: [],
    specs: [],
    crossReferences: [],
    applications: [],
    inventory: { quantity: 4 },
    prices: [],
    updatedAt: new Date(),
  };
  function setup() {
    const prisma = {
      product: {
        findUnique: vi.fn(async () => row),
        create: vi.fn(async () => {
          throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
        }),
        update: vi.fn(async () => row),
      },
      brand: { findUnique: vi.fn(async () => ({ id: 'b1' })) },
      category: { findUnique: vi.fn(async () => ({ id: 'c1' })) },
      machineModel: { count: vi.fn(async () => 1) },
      crossReference: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
      productApplication: {
        deleteMany: vi.fn(async () => ({})),
        createMany: vi.fn(async () => ({})),
      },
      inventoryItem: { upsert: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    const search = { syncProducts: vi.fn(async () => undefined) };
    const svc = new AdminCatalogService(prisma as unknown as PrismaService, search as unknown as SearchService);
    return { svc, prisma, search };
  }
  const input = {
    slug: 'bosch-0001368088',
    partNumber: '0001368088',
    name: 'Стартер Bosch 24V',
    brandId: 'b1',
    categoryId: 'c1',
    kind: 'STARTER' as const,
    condition: 'REMANUFACTURED' as const,
    images: [],
    specs: [],
    crossReferences: [],
    applications: [],
    stock: 0,
  };

  it('зайнятий артикул → 409 із поясненням', async () => {
    const { svc, prisma } = setup();
    prisma.product.create.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['partNumber'] },
      });
    });
    await expect(svc.create(input)).rejects.toThrow(/артикулом/);
  });

  it('зайнятий slug → 409 із поясненням', async () => {
    await expect(setup().svc.create(input)).rejects.toBeInstanceOf(ConflictException);
  });

  it('нормалізована форма артикула рахується з нього, а не приймається ззовні', async () => {
    const { svc, prisma } = setup();
    await svc.update('p1', { partNumber: '0-001-368-099' });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { partNumber: '0-001-368-099', partNumberNorm: '0001368099' },
      }),
    );
  });

  it('невідома модель техніки → 400', async () => {
    const { svc, prisma } = setup();
    prisma.machineModel.count.mockResolvedValueOnce(0 as never);
    await expect(
      svc.update('p1', { applications: [{ machineModelId: 'nope' }] }),
    ).rejects.toThrow(/техніки/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('невідомий бренд → 400', async () => {
    const { svc, prisma } = setup();
    prisma.brand.findUnique.mockResolvedValueOnce(null as never);
    await expect(svc.update('p1', { brandId: 'nope' })).rejects.toThrow(/Бренд/);
  });

  it('зміна залишку синхронізує пошуковий індекс', async () => {
    const { svc, prisma, search } = setup();
    await svc.setStock('p1', 7);
    expect(prisma.inventoryItem.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { quantity: 7 } }));
    expect(search.syncProducts).toHaveBeenCalledWith(['p1']);
  });
});
