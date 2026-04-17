import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { JenkinsClient, type JenkinsTriggerParams } from './jenkins.client';

const baseCfg = {
  JENKINS_URL: 'http://jenkins.test',
  JENKINS_USER: 'api',
  JENKINS_API_TOKEN: 'apitok',
  JENKINS_JOB_NAME: 'moulinator-run',
};

function make(): JenkinsClient {
  const cfg = new ConfigService(baseCfg);
  const c = new JenkinsClient(cfg as unknown as ConfigService);
  c.onModuleInit();
  return c;
}

const params: JenkinsTriggerParams = {
  testRunId: '01J000000000000000000000AA',
  workspaceUrl: 'http://minio/ws.tar.gz',
  testsRepoUrl: 'git@github.com:org/tests.git',
  testsCommitSha: 'a'.repeat(40),
  runnerImageRepo: 'ghcr.io/your-org/moulinator/runner-c',
  runnerImageDigest: 'sha256:' + 'c'.repeat(64),
  projectSlug: 'cpool-day06',
  harnessEntrypoint: 'tests/harness.sh',
  timeoutSeconds: 600,
  memoryMb: 2048,
  cpus: 2,
  pids: 512,
  hermetic: true,
  egressAllowlistJson: '[]',
  logsUploadUrl: 'http://minio/logs',
  junitUploadUrl: 'http://minio/junit',
  webhookUrl: 'http://api/webhooks/jenkins',
};

type RouteKey = `${string} ${string}`;
type RouteResponder = () => {
  status: number;
  body?: string;
  headers?: Record<string, string>;
};

function installFetchStub(routes: Record<RouteKey, RouteResponder>) {
  const calls: { method: string; url: string; body?: string; headers: Record<string, string> }[] =
    [];
  const original = global.fetch;
  const stub = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    const incomingHeaders = init?.headers;
    if (incomingHeaders) {
      if (Array.isArray(incomingHeaders)) {
        for (const pair of incomingHeaders as [string, unknown][]) {
          const k = pair[0];
          const v = pair[1];
          if (k) headers[k.toLowerCase()] = String(v);
        }
      } else if (incomingHeaders instanceof Headers) {
        incomingHeaders.forEach((v, k) => (headers[k.toLowerCase()] = v));
      } else {
        for (const [k, v] of Object.entries(incomingHeaders))
          headers[k.toLowerCase()] = String(v);
      }
    }
    const body =
      typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ method, url, body, headers });
    const key = `${method} ${url}` as RouteKey;
    const responder = routes[key];
    if (!responder) {
      return new Response(`no stub for ${key}`, { status: 599 });
    }
    const r = responder();
    return new Response(r.body ?? '', {
      status: r.status,
      headers: r.headers,
    });
  };
  global.fetch = stub as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

describe('JenkinsClient', () => {
  let stub: ReturnType<typeof installFetchStub>;

  afterEach(() => {
    stub?.restore();
  });

  it('fetches a CSRF crumb and POSTs buildWithParameters', async () => {
    stub = installFetchStub({
      'GET http://jenkins.test/crumbIssuer/api/json': () => ({
        status: 200,
        body: JSON.stringify({
          crumbRequestField: 'Jenkins-Crumb',
          crumb: 'deadbeef',
        }),
        headers: { 'content-type': 'application/json' },
      }),
      'POST http://jenkins.test/job/moulinator-run/buildWithParameters': () => ({
        status: 201,
        body: '',
        headers: { Location: 'http://jenkins.test/queue/item/42/' },
      }),
    });
    const client = make();
    const res = await client.triggerBuild(params);
    expect(res.jenkinsBuildUrl).toBe('http://jenkins.test/queue/item/42/');
    const post = stub.calls.find((c) => c.method === 'POST')!;
    expect(post.body).toContain(`test_run_id=${params.testRunId}`);
    expect(post.body).toContain('hermetic=true');
    expect(post.body).toContain(
      'runner_image_repo=ghcr.io%2Fyour-org%2Fmoulinator%2Frunner-c',
    );
    expect(post.body).toContain(
      `runner_image_digest=sha256%3A${'c'.repeat(64)}`,
    );
    expect(post.headers['authorization']).toMatch(/^Basic /);
    expect(post.headers['jenkins-crumb']).toBe('deadbeef');
  });

  it('continues without a crumb when crumb issuer is disabled', async () => {
    stub = installFetchStub({
      'GET http://jenkins.test/crumbIssuer/api/json': () => ({ status: 404 }),
      'POST http://jenkins.test/job/moulinator-run/buildWithParameters': () => ({
        status: 201,
        headers: { Location: 'http://jenkins.test/queue/item/7/' },
      }),
    });
    const client = make();
    const res = await client.triggerBuild(params);
    expect(res.jenkinsBuildUrl).toBe('http://jenkins.test/queue/item/7/');
  });

  it('throws on non-2xx trigger responses', async () => {
    stub = installFetchStub({
      'GET http://jenkins.test/crumbIssuer/api/json': () => ({ status: 404 }),
      'POST http://jenkins.test/job/moulinator-run/buildWithParameters': () => ({
        status: 500,
        body: 'server error',
      }),
    });
    const client = make();
    await expect(client.triggerBuild(params)).rejects.toThrow(
      /jenkins_trigger_failed/,
    );
  });

  it('aborts by POSTing /stop on a build URL', async () => {
    stub = installFetchStub({
      'GET http://jenkins.test/crumbIssuer/api/json': () => ({ status: 404 }),
      'POST http://jenkins.test/job/moulinator-run/42/stop': () => ({
        status: 200,
      }),
    });
    const client = make();
    await client.abortBuild('http://jenkins.test/job/moulinator-run/42/');
    expect(
      stub.calls.some(
        (c) => c.method === 'POST' && c.url.endsWith('/42/stop'),
      ),
    ).toBe(true);
  });

  it('tolerates 404 on abort (build already gone)', async () => {
    stub = installFetchStub({
      'GET http://jenkins.test/crumbIssuer/api/json': () => ({ status: 404 }),
      'POST http://jenkins.test/job/moulinator-run/42/stop': () => ({
        status: 404,
      }),
    });
    const client = make();
    await expect(
      client.abortBuild('http://jenkins.test/job/moulinator-run/42/'),
    ).resolves.toBeUndefined();
  });

  it('uses cancelQueue on a queue item URL', async () => {
    stub = installFetchStub({
      'GET http://jenkins.test/crumbIssuer/api/json': () => ({ status: 404 }),
      'POST http://jenkins.test/queue/item/12/cancelQueue': () => ({
        status: 200,
      }),
    });
    const client = make();
    await client.abortBuild('http://jenkins.test/queue/item/12');
    expect(
      stub.calls.some(
        (c) => c.method === 'POST' && c.url.endsWith('/cancelQueue'),
      ),
    ).toBe(true);
  });
});
