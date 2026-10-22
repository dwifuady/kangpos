// Detect what a file is and hand it to the matching importer.

import { parse as parseYaml } from 'yaml';
import { importOpenApi, isOpenApi } from './openapi';
import {
  importPostmanCollection,
  importPostmanEnvironment,
  isPostmanCollection,
  isPostmanEnvironment,
} from './postman';
import type { ImportResult } from './types';

export type { ImportResult, ImportedEnvironment, ImportedTemplate } from './types';

export function parseDocument(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  return parseYaml(trimmed);
}

export function importDocument(text: string): ImportResult {
  let doc: unknown;
  try {
    doc = parseDocument(text);
  } catch (e) {
    throw new Error(`Not valid JSON or YAML: ${(e as Error).message}`, { cause: e });
  }
  if (isOpenApi(doc)) return importOpenApi(doc);
  if (isPostmanCollection(doc)) return importPostmanCollection(doc);
  if (isPostmanEnvironment(doc)) return importPostmanEnvironment(doc);
  throw new Error('Unrecognised file. Expected a Postman collection, Postman environment, or OpenAPI / Swagger spec.');
}
