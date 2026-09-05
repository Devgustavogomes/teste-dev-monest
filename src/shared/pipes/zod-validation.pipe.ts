import { PipeTransform, Injectable } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { InvalidCepException } from '../errors/invalid-cep.exception';

@Injectable()
export class ZodValidationPipe<T = any> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new InvalidCepException();
    }
    return result.data;
  }
}
