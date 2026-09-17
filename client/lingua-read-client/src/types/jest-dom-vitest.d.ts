// Vitest 5 changed `Assertion<T>` to `Assertion<R, T>`, and custom matchers now hang
// off `Matchers<R, T>`. @testing-library/jest-dom (<= 7.0.1) still augments the old
// single-parameter `Assertion<T>`, which no longer merges, so every jest-dom matcher
// (toBeInTheDocument, toHaveAttribute, ...) vanishes from the expect() types.
// Re-attach them via `Matchers`, which `Assertion` and `AsymmetricMatchersContaining`
// both extend. Delete this file once jest-dom ships a fix:
// https://github.com/testing-library/jest-dom/issues/738
import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Matchers<R, T> extends TestingLibraryMatchers<any, R> {}
}
