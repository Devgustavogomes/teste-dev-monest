import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

/**
 * HealthController — simple application health check endpoint.
 *
 * Returns { status: 'ok' } with HTTP 200 when the application is running.
 * Intentionally minimal — no dependencies, no business logic.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  /**
   * GET /health
   *
   * Returns the current health status of the application.
   */
  @Get()
  @ApiOperation({
    summary: 'Application health check',
    description: 'Returns { status: "ok" } with HTTP 200 if the application is running.',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
      },
      required: ['status'],
    },
  })
  check(): { status: string } {
    return { status: 'ok' };
  }
}
