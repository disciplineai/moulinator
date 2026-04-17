import { Injectable, Logger } from '@nestjs/common';
import type {
  GithubPatValidation,
  GithubRepoMeta,
  IGithubClient,
} from '@moulinator/api-core-contracts';

const GITHUB_API = 'https://api.github.com';

/** Parsed owner/repo — works for https and ssh GitHub URLs. */
export function parseGithubUrl(url: string): { owner: string; repo: string } {
  const trimmed = url.trim();
  const https = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(
    trimmed,
  );
  if (https) return { owner: https[1]!, repo: https[2]! };
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  const sshFull = /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(
    trimmed,
  );
  if (sshFull) return { owner: sshFull[1]!, repo: sshFull[2]! };
  throw new Error(`unparseable github url: ${url}`);
}

function authHeader(token: string): Record<string, string> {
  return {
    authorization: `token ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'moulinator-api',
    'x-github-api-version': '2022-11-28',
  };
}

/**
 * Minimal GitHub REST client. Avoids @octokit/* (pure-ESM in v21+)
 * so we can run under Jest/ts-jest CommonJS without transform hacks.
 */
@Injectable()
export class GithubClient implements IGithubClient {
  private readonly logger = new Logger(GithubClient.name);

  async validatePat(token: string): Promise<GithubPatValidation> {
    if (!token || typeof token !== 'string') {
      return { valid: false, scopes: [], reason: 'empty token' };
    }
    try {
      const res = await fetch(`${GITHUB_API}/user`, {
        headers: authHeader(token),
      });
      if (res.status === 401) {
        return { valid: false, scopes: [], reason: 'pat_invalid' };
      }
      if (res.status === 403) {
        return { valid: false, scopes: [], reason: 'pat_forbidden' };
      }
      if (!res.ok) {
        return { valid: false, scopes: [], reason: `github_status_${res.status}` };
      }
      const scopesHeader = res.headers.get('x-oauth-scopes') ?? '';
      const scopes = scopesHeader
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const body = (await res.json()) as { login?: string } | null;
      return { valid: true, scopes, login: body?.login };
    } catch (err: unknown) {
      this.logger.warn(`validatePat network error: ${describeError(err)}`);
      return { valid: false, scopes: [], reason: 'pat_network_error' };
    }
  }

  async getRepoMeta(
    token: string,
    githubUrl: string,
  ): Promise<GithubRepoMeta> {
    const { owner, repo } = parseGithubUrl(githubUrl);
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      headers: authHeader(token),
    });
    if (res.status === 404) {
      throw new Error('repo_not_found_or_inaccessible');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('pat_cannot_access_repo');
    }
    if (!res.ok) {
      throw new Error(`repo_meta_failed_status_${res.status}`);
    }
    const data = (await res.json()) as {
      default_branch?: string;
      private?: boolean;
    };
    return {
      owner,
      repo,
      defaultBranch: data.default_branch ?? 'main',
      private: Boolean(data.private),
    };
  }

  /**
   * Fetch the commit tarball as a Buffer.
   * PAT is passed only via Authorization header; never logged; never written to disk.
   */
  async archiveCommit(
    token: string,
    githubUrl: string,
    commitSha: string,
  ): Promise<Buffer> {
    if (!/^[a-f0-9]{7,40}$/i.test(commitSha)) {
      throw new Error('commit_sha_must_be_hex');
    }
    const { owner, repo } = parseGithubUrl(githubUrl);
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/tarball/${commitSha}`,
      { headers: authHeader(token), redirect: 'follow' },
    );
    if (res.status === 404) throw new Error('repo_or_commit_not_found');
    if (res.status === 401 || res.status === 403) {
      throw new Error('pat_cannot_archive_commit');
    }
    if (!res.ok) {
      throw new Error(`archive_failed_status_${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  /** Used by TestsRepoResolver — returns the HEAD SHA of a branch. */
  async getBranchHead(params: {
    token?: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<string> {
    const { token, owner, repo, branch } = params;
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': 'moulinator-api',
      'x-github-api-version': '2022-11-28',
    };
    if (token) headers.authorization = `token ${token}`;
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
      { headers },
    );
    if (res.status === 404) throw new Error('tests_repo_branch_missing');
    if (res.status === 401 || res.status === 403) {
      throw new Error('tests_repo_inaccessible');
    }
    if (!res.ok) {
      throw new Error(`tests_repo_branch_status_${res.status}`);
    }
    const data = (await res.json()) as { commit?: { sha?: string } } | null;
    const sha = data?.commit?.sha;
    if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) {
      throw new Error('tests_repo_head_invalid_sha');
    }
    return sha;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
