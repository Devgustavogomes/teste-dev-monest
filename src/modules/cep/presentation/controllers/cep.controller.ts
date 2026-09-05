import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToOpenAPI } from 'nestjs-zod';
import { BuscarCepUseCase } from '../../application/use-cases/buscar-cep.use-case';
import { CepResponse, CepResponseSchema } from '../schemas/cep-response.schema';
import { cepSchema } from '../schemas/cep-param.schema';
import { ZodValidationPipe } from '../../../../shared/pipes/zod-validation.pipe';

@ApiTags('cep')
@Controller('cep')
export class CepController {
  constructor(private readonly buscarCepUseCase: BuscarCepUseCase) {}

  @Get(':cep')
  @ApiOperation({
    summary: 'Look up a Brazilian ZIP code (CEP)',
    description:
      'Fetches address data for the given CEP from one of the configured providers ' +
      '(ViaCEP, BrasilAPI) using round-robin selection with automatic fallback. ' +
      'Accepts both hyphenated (01001-000) and non-hyphenated (01001000) formats.',
  })
  @ApiParam({
    name: 'cep',
    description:
      'Brazilian ZIP code — with or without hyphen (e.g. 01001000 or 01001-000)',
    example: '01001000',
    schema: { type: 'string', pattern: '^\\d{5}-?\\d{3}$' },
  })
  @ApiResponse({
    status: 200,
    description: 'CEP found — returns the unified address data.',
    schema: zodToOpenAPI(CepResponseSchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid CEP format — must contain 8 numeric digits.',
  })
  @ApiResponse({
    status: 404,
    description: 'CEP not found in any provider.',
  })
  @ApiResponse({
    status: 502,
    description: 'All CEP providers failed (timeout, network error, etc.).',
  })
  async findOne(
    @Param('cep', new ZodValidationPipe(cepSchema)) cep: string,
  ): Promise<CepResponse> {
    return this.buscarCepUseCase.execute(cep);
  }
}
