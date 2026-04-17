import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  IStorageService,
  PresignOptions,
  PresignedUrl,
} from '@moulinator/api-core-contracts';

const DEFAULT_TTL_SECONDS = 300;
const DAY = 24 * 60 * 60;

interface BucketSpec {
  name: string;
  expiryDays: number;
}

@Injectable()
export class StorageService implements IStorageService, OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  /** Control-plane client (internal endpoint) for PUT/DELETE/HEAD. */
  private internal!: S3Client;
  /** Public-endpoint client used only for presign so runners can resolve URLs. */
  private presigner!: S3Client;
  private specs: BucketSpec[] = [];

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const region = this.config.get<string>('MINIO_REGION') ?? 'us-east-1';
    const accessKeyId = this.config.getOrThrow<string>('MINIO_ACCESS_KEY');
    const secretAccessKey = this.config.getOrThrow<string>('MINIO_SECRET_KEY');
    const endpoint = this.config.getOrThrow<string>('MINIO_ENDPOINT');
    const publicEndpoint =
      this.config.get<string>('MINIO_PUBLIC_ENDPOINT') ?? endpoint;

    const common: S3ClientConfig = {
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    };
    this.internal = new S3Client({ ...common, endpoint });
    this.presigner = new S3Client({ ...common, endpoint: publicEndpoint });

    this.specs = [
      {
        name:
          this.config.get<string>('MINIO_BUCKET_WORKSPACES') ?? 'workspaces',
        expiryDays: 1,
      },
      {
        name: this.config.get<string>('MINIO_BUCKET_LOGS') ?? 'logs',
        expiryDays: 30,
      },
      {
        name: this.config.get<string>('MINIO_BUCKET_JUNIT') ?? 'junit',
        expiryDays: 30,
      },
    ];
  }

  /** Idempotent: ensures each bucket exists and has the documented lifecycle. */
  async applyLifecyclePolicies(): Promise<void> {
    for (const spec of this.specs) {
      await this.ensureBucket(spec.name);
      await this.internal.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: spec.name,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: `moulinator-${spec.name}-expiry`,
                Status: 'Enabled',
                Filter: { Prefix: '' },
                Expiration: { Days: spec.expiryDays },
              },
            ],
          },
        }),
      );
      this.logger.log(
        `Applied ${spec.expiryDays}d lifecycle on bucket ${spec.name}`,
      );
    }
  }

  async presignGet(opts: PresignOptions): Promise<PresignedUrl> {
    const ttl = opts.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
    const url = await getSignedUrl(
      this.presigner,
      new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key }),
      { expiresIn: ttl },
    );
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async presignPut(opts: PresignOptions): Promise<PresignedUrl> {
    const ttl = opts.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
    const url = await getSignedUrl(
      this.presigner,
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: opts.key,
        ContentType: opts.contentType,
      }),
      { expiresIn: ttl },
    );
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.internal.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  }

  /**
   * Internal helper used by the orchestrator to upload workspace tarballs.
   * Not part of IStorageService — this is a control-plane-only path.
   */
  async putObject(params: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<{ sizeBytes: number }> {
    await this.internal.send(
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );
    return { sizeBytes: params.body.byteLength };
  }

  bucketNames(): { workspaces: string; logs: string; junit: string } {
    const [w, l, j] = this.specs;
    return {
      workspaces: w!.name,
      logs: l!.name,
      junit: j!.name,
    };
  }

  private async ensureBucket(name: string): Promise<void> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: name }));
      return;
    } catch {
      // fall-through to create
    }
    try {
      await this.internal.send(new CreateBucketCommand({ Bucket: name }));
      this.logger.log(`Created bucket ${name}`);
    } catch (err: unknown) {
      // Tolerate a concurrent creator.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/i.test(msg)) {
        throw err;
      }
    }
    void DAY; // retained for future TTL conversion if exp in seconds is needed
  }
}
