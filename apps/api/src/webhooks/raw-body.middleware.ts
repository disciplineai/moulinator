import {
  Injectable,
  NestMiddleware,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Captures the raw request body on /webhooks/jenkins so
 * the webhook service can validate HMAC against the exact bytes.
 * Reads the stream directly to avoid conflicts with any body-parser middleware.
 */
@Injectable()
export class JenkinsRawBodyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('error', (err) => next(err));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (raw.length === 0) {
        return next(
          new UnprocessableEntityException({
            error: 'empty_body',
            message: 'webhook body is empty',
          }),
        );
      }
      (req as RawBodyRequest).rawBody = raw;
      try {
        req.body = JSON.parse(raw.toString('utf8'));
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
