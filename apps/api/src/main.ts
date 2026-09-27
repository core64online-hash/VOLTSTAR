import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { initErrorReporting } from './common/observability/error-reporting';
import { metricsMiddleware } from './common/observability/metrics';
import { checkEnv, trustProxySetting } from './common/security/env-check';
import { securityHeaders } from './common/security/security-headers';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const prod = process.env.NODE_ENV === 'production';
  if (initErrorReporting()) logger.log('Звіти про помилки: Sentry увімкнено');
  const env = checkEnv(process.env);
  env.warnings.forEach((w) => logger.warn(w));
  if (env.errors.length) {
    env.errors.forEach((e) => logger.error(e));
    throw new Error(`Небезпечна конфігурація (${env.errors.length}) — API не запущено`);
  }

  // rawBody: потрібні сирі байти тіла для перевірки підписів платіжних вебхуків.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bodyParser: false });
  // Ліміт тіла запиту: JSON-API не приймає великих завантажень.
  app.useBodyParser('json', { limit: '256kb' });
  app.useBodyParser('urlencoded', { limit: '256kb', extended: true });
  // За балансувальником/CDN — щоб req.ip був адресою клієнта (для лімітів і журналу дій).
  app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));
  app.disable('x-powered-by');
  app.use(securityHeaders({ hsts: prod }));
  app.use(metricsMiddleware());

  const origins = (process.env.API_CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  // Content-Disposition — щоб web міг прочитати імʼя PDF-файлу при завантаженні документів.
  app.enableCors({ origin: origins, credentials: true, exposedHeaders: ['Content-Disposition', 'Retry-After'] });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Swagger у production — лише явно (SWAGGER_ENABLED=true), щоб не розкривати схему API.
  if (!prod || process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('VOLTSTAR API')
      .setDescription('API платформи продажу й відновлення стартерів і генераторів до техніки (B2C/B2B/B2G)')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  // SIGTERM від Docker/оркестратора: довершуємо поточні запити й закриваємо зʼєднання з БД.
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  logger.log(`VOLTSTAR API → http://localhost:${port}/api${!prod || process.env.SWAGGER_ENABLED === 'true' ? ' (docs: /docs)' : ''}`);
}

void bootstrap();
