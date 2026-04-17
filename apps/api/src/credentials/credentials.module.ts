import { Global, Module } from '@nestjs/common';
import { CREDENTIALS_SERVICE } from '@moulinator/api-core-contracts';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';

@Global()
@Module({
  controllers: [CredentialsController],
  providers: [
    CredentialsService,
    { provide: CREDENTIALS_SERVICE, useExisting: CredentialsService },
  ],
  exports: [CredentialsService, CREDENTIALS_SERVICE],
})
export class CredentialsModule {}
