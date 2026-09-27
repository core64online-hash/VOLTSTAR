import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter';
import { ErrorReportingInterceptor } from './common/observability/error-reporting';
import { RateLimitGuard } from './common/security/rate-limit';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { CartModule } from './modules/cart/cart.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CrmModule } from './modules/crm/crm.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    HealthModule,
    // Bounded contexts (скелети — наповнюються по фазах ROADMAP.md)
    CatalogModule,
    PricingModule,
    AccountsModule,
    CartModule,
    PaymentsModule,
    OrdersModule,
    CrmModule,
    NotificationsModule,
    AdminModule,
  ],
  // Глобально: помилки валідації zod → 400 (а не 500).
  providers: [
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
    // Глобально: ліміти частоти запитів (загальний + точкові на вхід, заявки, оформлення).
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Глобально: збої (5xx) — у Sentry, якщо задано SENTRY_DSN.
    { provide: APP_INTERCEPTOR, useClass: ErrorReportingInterceptor },
  ],
})
export class AppModule {}
