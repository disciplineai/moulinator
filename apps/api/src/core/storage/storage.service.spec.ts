import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async () => 'https://example.test/presigned'),
}));

const baseConfig = {
  MINIO_REGION: 'us-east-1',
  MINIO_ACCESS_KEY: 'access',
  MINIO_SECRET_KEY: 'secret',
  MINIO_ENDPOINT: 'http://minio:9000',
  MINIO_PUBLIC_ENDPOINT: 'http://localhost:9000',
  MINIO_BUCKET_WORKSPACES: 'workspaces',
  MINIO_BUCKET_LOGS: 'logs',
  MINIO_BUCKET_JUNIT: 'junit',
};

function makeService(): StorageService {
  const cfg = new ConfigService(baseConfig);
  const svc = new StorageService(cfg as unknown as ConfigService);
  svc.onModuleInit();
  return svc;
}

describe('StorageService', () => {
  beforeEach(() => {
    jest.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('round-trips presignGet with an expiry', async () => {
    const svc = makeService();
    const res = await svc.presignGet({
      bucket: 'workspaces',
      key: 'w/1.tar.gz',
      expiresInSeconds: 120,
    });
    expect(res.url).toBe('https://example.test/presigned');
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('issues presign PUT URLs with contentType', async () => {
    const svc = makeService();
    const res = await svc.presignPut({
      bucket: 'workspaces',
      key: 'w/1.tar.gz',
      contentType: 'application/gzip',
    });
    expect(res.url).toBe('https://example.test/presigned');
  });

  it('calls PutObjectCommand in putObject', async () => {
    const svc = makeService();
    const sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(async () => ({}));
    const res = await svc.putObject({
      bucket: 'workspaces',
      key: 'k',
      body: Buffer.from('hello'),
    });
    expect(res.sizeBytes).toBe(5);
    const call = sendSpy.mock.calls[0]?.[0];
    expect(call).toBeInstanceOf(PutObjectCommand);
  });

  it('calls DeleteObjectCommand in delete', async () => {
    const svc = makeService();
    const sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(async () => ({}));
    await svc.delete('logs', 'log/1');
    const call = sendSpy.mock.calls[0]?.[0];
    expect(call).toBeInstanceOf(DeleteObjectCommand);
  });

  it('creates missing buckets and applies lifecycle', async () => {
    const svc = makeService();
    const sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(async (cmd: unknown) => {
        if (cmd instanceof HeadBucketCommand) {
          throw new Error('bucket missing');
        }
        return {};
      });
    await svc.applyLifecyclePolicies();
    const classes = sendSpy.mock.calls.map((c) => c[0]?.constructor.name);
    expect(classes).toEqual(
      expect.arrayContaining([
        'HeadBucketCommand',
        'CreateBucketCommand',
        'PutBucketLifecycleConfigurationCommand',
      ]),
    );
    // 3 buckets × (Head + Create + Lifecycle) = 9 calls
    expect(sendSpy).toHaveBeenCalledTimes(9);
  });

  it('skips create when bucket exists', async () => {
    const svc = makeService();
    const sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(async (cmd: unknown) => {
        if (cmd instanceof CreateBucketCommand) {
          throw new Error('should not be called');
        }
        return {};
      });
    await svc.applyLifecyclePolicies();
    const classes = sendSpy.mock.calls.map((c) => c[0]?.constructor.name);
    expect(classes).toEqual(
      expect.arrayContaining([
        'HeadBucketCommand',
        'PutBucketLifecycleConfigurationCommand',
      ]),
    );
    expect(
      classes.filter((c) => c === 'CreateBucketCommand'),
    ).toHaveLength(0);
  });

  it('exposes bucket names', () => {
    const svc = makeService();
    expect(svc.bucketNames()).toEqual({
      workspaces: 'workspaces',
      logs: 'logs',
      junit: 'junit',
    });
  });
});
