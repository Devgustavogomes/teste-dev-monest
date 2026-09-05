import { PipeTransform, Injectable } from "@nestjs/common";
import { ZodSchema } from "zod";
import { InvalidCepException } from "../errors/invalid-cep.exception";

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new InvalidCepException();
    }
    return result.data;
  }
}
