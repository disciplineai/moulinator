import { Module } from '@nestjs/common';
import { CRYPTO_SERVICE } from '@moulinator/api-core-contracts';
import { CryptoService } from './crypto.service';

@Module({
  providers: [
    CryptoService,
    { provide: CRYPTO_SERVICE, useExisting: CryptoService },
  ],
  exports: [CryptoService, CRYPTO_SERVICE],
})
export class CryptoModule {}
