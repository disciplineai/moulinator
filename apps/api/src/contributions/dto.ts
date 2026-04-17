import { IsIn, IsOptional, IsString, IsUrl, Matches } from 'class-validator';

const CONTRIBUTION_STATUSES = ['open', 'merged', 'rejected'] as const;

export class ListContributionsQuery {
  @IsOptional()
  @IsIn(CONTRIBUTION_STATUSES as unknown as string[])
  status?: (typeof CONTRIBUTION_STATUSES)[number];
}

export class CreateContributionDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/, {
    message: 'project_slug must be kebab-case, lowercase',
  })
  project_slug!: string;

  @IsUrl({ require_protocol: true, protocols: ['https'] })
  github_pr_url!: string;
}
