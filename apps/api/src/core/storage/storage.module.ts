import { Module } from '@nestjs/common';
import { STORAGE_SERVICE } from '@moulinator/api-core-contracts';
import { StorageService } from './storage.service';

@Module({
  providers: [
    StorageService,
    { provide: STORAGE_SERVICE, useExisting: StorageService },
  ],
  exports: [StorageService, STORAGE_SERVICE],
})
export class StorageModule {}
