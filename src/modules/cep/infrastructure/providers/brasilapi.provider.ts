import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { AxiosError } from "axios";
import { z } from "zod";
import { CepProvider } from "../../domain/interfaces/cep-provider.interface";
import { CepResponse } from "../../presentation/schemas/cep-response.schema";
import { Env } from "../../../../shared/config/env.validation";

export const brasilApiResponseSchema = z.object({
  cep: z.string({
    required_error: "[BRASILAPI] Field 'cep' is required",
    invalid_type_error: "[BRASILAPI] Field 'cep' must be a string",
  }),
  state: z.string({
    required_error: "[BRASILAPI] Field 'state' is required",
    invalid_type_error: "[BRASILAPI] Field 'state' must be a string",
  }),
  city: z.string({
    required_error: "[BRASILAPI] Field 'city' is required",
    invalid_type_error: "[BRASILAPI] Field 'city' must be a string",
  }),
  neighborhood: z
    .string({
      invalid_type_error: "[BRASILAPI] Field 'neighborhood' must be a string",
    })
    .nullable()
    .optional()
    .default(""),
  street: z
    .string({
      invalid_type_error: "[BRASILAPI] Field 'street' must be a string",
    })
    .nullable()
    .optional()
    .default(""),
  service: z
    .string({
      invalid_type_error: "[BRASILAPI] Field 'service' must be a string",
    })
    .optional(),
});

export type BrasilApiResponse = z.infer<typeof brasilApiResponseSchema>;

@Injectable()
export class BrasilApiProvider implements CepProvider {
  readonly name = "BrasilAPI";

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async find(cep: string): Promise<CepResponse | null> {
    const baseUrl = this.configService.get("BRASILAPI_BASE_URL", {
      infer: true,
    });
    const timeoutMs = this.configService.get("CEP_PROVIDER_TIMEOUT_MS", {
      infer: true,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${baseUrl}/${cep}`, {
          timeout: timeoutMs,
        }),
      );

      const data = brasilApiResponseSchema.parse(response.data);

      return {
        cep: data.cep.replace("-", ""),
        street: data.street ?? "",
        complement: "",
        neighborhood: data.neighborhood ?? "",
        city: data.city,
        state: data.state,
        ibge: "",
      };
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 404) {
        return null;
      }

      throw error;
    }
  }
}
