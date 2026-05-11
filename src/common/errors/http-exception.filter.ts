import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

export type ProblemDetails = {
  type: string;
  title: string;
  code: string;
  status: number;
  details?: unknown;
  request_id?: string;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let code = 'INTERNAL_ERROR';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        title =
          (typeof obj.error === 'string' ? obj.error : exception.message) ??
          title;
        code =
          (typeof obj.code === 'string' ? obj.code : statusToCode(status)) ??
          code;
        details = obj.details ?? obj.message;
      } else {
        title = String(body);
        code = statusToCode(status);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.logger.error({
        msg: 'PrismaClientKnownRequestError',
        code: exception.code,
        meta: exception.meta,
        message: exception.message,
        stack: exception.stack,
      });
    } else if (exception instanceof Error) {
      this.logger.error(exception.stack ?? exception.message);
    }

    const headerId = request.headers['x-request-id'];
    const reqWithId = request as Request & { id?: string };
    const requestId =
      reqWithId.id ?? (typeof headerId === 'string' ? headerId : undefined);

    const problem: ProblemDetails = {
      type: 'about:blank',
      title,
      code,
      status,
      details,
      request_id: requestId,
    };

    response.status(status).type('application/problem+json').json(problem);
  }
}

function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}
