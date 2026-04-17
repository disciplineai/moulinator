import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  GoneException,
  Headers,
  HttpStatus,
  Inject,
  Ip,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  JENKINS_WEBHOOK_SERVICE,
  type IJenkinsWebhookService,
  type JenkinsWebhookEventName,
  type JenkinsWebhookPayload,
} from '@moulinator/api-core-contracts';
import { Public } from '../auth/public.decorator';
import type { RawBodyRequest } from './raw-body.middleware';

const VALID_EVENTS: ReadonlySet<JenkinsWebhookEventName> = new Set([
  'build_started',
  'heartbeat',
  'build_completed',
  'build_errored',
]);

const SIGNATURE_REGEX = /^sha256=[a-f0-9]{64}$/i;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('webhooks/jenkins')
@Public()
export class JenkinsWebhookController {
  constructor(
    @Inject(JENKINS_WEBHOOK_SERVICE)
    private readonly service: IJenkinsWebhookService,
  ) {}

  @Post()
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  async handle(
    @Req() req: RawBodyRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-moulinator-signature') signature: string | undefined,
    @Headers('x-moulinator-idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-moulinator-event') event: string | undefined,
    @Ip() ip: string,
    @Body() body: JenkinsWebhookPayload,
  ): Promise<{ status: string }> {
    if (!signature || !idempotencyKey || !event) {
      throw new BadRequestException({
        error: 'missing_webhook_headers',
        message: 'signature, idempotency key, and event headers are required',
      });
    }
    if (!SIGNATURE_REGEX.test(signature)) {
      throw new UnauthorizedException({ error: 'invalid_signature_format' });
    }
    if (!UUID_REGEX.test(idempotencyKey)) {
      throw new UnprocessableEntityException({
        error: 'invalid_idempotency_key',
        message: 'X-Moulinator-Idempotency-Key must be a UUID v4',
      });
    }
    if (!VALID_EVENTS.has(event as JenkinsWebhookEventName)) {
      throw new UnprocessableEntityException({
        error: 'unknown_event',
        message: `unsupported event: ${event}`,
      });
    }
    // Middleware rejected empty/invalid JSON already, but keep a defensive check.
    const raw = req.rawBody ?? Buffer.alloc(0);
    if (raw.length === 0) {
      throw new UnprocessableEntityException({ error: 'empty_body' });
    }

    const result = await this.service.handle(
      event as JenkinsWebhookEventName,
      raw,
      body,
      {
        signature,
        idempotencyKey,
        event: event as JenkinsWebhookEventName,
        ip,
      },
    );

    switch (result.status) {
      case 'processed':
        res.status(HttpStatus.OK);
        return { status: 'processed' };
      case 'queued':
        res.status(HttpStatus.ACCEPTED);
        return { status: 'queued' };
      case 'duplicate':
        throw new ConflictException({
          error: 'duplicate_idempotency_key',
          message: 'webhook already processed',
        });
      case 'not_found':
        throw new NotFoundException({ error: 'test_run_not_found' });
      case 'terminal':
        throw new GoneException({
          error: 'run_terminal',
          message: 'run has already reached a terminal state',
        });
      case 'invalid_signature':
        throw new UnauthorizedException({ error: 'invalid_signature' });
      case 'invalid_payload':
        throw new UnprocessableEntityException({
          error: 'invalid_payload',
          message: result.detail ?? 'payload does not match event schema',
        });
      default:
        throw new UnprocessableEntityException({ error: 'webhook_unknown_result' });
    }
  }
}
