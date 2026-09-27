-- Розворот на стартери й генератори до техніки.
--
-- Каталог генераторних установок не мігрує в новий домен: у товару стартера немає ні палива,
-- ні фазності, а артикул і крос-номери взятися нізвідки. Тому наявні товари видаляються разом
-- із залежними записами — на момент міграції в каталозі був один демонстраційний рядок.
-- Наповнення нового каталогу — імпортом (`catalog:import`), див. docs/RUNBOOK.md.
DELETE FROM "CartItem";
DELETE FROM "ProductSpec";
DELETE FROM "InventoryItem";
DELETE FROM "Price";
DELETE FROM "Product" WHERE NOT EXISTS (
  SELECT 1 FROM "OrderItem" WHERE "OrderItem"."productId" = "Product"."id"
);

-- CreateEnum
CREATE TYPE "PartKind" AS ENUM ('STARTER', 'ALTERNATOR', 'COMPONENT', 'REPAIR_KIT');

-- CreateEnum
CREATE TYPE "PartCondition" AS ENUM ('NEW', 'REMANUFACTURED', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "Rotation" AS ENUM ('CW', 'CCW');

-- CreateEnum
CREATE TYPE "MachineSegment" AS ENUM ('TRUCK', 'CONSTRUCTION', 'AGRICULTURAL', 'MILITARY');

-- DropIndex
DROP INDEX "Product_ratedPowerW_idx";

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "partNumberSnapshot" TEXT;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "fuel",
DROP COLUMN "maxPowerW",
DROP COLUMN "phase",
DROP COLUMN "ratedPowerW",
ADD COLUMN     "amperageA" INTEGER,
ADD COLUMN     "condition" "PartCondition" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "coreDepositMinor" INTEGER,
ADD COLUMN     "kind" "PartKind",
ADD COLUMN     "partNumber" TEXT,
ADD COLUMN     "partNumberNorm" TEXT,
ADD COLUMN     "powerKw" DECIMAL(5,2),
ADD COLUMN     "rotation" "Rotation",
ADD COLUMN     "teeth" INTEGER,
ADD COLUMN     "voltage" INTEGER;

-- Товари, на які посилаються оформлені замовлення, лишаються заради історії. Артикула в них
-- немає — беремо адресу сторінки, а тип позначаємо як вузол: що це було насправді, знає лише
-- стара картка. Нові поля стають обовʼязковими вже після цього заповнення.
UPDATE "Product"
SET "partNumber" = "slug",
    "partNumberNorm" = UPPER(REGEXP_REPLACE("slug", '[^a-zA-Z0-9]', '', 'g')),
    "kind" = 'COMPONENT'
WHERE "partNumber" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "kind" SET NOT NULL,
  ALTER COLUMN "partNumber" SET NOT NULL,
  ALTER COLUMN "partNumberNorm" SET NOT NULL;

-- DropTable
DROP TABLE "EquipmentPreset";

-- DropTable
DROP TABLE "SelectorRun";

-- DropEnum
DROP TYPE "FuelType";

-- DropEnum
DROP TYPE "PhaseType";

-- CreateTable
CREATE TABLE "CrossReference" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "numberNorm" TEXT NOT NULL,

    CONSTRAINT "CrossReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineBrand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "MachineBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineModel" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "segment" "MachineSegment" NOT NULL,

    CONSTRAINT "MachineModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductApplication" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "machineModelId" TEXT NOT NULL,
    "engine" TEXT,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "note" TEXT,

    CONSTRAINT "ProductApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrossReference_numberNorm_idx" ON "CrossReference"("numberNorm");

-- CreateIndex
CREATE UNIQUE INDEX "CrossReference_productId_brand_numberNorm_key" ON "CrossReference"("productId", "brand", "numberNorm");

-- CreateIndex
CREATE UNIQUE INDEX "MachineBrand_name_key" ON "MachineBrand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MachineBrand_slug_key" ON "MachineBrand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MachineModel_slug_key" ON "MachineModel"("slug");

-- CreateIndex
CREATE INDEX "MachineModel_segment_idx" ON "MachineModel"("segment");

-- CreateIndex
CREATE UNIQUE INDEX "MachineModel_brandId_name_key" ON "MachineModel"("brandId", "name");

-- CreateIndex
CREATE INDEX "ProductApplication_machineModelId_idx" ON "ProductApplication"("machineModelId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductApplication_productId_machineModelId_engine_key" ON "ProductApplication"("productId", "machineModelId", "engine");

-- CreateIndex
CREATE UNIQUE INDEX "Product_partNumber_key" ON "Product"("partNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Product_partNumberNorm_key" ON "Product"("partNumberNorm");

-- CreateIndex
CREATE INDEX "Product_kind_condition_idx" ON "Product"("kind", "condition");

-- CreateIndex
CREATE INDEX "Product_partNumberNorm_idx" ON "Product"("partNumberNorm");

-- AddForeignKey
ALTER TABLE "CrossReference" ADD CONSTRAINT "CrossReference_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineModel" ADD CONSTRAINT "MachineModel_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "MachineBrand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductApplication" ADD CONSTRAINT "ProductApplication_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductApplication" ADD CONSTRAINT "ProductApplication_machineModelId_fkey" FOREIGN KEY ("machineModelId") REFERENCES "MachineModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

