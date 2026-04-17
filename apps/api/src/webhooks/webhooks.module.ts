import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { JenkinsWebhookController } from './jenkins.controller';
import { JenkinsRawBodyMiddleware } from './raw-body.middleware';

@Module({
  controllers: [JenkinsWebhookController],
})
export class WebhooksModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(JenkinsRawBodyMiddleware)
      .forRoutes({ path: 'webhooks/jenkins', method: RequestMethod.POST });
  }
}
