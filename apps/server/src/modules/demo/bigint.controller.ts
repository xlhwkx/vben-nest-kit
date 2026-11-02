import { Controller, Get, Header, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { Response } from 'express';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';

/**
 * Demo oversized JSON integers (playground json-bigint).
 * Raw body keeps digit literals past Number.MAX_SAFE_INTEGER — Nest JSON.stringify would lose them.
 * Auth: Bearer (default guard), same as backend-mock.
 * Envelope fields match Nest contract (code/data/error/message); @SkipEnvelope so we do not double-wrap.
 */
const BIGINT_DEMO_BODY = `{
  "code": 0,
  "message": "ok",
  "error": null,
  "data": [
    {
      "id": 123456789012345678901234567890123456789012345678901234567890,
      "name": "John Doe",
      "age": 30,
      "email": "john-doe@demo.com"
    },
    {
      "id": 987654321098765432109876543210987654321098765432109876543210,
      "name": "Jane Smith",
      "age": 25,
      "email": "jane@demo.com"
    }
  ]
}`;

@Controller({ path: 'demo', version: [VERSION_NEUTRAL, '1'] })
export class BigintController {
  @Get('bigint')
  @SkipEnvelope()
  @Header('Content-Type', 'application/json; charset=utf-8')
  bigint(@Res() res: Response): void {
    res.status(200).type('application/json').send(BIGINT_DEMO_BODY);
  }
}
