import 'reflect-metadata';
import { GithubClient, parseGithubUrl } from './github.client';

type RouteResponder = () => {
  status: number;
  body?: string | Buffer;
  headers?: Record<string, string>;
};

function installFetchStub(routes: Record<string, RouteResponder>) {
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  const original = global.fetch;
  const stub = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && !Array.isArray(h) && !(h instanceof Headers)) {
      for (const [k, v] of Object.entries(h))
        headers[k.toLowerCase()] = String(v);
    }
    calls.push({ method, url, headers });
    const key = `${method} ${url}`;
    const responder = routes[key];
    if (!responder) return new Response(`no stub for ${key}`, { status: 599 });
    const r = responder();
    const body =
      typeof r.body === 'string'
        ? r.body
        : r.body instanceof Buffer
          ? new Uint8Array(r.body)
          : '';
    return new Response(body, { status: r.status, headers: r.headers });
  };
  global.fetch = stub as unknown as typeof fetch;
  return { calls, restore: () => { global.fetch = original; } };
}

describe('parseGithubUrl', () => {
  it('parses https with and without .git', () => {
    expect(parseGithubUrl('https://github.com/acme/widget.git')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
    expect(parseGithubUrl('https://github.com/acme/widget')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('parses scp-style ssh', () => {
    expect(parseGithubUrl('git@github.com:acme/widget.git')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('parses ssh:// style', () => {
    expect(parseGithubUrl('ssh://git@github.com/acme/widget')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('rejects junk', () => {
    expect(() => parseGithubUrl('not a url')).toThrow();
  });
});

describe('GithubClient', () => {
  const client = new GithubClient();
  let stub: ReturnType<typeof installFetchStub>;

  afterEach(() => {
    stub?.restore();
  });

  it('validatePat returns scopes + login for a good token', async () => {
    stub = installFetchStub({
      'GET https://api.github.com/user': () => ({
        status: 200,
        body: JSON.stringify({ login: 'tester' }),
        headers: {
          'content-type': 'application/json',
          'x-oauth-scopes': 'repo, read:user',
        },
      }),
    });
    const res = await client.validatePat('ghp_good');
    expect(res.valid).toBe(true);
    expect(res.login).toBe('tester');
    expect(res.scopes).toEqual(['repo', 'read:user']);
    expect(stub.calls[0]?.headers['authorization']).toBe('token ghp_good');
  });

  it('validatePat rejects a 401 as pat_invalid', async () => {
    stub = installFetchStub({
      'GET https://api.github.com/user': () => ({
        status: 401,
        body: '{}',
      }),
    });
    const res = await client.validatePat('ghp_bad');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('pat_invalid');
  });

  it('getRepoMeta returns defaultBranch', async () => {
    stub = installFetchStub({
      'GET https://api.github.com/repos/acme/widget': () => ({
        status: 200,
        body: JSON.stringify({ default_branch: 'dev', private: false }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    const meta = await client.getRepoMeta(
      'ghp_good',
      'https://github.com/acme/widget',
    );
    expect(meta).toEqual({
      owner: 'acme',
      repo: 'widget',
      defaultBranch: 'dev',
      private: false,
    });
  });

  it('getRepoMeta surfaces 404 as repo_not_found_or_inaccessible', async () => {
    stub = installFetchStub({
      'GET https://api.github.com/repos/acme/missing': () => ({
        status: 404,
        body: '{}',
      }),
    });
    await expect(
      client.getRepoMeta('ghp_good', 'https://github.com/acme/missing'),
    ).rejects.toThrow(/repo_not_found/);
  });

  it('archiveCommit rejects non-hex commit sha', async () => {
    await expect(
      client.archiveCommit('t', 'https://github.com/a/b', 'not-a-sha'),
    ).rejects.toThrow(/commit_sha/);
  });

  it('archiveCommit fetches tarball body as Buffer', async () => {
    const sha = 'a'.repeat(40);
    const tarBody = Buffer.from('tarball-bytes');
    stub = installFetchStub({
      [`GET https://api.github.com/repos/acme/widget/tarball/${sha}`]: () => ({
        status: 200,
        body: tarBody,
        headers: { 'content-type': 'application/x-gzip' },
      }),
    });
    const res = await client.archiveCommit(
      'ghp_good',
      'https://github.com/acme/widget',
      sha,
    );
    expect(Buffer.isBuffer(res)).toBe(true);
    expect(res.toString('utf8')).toBe('tarball-bytes');
  });

  it('archiveCommit surfaces 404 to repo_or_commit_not_found', async () => {
    const sha = 'b'.repeat(40);
    stub = installFetchStub({
      [`GET https://api.github.com/repos/acme/widget/tarball/${sha}`]: () => ({
        status: 404,
        body: '',
      }),
    });
    await expect(
      client.archiveCommit('t', 'https://github.com/acme/widget', sha),
    ).rejects.toThrow(/not_found/);
  });

  it('archiveCommit strips Authorization on 302 redirect to codeload', async () => {
    const sha = 'd'.repeat(40);
    const tarBody = Buffer.from('codeload-bytes');
    const codeloadUrl = `https://codeload.github.com/acme/widget/tar.gz/${sha}`;
    stub = installFetchStub({
      [`GET https://api.github.com/repos/acme/widget/tarball/${sha}`]: () => ({
        status: 302,
        body: '',
        headers: { location: codeloadUrl },
      }),
      [`GET ${codeloadUrl}`]: () => ({
        status: 200,
        body: tarBody,
        headers: { 'content-type': 'application/x-gzip' },
      }),
    });
    const res = await client.archiveCommit(
      'ghp_secret_pat',
      'https://github.com/acme/widget',
      sha,
    );
    expect(res.toString('utf8')).toBe('codeload-bytes');
    // First call (API): Authorization MUST be present.
    const first = stub.calls.find((c) => c.url.includes('api.github.com'))!;
    expect(first.headers['authorization']).toBe('token ghp_secret_pat');
    // Second call (codeload): Authorization MUST NOT be present.
    const second = stub.calls.find((c) => c.url === codeloadUrl)!;
    expect(second.headers['authorization']).toBeUndefined();
  });

  it('archiveCommit throws when redirect has no Location header', async () => {
    const sha = 'e'.repeat(40);
    stub = installFetchStub({
      [`GET https://api.github.com/repos/acme/widget/tarball/${sha}`]: () => ({
        status: 302,
        body: '',
        headers: {},
      }),
    });
    await expect(
      client.archiveCommit('t', 'https://github.com/acme/widget', sha),
    ).rejects.toThrow(/archive_redirect_missing_location/);
  });

  it('archiveCommit accepts a Buffer token (F7 scope-down)', async () => {
    const sha = 'f'.repeat(40);
    stub = installFetchStub({
      [`GET https://api.github.com/repos/acme/widget/tarball/${sha}`]: () => ({
        status: 200,
        body: Buffer.from('ok'),
      }),
    });
    const res = await client.archiveCommit(
      Buffer.from('ghp_as_buffer', 'utf8'),
      'https://github.com/acme/widget',
      sha,
    );
    expect(res.toString('utf8')).toBe('ok');
    const call = stub.calls[0]!;
    expect(call.headers['authorization']).toBe('token ghp_as_buffer');
  });

  it('getBranchHead returns commit sha', async () => {
    const sha = 'c'.repeat(40);
    stub = installFetchStub({
      'GET https://api.github.com/repos/acme/tests/branches/main': () => ({
        status: 200,
        body: JSON.stringify({ commit: { sha } }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    const res = await client.getBranchHead({
      owner: 'acme',
      repo: 'tests',
      branch: 'main',
    });
    expect(res).toBe(sha);
  });
});
