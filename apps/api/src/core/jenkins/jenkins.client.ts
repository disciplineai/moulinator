import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface JenkinsTriggerParams {
  testRunId: string;
  workspaceUrl: string;
  testsRepoUrl: string;
  testsCommitSha: string;
  runnerImageRepo: string;
  runnerImageDigest: string;
  projectSlug: string;
  harnessEntrypoint: string;
  timeoutSeconds: number;
  memoryMb: number;
  cpus: number;
  pids: number;
  hermetic: boolean;
  egressAllowlistJson: string;
  logsUploadUrl: string;
  junitUploadUrl: string;
  webhookUrl: string;
}

export interface JenkinsTriggerResult {
  jenkinsBuildUrl: string;
}

/**
 * Thin Jenkins REST client. No PAT ever touches Jenkins — only the params
 * listed in JenkinsTriggerParams, which match the Jenkinsfile declarations.
 */
@Injectable()
export class JenkinsClient implements OnModuleInit {
  private readonly logger = new Logger(JenkinsClient.name);
  private baseUrl!: string;
  private user!: string;
  private token!: string;
  private jobName!: string;
  private crumb: { field: string; value: string } | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.baseUrl = this.config.getOrThrow<string>('JENKINS_URL').replace(/\/$/, '');
    this.user = this.config.getOrThrow<string>('JENKINS_USER');
    this.token = this.config.getOrThrow<string>('JENKINS_API_TOKEN');
    this.jobName = this.config.getOrThrow<string>('JENKINS_JOB_NAME');
  }

  async triggerBuild(p: JenkinsTriggerParams): Promise<JenkinsTriggerResult> {
    const params = new URLSearchParams();
    const fields: Record<string, string> = {
      test_run_id: p.testRunId,
      workspace_url: p.workspaceUrl,
      tests_repo_url: p.testsRepoUrl,
      tests_commit_sha: p.testsCommitSha,
      runner_image_repo: p.runnerImageRepo,
      runner_image_digest: p.runnerImageDigest,
      project_slug: p.projectSlug,
      harness_entrypoint: p.harnessEntrypoint,
      timeout_seconds: String(p.timeoutSeconds),
      memory_mb: String(p.memoryMb),
      cpus: String(p.cpus),
      pids: String(p.pids),
      hermetic: String(p.hermetic),
      egress_allowlist_json: p.egressAllowlistJson,
      logs_upload_url: p.logsUploadUrl,
      junit_upload_url: p.junitUploadUrl,
      webhook_url: p.webhookUrl,
    };
    for (const [k, v] of Object.entries(fields)) params.set(k, v);

    const url = `${this.baseUrl}/job/${encodeURIComponent(this.jobName)}/buildWithParameters`;
    const res = await this.post(url, params.toString(), {
      'content-type': 'application/x-www-form-urlencoded',
    });
    if (res.status < 200 || res.status >= 300) {
      // Never reflect the Jenkins response body — it may echo submitted
      // parameters (presigned MinIO URLs, etc). Log to our own logger instead.
      await safeText(res).then((b) =>
        this.logger.warn(`jenkins trigger status=${res.status} body_len=${b.length}`),
      );
      throw new Error(`jenkins_trigger_failed status=${res.status}`);
    }
    const location = res.headers.get('location');
    if (!location) {
      throw new Error('jenkins_trigger_no_location_header');
    }
    return { jenkinsBuildUrl: location };
  }

  async abortBuild(buildUrl: string): Promise<void> {
    // Accept either a queue item URL or a build URL; /stop is valid on both
    // for running builds. For queue items Jenkins exposes /cancelQueue.
    const normalized = buildUrl.replace(/\/$/, '');
    const isQueue = /\/queue\/item\/\d+$/.test(normalized);
    const url = isQueue
      ? `${normalized}/cancelQueue`
      : `${normalized}/stop`;
    const res = await this.post(url, '', {});
    if (res.status >= 400 && res.status !== 404) {
      await safeText(res).then((b) =>
        this.logger.warn(`jenkins abort status=${res.status} body_len=${b.length}`),
      );
      throw new Error(`jenkins_abort_failed status=${res.status}`);
    }
  }

  /** POST with basic auth + CSRF crumb. Crumb is cached per-process. */
  private async post(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    const crumb = await this.ensureCrumb();
    const authHeader =
      'Basic ' +
      Buffer.from(`${this.user}:${this.token}`, 'utf8').toString('base64');
    const finalHeaders: Record<string, string> = {
      ...headers,
      authorization: authHeader,
    };
    if (crumb) finalHeaders[crumb.field] = crumb.value;

    const res = await fetch(url, {
      method: 'POST',
      headers: finalHeaders,
      body: body.length > 0 ? body : undefined,
      redirect: 'manual',
    });
    // If crumb was stale, re-fetch once and retry.
    if (res.status === 403 && crumb) {
      this.crumb = null;
      const fresh = await this.ensureCrumb();
      if (fresh) finalHeaders[fresh.field] = fresh.value;
      return fetch(url, {
        method: 'POST',
        headers: finalHeaders,
        body: body.length > 0 ? body : undefined,
        redirect: 'manual',
      });
    }
    return res;
  }

  private async ensureCrumb(): Promise<
    { field: string; value: string } | null
  > {
    if (this.crumb) return this.crumb;
    const authHeader =
      'Basic ' +
      Buffer.from(`${this.user}:${this.token}`, 'utf8').toString('base64');
    try {
      const res = await fetch(`${this.baseUrl}/crumbIssuer/api/json`, {
        headers: { authorization: authHeader },
      });
      if (!res.ok) {
        // CSRF protection may be disabled on this controller — proceed
        // without a crumb.
        this.logger.debug(
          `crumb fetch not OK (${res.status}); continuing without crumb`,
        );
        return null;
      }
      const data = (await res.json()) as {
        crumbRequestField?: string;
        crumb?: string;
      };
      if (data.crumbRequestField && data.crumb) {
        this.crumb = { field: data.crumbRequestField, value: data.crumb };
        return this.crumb;
      }
    } catch (err) {
      this.logger.warn(
        `crumb issuer unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
