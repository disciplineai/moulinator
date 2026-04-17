import { Module } from '@nestjs/common';
import { GITHUB_CLIENT } from '@moulinator/api-core-contracts';
import { GithubClient } from './github.client';
import { TestsRepoResolver } from './tests-repo.resolver';

@Module({
  providers: [
    GithubClient,
    { provide: GITHUB_CLIENT, useExisting: GithubClient },
    TestsRepoResolver,
  ],
  exports: [GithubClient, GITHUB_CLIENT, TestsRepoResolver],
})
export class GithubModule {}
