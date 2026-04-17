import {
  Injectable,
  NestMiddleware,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import * as express from 'express';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Captures the raw request body on /webhooks/jenkins so
 * the webhook service can validate HMAC against the exact bytes.
 * Rejects malformed JSON with 422 at the boundary.
 */
@Injectable()
export class JenkinsRawBodyMiddleware implements NestMiddleware {
  private readonly parser = express.raw({
    type: 'application/json',
    limit: '1mb',
    verify: (req: RawBodyRequest, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  });

  use(req: Request, res: Response, next: NextFunction): void {
    this.parser(req, res, (err) => {
      if (err) return next(err);
      const rb = (req as RawBodyRequest).rawBody;
      if (!rb || rb.length === 0) {
        return next(
          new UnprocessableEntityException({
            error: 'empty_body',
            message: 'webhook body is empty',
          }),
        );
      }
      try {
        req.body = JSON.parse(rb.toString('utf8'));
      } catch {
        return next(
          new UnprocessableEntityException({
            error: 'invalid_json',
            message: 'webhook body is not valid JSON',
          }),
        );
      }
      next();
    });
  }
}
