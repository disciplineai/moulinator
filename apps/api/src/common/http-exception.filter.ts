import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  error: string;
  message?: string;
  details?: Record<string, unknown>;
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  422: 'unprocessable_entity',
  429: 'rate_limited',
  500: 'internal_error',
  503: 'service_unavailable',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = this.toBody(exception, status);

    if (status >= 500) {
      this.logger.error(
        `[${req.method} ${req.url}] ${body.error}: ${body.message ?? ''}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.status(status).json(body);
  }

  private toBody(exception: unknown, status: number): ErrorBody {
    if (exception instanceof HttpException) {
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        return { error: DEFAULT_CODES[status] ?? 'error', message: raw };
      }
      const obj = raw as Record<string, unknown>;

      // class-validator / ValidationPipe throws BadRequestException with
      // { statusCode, message: string[], error: 'Bad Request' }. Detect that
      // shape (message is an array) and always remap to the contract shape —
      // never let the raw Nest payload leak through.
      if (Array.isArray(obj.message)) {
        return {
          error: status === 400 ? 'unprocessable_entity' : (DEFAULT_CODES[status] ?? 'error'),
          message: 'request validation failed',
          details: { errors: obj.message as string[] },
        };
      }

      // Payloads that already conform ({ error: 'machine_code', ... }) pass through.
      // Known Nest defaults like 'Bad Request' / 'Unauthorized' are remapped.
      const looksLikeNestDefault =
        typeof obj.error === 'string' &&
        /^[A-Z]/.test(obj.error) &&
        'statusCode' in obj;
      if (typeof obj.error === 'string' && !looksLikeNestDefault) {
        return obj as unknown as ErrorBody;
      }

      const message =
        typeof obj.message === 'string' ? obj.message : undefined;
      return {
        error: DEFAULT_CODES[status] ?? 'error',
        message,
      };
    }
    return { error: 'internal_error', message: 'unexpected server error' };
  }
}
