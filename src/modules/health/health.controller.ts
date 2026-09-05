import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Application health check',
    description:
      'Returns { status: "ok" } with HTTP 200 if the application is running.',
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
