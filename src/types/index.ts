// Shared types. Shapes stored as JSON in SQLite (RequestSpec, EnvVariable[],
// ParamValues, StoredResponse) are owned by the frontend.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface BodyField extends KeyValue {
  kind: 'text' | 'file';
}

export type BodyType = 'none' | 'json' | 'text' | 'xml' | 'form-urlencoded' | 'multipart';

export interface RequestBody {
  type: BodyType;
  raw: string;
  fields: BodyField[];
}

export type AuthSpec =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' };

/** A value the user fills in per tab; referenced as {{name}}. */
/** How an input is filled in: free text, or picked from a list. */
export type InputType = 'text' | 'select';

export interface TemplateParam {
  name: string;
  default: string;
  required: boolean;
  description?: string;
  /** Defaults to 'text'. */
  type?: InputType;
  /** Choices for `type: 'select'`. */
  options?: string[];
}

export interface RequestSpec {
  method: HttpMethod;
  url: string;
  query: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: AuthSpec;
  params: TemplateParam[];
  /** JavaScript run before the request is sent and after the response arrives (Postman-style `pm` API). */
  scripts: RequestScripts;
}

export interface RequestScripts {
  before: string;
  after: string;
}

export type ParamValues = Record<string, string>;

export interface EnvVariable {
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}

export interface Space {
  id: string;
  name: string;
  color: string | null;
  active_environment_id: string | null;
  /** Folder the space's templates and environments are synced to, if linked. */
  sync_dir: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Environment {
  id: string;
  space_id: string;
  name: string;
  variables: EnvVariable[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  space_id: string;
  name: string;
  folder: string;
  request: RequestSpec;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** A folder in the Templates sidebar. Its own row keeps order and empty folders. */
export interface TemplateFolder {
  id: string;
  space_id: string;
  /** `"Contacts / Admin"` for nested folders. */
  path: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Folders plus templates, returned together after a sidebar change. */
export interface TemplateLayout {
  folders: TemplateFolder[];
  templates: Template[];
}

/** Where a dragged template ended up. */
export interface TemplateOrderInput {
  id: string;
  folder: string;
  sort_order: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: [string, string][];
  body: string | null;
  bodyBase64: string | null;
  contentType: string | null;
  sizeBytes: number;
  durationMs: number;
  truncated: boolean;
  finalUrl: string;
}

/** What a tab remembers about its last send. */
export interface StoredResponse {
  response?: HttpResponse;
  error?: string;
  sentAt: string;
  method: string;
  url: string;
  /** What the before/after scripts did on this send. */
  scripts?: { before?: ScriptRunInfo; after?: ScriptRunInfo };
}

export interface ScriptTest {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ScriptLog {
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
}

/** A pm.visualizer.set() template and the data it was given. */
export interface VisualizerOutput {
  template: string;
  data?: unknown;
}

/** The visible outcome of one script run. */
export interface ScriptRunInfo {
  tests: ScriptTest[];
  logs: ScriptLog[];
  visualizer?: VisualizerOutput;
  error?: string;
  durationMs: number;
}

export interface Tab {
  id: string;
  space_id: string;
  template_id: string | null;
  template_name: string | null;
  custom_title: string | null;
  request: RequestSpec;
  param_values: ParamValues;
  response: StoredResponse | null;
  is_pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  space_id: string;
  name: string;
  folder: string;
  request: RequestSpec;
}

export interface SendOptions {
  timeoutMs: number;
  followRedirects: boolean;
  verifyTls: boolean;
}

export type WireBody =
  | { type: 'none' }
  | { type: 'raw'; content: string }
  | { type: 'multipart'; fields: { name: string; value: string; kind: 'text' | 'file' }[] };

export interface SendRequestInput {
  requestId: string;
  method: string;
  url: string;
  headers: [string, string][];
  body: WireBody;
  options: SendOptions;
}

export function emptyRequest(): RequestSpec {
  return {
    method: 'GET',
    url: '',
    query: [],
    headers: [],
    body: { type: 'none', raw: '', fields: [] },
    auth: { type: 'none' },
    params: [],
    scripts: { before: '', after: '' },
  };
}

/**
 * Fill in any fields missing from a stored request (older rows, imports),
 * so the UI can rely on the full shape.
 */
export function normalizeRequest(input: Partial<RequestSpec> | null | undefined): RequestSpec {
  const base = emptyRequest();
  if (!input || typeof input !== 'object') return base;
  return {
    method: (input.method && HTTP_METHODS.includes(input.method) ? input.method : base.method),
    url: input.url ?? '',
    query: Array.isArray(input.query) ? input.query : [],
    headers: Array.isArray(input.headers) ? input.headers : [],
    body: {
      type: input.body?.type ?? 'none',
      raw: input.body?.raw ?? '',
      fields: Array.isArray(input.body?.fields) ? input.body!.fields : [],
    },
    auth: input.auth?.type ? input.auth : { type: 'none' },
    params: Array.isArray(input.params) ? input.params : [],
    scripts: {
      before: typeof input.scripts?.before === 'string' ? input.scripts.before : '',
      after: typeof input.scripts?.after === 'string' ? input.scripts.after : '',
    },
  };
}

export interface SyncFileError {
  /** Relative to the space folder, with forward slashes. */
  path: string;
  message: string;
}

export interface SyncStatus {
  space_id: string;
  dir: string;
  /** The linked folder no longer exists. */
  missing: boolean;
  errors: SyncFileError[];
}

/** Emitted by Rust when a linked folder changed on disk. */
export interface SyncEvent {
  space_id: string;
  /** Templates, environments or the space itself were updated from the folder. */
  changed: boolean;
  status: SyncStatus;
}
