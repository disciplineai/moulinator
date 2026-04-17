import { Module } from '@nestjs/common';
import { JenkinsClient } from './jenkins.client';

@Module({
  providers: [JenkinsClient],
  exports: [JenkinsClient],
})
export class JenkinsModule {}
