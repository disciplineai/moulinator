import { Matches } from 'class-validator';

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const COMMIT_SHA_REGEX = /^[a-f0-9]{40}$/;

export class CreateRunDto {
  @Matches(ULID_REGEX, { message: 'repo_id must be a ULID' })
  repo_id!: string;

  @Matches(COMMIT_SHA_REGEX, {
    message: 'commit_sha must be a 40-char lowercase hex SHA',
  })
  commit_sha!: string;
}
