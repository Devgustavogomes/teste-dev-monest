import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    environment: 'node',
    include: [
      'src/**/*.spec.ts',
      'src/**/*.test.ts',
      'test/**/*.spec.ts',
      'test/**/*.test.ts',
      'test/**/*.e2e-spec.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/main.ts',
        'src/**/*.module.ts',
        'src/**/*.dto.ts',
      ],
    },
  },
  plugins: [
    // SWC is required for NestJS decorators support (emitDecoratorMetadata)
    swc.vite(),
  ],
});
