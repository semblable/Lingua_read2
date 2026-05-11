#!/usr/bin/env node
/**
 * Generate TypeScript types from the backend's OpenAPI/Swagger spec.
 *
 * Usage:
 *   npm run api:types                      # default: http://localhost:5000/swagger/v1/swagger.json
 *   SWAGGER_URL=http://host:port/... npm run api:types
 *   SWAGGER_FILE=/path/to/swagger.json npm run api:types
 *
 * The output is written to src/utils/api-types.d.ts and should be committed.
 * Re-run whenever backend DTOs/endpoints change.
 *
 * If you don't have the API running, you can extract the spec offline with
 * the Swashbuckle CLI tool (see .config/dotnet-tools.json at repo root):
 *   dotnet build server/LinguaReadApi -c Debug
 *   ASPNETCORE_ENVIRONMENT=Testing dotnet swagger tofile \
 *     --output /tmp/swagger.json \
 *     server/LinguaReadApi/bin/Debug/net8.0/LinguaReadApi.dll v1
 *   SWAGGER_FILE=/tmp/swagger.json npm run api:types
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '..', 'src', 'utils', 'api-types.d.ts');

const DEFAULT_URL = 'http://localhost:5000/swagger/v1/swagger.json';

async function loadSpec() {
  const file = process.env.SWAGGER_FILE;
  if (file) {
    console.log(`Loading spec from file: ${file}`);
    const text = await readFile(file, 'utf8');
    return JSON.parse(text);
  }

  const url = process.env.SWAGGER_URL || DEFAULT_URL;
  console.log(`Fetching spec from: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${res.status} ${res.statusText}\n` +
        `Hint: start the backend (cd server/LinguaReadApi && dotnet run), ` +
        `or set SWAGGER_FILE=/path/to/spec.json for offline generation.`
    );
  }
  return await res.json();
}

const HEADER = `/**
 * AUTO-GENERATED. Do not edit by hand.
 *
 * Regenerate with: npm run api:types
 * Source: backend Swagger (Swashbuckle.AspNetCore) at /swagger/v1/swagger.json
 */
`;

async function main() {
  const spec = await loadSpec();
  const ast = await openapiTS(spec);
  const body = astToString(ast);

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, HEADER + body, 'utf8');

  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
