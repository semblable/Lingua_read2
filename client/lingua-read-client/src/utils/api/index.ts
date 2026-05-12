// Barrel re-export of every src/utils/api/* domain module.
// Existing call sites use `import { ... } from '../utils/api'` and resolve
// through this index — splitting api.js into per-domain files is invisible
// to consumers.

export * from './client';
export * from './auth';
export * from './languages';
export * from './texts';
export * from './books';
export * from './audiobook';
export * from './hardcover';
export * from './stats';
export * from './goals';
export * from './words';
export * from './srs';
export * from './translation';
export * from './folders';
export * from './settings';
export * from './admin';
