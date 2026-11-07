import { ForbiddenException, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { requestContextAls } from '../request-context';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';

describe('server error correlation', () => {
  it('logs requestId and call frames without returning or logging secret error messages', () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      headersSent: false,
      destroyed: false,
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) };
    try {
      requestContextAls.run(
        {
          requestId: 'correlation-id',
          method: 'POST',
          path: '/api/example?token=sensitive-value',
        },
        () => {
          new HttpExceptionFilter().catch(new Error('password=sensitive-value'), host as never);
        },
      );
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        code: -1,
        data: null,
        error: 'Internal server error',
        message: 'Internal server error',
      });
      expect(logger).toHaveBeenCalledTimes(1);
      const log = String(logger.mock.calls[0][0]);
      expect(log).toContain('correlation-id');
      expect(log).toContain('http.server_error');
      expect(log).not.toContain('sensitive-value');
    } finally {
      logger.mockRestore();
    }
  });
  it('keeps ordinary authorization failures out of server error logs', () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      new HttpExceptionFilter().catch(new ForbiddenException(), {
        switchToHttp: () => ({ getResponse: () => response }),
      } as never);
      expect(logger).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });

  it.each([
    ['P2000', 400],
    ['P2002', 409],
    ['P2003', 409],
    ['P2025', 404],
    ['P2024', 503],
    ['P2034', 409],
    ['P9999', 500],
  ])('maps database error %s to %s without exposing database details', (code, status) => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const response = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      new HttpExceptionFilter().catch(
        new PrismaClientKnownRequestError('secret_database_value', {
          code: String(code),
          clientVersion: '7.10.1',
          meta: { target: ['private_column'] },
        }),
        { switchToHttp: () => ({ getResponse: () => response }) } as never,
      );
      expect(response.status).toHaveBeenCalledWith(status);
      expect(JSON.stringify(response.json.mock.calls)).not.toMatch(
        /secret_database_value|private_column/,
      );
      expect(JSON.stringify(logger.mock.calls)).not.toMatch(/secret_database_value|private_column/);
    } finally {
      logger.mockRestore();
    }
  });
});
