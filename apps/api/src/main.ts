import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { StorageService } from './core/storage/storage.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.use(cookieParser());

  const webOrigin = process.env.WEB_ORIGIN;
  if (!webOrigin) {
    throw new Error(
      'WEB_ORIGIN is required (comma-separated list of allowed browser origins)',
    );
  }
  app.enableCors({
    origin: webOrigin.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableShutdownHooks();

  if (process.env.MOULINATOR_SKIP_BUCKET_BOOTSTRAP !== '1') {
    try {
      await app.get(StorageService).applyLifecyclePolicies();
    } catch (err) {
      logger.warn(
        `MinIO bootstrap skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`Moulinator API listening on :${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
