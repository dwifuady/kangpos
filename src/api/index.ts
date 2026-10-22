// Typed wrappers around the Tauri commands in src-tauri/src/commands.rs.

import { invokeSafe } from './client';
import {
  normalizeRequest,
  type CreateTemplateInput,
  type Environment,
  type EnvVariable,
  type HttpResponse,
  type ParamValues,
  type RequestSpec,
  type SendRequestInput,
  type Space,
  type StoredResponse,
  type SyncStatus,
  type Tab,
  type Template,
} from '../types';

export { ApiErrorException } from './client';

// Rows come back with JSON columns parsed by Rust; normalise the request shape.
const toTemplate = (t: Template): Template => ({ ...t, request: normalizeRequest(t.request) });
const toTab = (t: Tab): Tab => ({
  ...t,
  request: normalizeRequest(t.request),
  param_values: t.param_values && typeof t.param_values === 'object' ? t.param_values : {},
});
const toEnvironment = (e: Environment): Environment => ({
  ...e,
  variables: Array.isArray(e.variables) ? e.variables : [],
});

// ---- Spaces ----

export const listSpaces = () => invokeSafe<Space[]>('list_spaces');

export const createSpace = (name: string, color: string | null) =>
  invokeSafe<Space>('create_space', { name, color });

export const updateSpace = (
  id: string,
  input: { name?: string; color?: string; active_environment_id?: string | null },
) => invokeSafe<Space>('update_space', { id, input });

export const deleteSpace = (id: string) => invokeSafe<void>('delete_space', { id });

// ---- Environments ----

export const listEnvironments = async (spaceId: string) =>
  (await invokeSafe<Environment[]>('list_environments', { spaceId })).map(toEnvironment);

export const createEnvironment = async (spaceId: string, name: string, variables: EnvVariable[]) =>
  toEnvironment(await invokeSafe<Environment>('create_environment', { spaceId, name, variables }));

export const updateEnvironment = async (id: string, input: { name?: string; variables?: EnvVariable[] }) =>
  toEnvironment(await invokeSafe<Environment>('update_environment', { id, input }));

export const deleteEnvironment = (id: string) => invokeSafe<void>('delete_environment', { id });

// ---- Templates ----

export const listTemplates = async (spaceId: string) =>
  (await invokeSafe<Template[]>('list_templates', { spaceId })).map(toTemplate);

export const createTemplates = async (inputs: CreateTemplateInput[]) =>
  (await invokeSafe<Template[]>('create_templates', { inputs })).map(toTemplate);

export const updateTemplate = async (
  id: string,
  input: { name?: string; folder?: string; request?: RequestSpec },
) => toTemplate(await invokeSafe<Template>('update_template', { id, input }));

export const deleteTemplate = (id: string) => invokeSafe<void>('delete_template', { id });

// ---- Tabs ----

export const listTabs = async (spaceId: string) =>
  (await invokeSafe<Tab[]>('list_tabs', { spaceId })).map(toTab);

export const createTab = async (input: {
  space_id: string;
  template_id: string | null;
  template_name: string | null;
  request: RequestSpec;
  param_values: ParamValues;
}) => toTab(await invokeSafe<Tab>('create_tab', { input }));

export interface UpdateTabInput {
  template_id?: string | null;
  template_name?: string | null;
  custom_title?: string | null;
  request?: RequestSpec;
  param_values?: ParamValues;
  response?: StoredResponse | null;
  is_pinned?: boolean;
}

export const updateTab = async (id: string, input: UpdateTabInput) =>
  toTab(await invokeSafe<Tab>('update_tab', { id, input }));

export const deleteTab = (id: string) => invokeSafe<void>('delete_tab', { id });

// ---- App state ----

export const getAppState = () => invokeSafe<Record<string, unknown>>('get_app_state');

export const setAppState = (key: string, value: unknown) =>
  invokeSafe<void>('set_app_state', { key, value });

// ---- HTTP ----

export const sendRequest = (input: SendRequestInput) => invokeSafe<HttpResponse>('send_request', { input });

export const cancelRequest = (requestId: string) => invokeSafe<boolean>('cancel_request', { requestId });

// ---- Import ----

export const readImportFile = (path: string) => invokeSafe<string>('read_import_file', { path });

export const saveResponseFile = (path: string, base64: string) =>
  invokeSafe<void>('save_response_file', { path, base64 });

// ---- Folder sync ----

export const linkSpaceFolder = (spaceId: string, path: string) =>
  invokeSafe<Space>('link_space_folder', { spaceId, path });

export const unlinkSpaceFolder = (spaceId: string) => invokeSafe<Space>('unlink_space_folder', { spaceId });

export const openWorkspaceFolder = (path: string) => invokeSafe<Space>('open_workspace_folder', { path });

export const getSyncStatus = (spaceId: string) => invokeSafe<SyncStatus | null>('get_sync_status', { spaceId });

export const reloadSpaceFolder = (spaceId: string) => invokeSafe<SyncStatus>('reload_space_folder', { spaceId });
