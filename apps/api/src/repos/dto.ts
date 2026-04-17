import {
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export class CreateRepoDto {
  @IsString()
  @Matches(ULID_REGEX, { message: 'project_id must be a ULID' })
  project_id!: string;

  @IsUrl({ require_protocol: true, protocols: ['https'] })
  github_url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  default_branch?: string;
}
