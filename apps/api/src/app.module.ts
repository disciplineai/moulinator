import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CredentialsModule } from './credentials/credentials.module';
import { ProjectsModule } from './projects/projects.module';
import { ReposModule } from './repos/repos.module';
import { RunsModule } from './runs/runs.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { ContributionsModule } from './contributions/contributions.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { CoreModule } from './core/core.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CoreModule,
    AuthModule,
    UsersModule,
    CredentialsModule,
    ProjectsModule,
    ReposModule,
    RunsModule,
    ArtifactsModule,
    ContributionsModule,
    WebhooksModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
