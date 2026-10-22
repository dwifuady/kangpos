import type { EnvVariable, RequestSpec, TemplateParam } from '../../types';

export interface ImportedTemplate {
  name: string;
  folder: string;
  request: RequestSpec;
}

export interface ImportedEnvironment {
  name: string;
  variables: EnvVariable[];
}

export type ImportKind = 'postman-collection' | 'postman-environment' | 'openapi';

export interface ImportResult {
  kind: ImportKind;
  name: string;
  templates: ImportedTemplate[];
  environments: ImportedEnvironment[];
  /** Things the importer could not carry over. Shown to the user. */
  warnings: string[];
}

/** Add a param unless one with the same name exists already. */
export function addParam(params: TemplateParam[], param: TemplateParam): void {
  const existing = params.find(p => p.name === param.name);
  if (existing) {
    existing.required = existing.required || param.required;
    if (!existing.default && param.default) existing.default = param.default;
    return;
  }
  params.push(param);
}

/** Keep each warning once, with a count when it repeats. */
export class WarningList {
  private counts = new Map<string, number>();

  add(message: string): void {
    this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
  }

  list(): string[] {
    return [...this.counts].map(([m, n]) => (n > 1 ? `${m} (${n}×)` : m));
  }
}
