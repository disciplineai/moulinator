import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GithubClient, parseGithubUrl } from './github.client';

/**
 * Resolves the tests-repo HEAD SHA at trigger time.
 * Uses TESTS_REPO_HTTPS_URL + optional TESTS_REPO_READ_TOKEN to call the
 * GitHub REST API from the control plane. Never uses a student PAT, never
 * touches the Jenkins deploy key (that lives on the runner plane only).
 */
@Injectable()
export class TestsRepoResolver {
  private readonly logger = new Logger(TestsRepoResolver.name);

  constructor(
    private readonly config: ConfigService,
    private readonly github: GithubClient,
  ) {}

  async resolveHead(): Promise<string> {
    const httpsUrl =
      this.config.get<string>('TESTS_REPO_HTTPS_URL') ??
      this.deriveHttpsFromSsh();
    if (!httpsUrl) {
      throw new Error('tests_repo_https_url_missing');
    }
    const { owner, repo } = parseGithubUrl(httpsUrl);
    const branch =
      this.config.get<string>('TESTS_REPO_DEFAULT_BRANCH') ?? 'main';
    const token = this.config.get<string>('TESTS_REPO_READ_TOKEN');
    return this.github.getBranchHead({ token, owner, repo, branch });
  }

  private deriveHttpsFromSsh(): string | undefined {
    const ssh = this.config.get<string>('TESTS_REPO_URL');
    if (!ssh) return undefined;
    // git@github.com:org/repo.git → https://github.com/org/repo
    const m = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(ssh);
    if (!m) return undefined;
    return `https://github.com/${m[1]}/${m[2]}`;
  }
}
