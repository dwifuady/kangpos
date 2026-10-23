// Tauri commands callable from the frontend.

use crate::http::{self, HttpResponse, HttpState, SendRequestInput};
use crate::storage::{
    CreateTabInput, CreateTemplateInput, DatabaseManager, Environment, Space, StorageError, Tab,
    Template, TemplateFolder, TemplateOrderInput, UpdateEnvironmentInput, UpdateSpaceInput,
    UpdateTabInput, UpdateTemplateInput,
};
use crate::sync::{self, SyncError, SyncManager, SyncStatus};
use serde_json::Value;
use std::path::Path;
use std::sync::Arc;
use tauri::State;

/// Import files above this size are rejected.
const MAX_IMPORT_BYTES: u64 = 20 * 1024 * 1024;

pub struct AppState {
    pub db: Arc<DatabaseManager>,
    pub http: Arc<HttpState>,
    pub sync: Arc<SyncManager>,
}

/// Typed IPC error, serialized as `{ code, message }` for the frontend.
#[derive(Debug, serde::Serialize)]
#[serde(tag = "code", content = "message")]
pub enum ApiError {
    Storage(String),
    Validation(String),
    Http(String),
    NotFound(String),
    /// Saved in the app, but the space's folder could not be updated.
    Sync(String),
}

impl From<StorageError> for ApiError {
    fn from(err: StorageError) -> Self {
        match err {
            StorageError::NotFound(what) => ApiError::NotFound(what),
            StorageError::Validation(msg) => ApiError::Validation(msg),
            other => ApiError::Storage(other.to_string()),
        }
    }
}

impl From<SyncError> for ApiError {
    fn from(err: SyncError) -> Self {
        match err {
            SyncError::Invalid(msg) => ApiError::Validation(msg),
            SyncError::Storage(e) => e.into(),
            other => ApiError::Sync(other.to_string()),
        }
    }
}

type ApiResult<T> = Result<T, ApiError>;

/// Folder rows plus templates after a sidebar change, so the UI refreshes both at once.
#[derive(Debug, serde::Serialize)]
pub struct TemplateLayout {
    pub folders: Vec<TemplateFolder>,
    pub templates: Vec<Template>,
}

fn template_layout(db: &DatabaseManager, space_id: &str) -> ApiResult<TemplateLayout> {
    Ok(TemplateLayout {
        folders: db.list_template_folders(space_id)?,
        templates: db.list_templates(space_id)?,
    })
}

/// Report a folder write failure without losing the database change.
fn file_error(e: SyncError) -> ApiError {
    ApiError::Sync(format!(
        "Saved, but the workspace folder could not be updated: {e}"
    ))
}

// ---- Spaces ----

#[tauri::command]
pub async fn list_spaces(state: State<'_, AppState>) -> ApiResult<Vec<Space>> {
    Ok(state.db.list_spaces()?)
}

#[tauri::command]
pub async fn create_space(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> ApiResult<Space> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ApiError::Validation("Space name is required".into()));
    }
    Ok(state.db.create_space(name, color.as_deref())?)
}

#[tauri::command]
pub async fn update_space(
    state: State<'_, AppState>,
    id: String,
    input: UpdateSpaceInput,
) -> ApiResult<Space> {
    state.sync.exclusive(|| {
        let shared = input.name.is_some() || input.color.is_some();
        let space = state.db.update_space(&id, input)?;
        if let (true, Some(dir)) = (shared, &space.sync_dir) {
            sync::write_workspace_file(Path::new(dir), &space).map_err(file_error)?;
        }
        Ok(space)
    })
}

#[tauri::command]
pub async fn delete_space(state: State<'_, AppState>, id: String) -> ApiResult<()> {
    state.sync.stop(&id);
    Ok(state.db.delete_space(&id)?)
}

// ---- Folder sync ----

/// Link a space to a folder: writes its templates and environments there and watches it.
#[tauri::command]
pub async fn link_space_folder(
    state: State<'_, AppState>,
    space_id: String,
    path: String,
) -> ApiResult<Space> {
    let space = state
        .sync
        .exclusive(|| sync::link(&state.db, &space_id, &path))?;
    state.sync.start(&space_id)?;
    Ok(space)
}

/// Stop syncing. The space keeps everything; the folder is left as it is.
#[tauri::command]
pub async fn unlink_space_folder(state: State<'_, AppState>, space_id: String) -> ApiResult<Space> {
    state.sync.stop(&space_id);
    Ok(state
        .sync
        .exclusive(|| sync::unlink(&state.db, &space_id))?)
}

/// Add a folder that already holds a KangPos workspace (e.g. a git clone) as a new space.
#[tauri::command]
pub async fn open_workspace_folder(state: State<'_, AppState>, path: String) -> ApiResult<Space> {
    let (space, _) = state
        .sync
        .exclusive(|| sync::open_workspace(&state.db, &path))?;
    state.sync.start(&space.id)?;
    Ok(space)
}

#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, AppState>,
    space_id: String,
) -> ApiResult<Option<SyncStatus>> {
    Ok(state.sync.status(&space_id))
}

/// Re-read the folder now (e.g. after fixing a broken file, or when it was missing).
#[tauri::command]
pub async fn reload_space_folder(
    state: State<'_, AppState>,
    space_id: String,
) -> ApiResult<SyncStatus> {
    Ok(state.sync.start(&space_id)?)
}

// ---- Environments ----

#[tauri::command]
pub async fn list_environments(
    state: State<'_, AppState>,
    space_id: String,
) -> ApiResult<Vec<Environment>> {
    Ok(state.db.list_environments(&space_id)?)
}

#[tauri::command]
pub async fn create_environment(
    state: State<'_, AppState>,
    space_id: String,
    name: String,
    variables: Value,
) -> ApiResult<Environment> {
    state.sync.exclusive(|| {
        let env = state.db.create_environment(&space_id, &name, &variables)?;
        sync::write_environment(&state.db, &env.id).map_err(file_error)?;
        Ok(env)
    })
}

#[tauri::command]
pub async fn update_environment(
    state: State<'_, AppState>,
    id: String,
    input: UpdateEnvironmentInput,
) -> ApiResult<Environment> {
    state.sync.exclusive(|| {
        let env = state.db.update_environment(&id, input)?;
        sync::write_environment(&state.db, &env.id).map_err(file_error)?;
        Ok(env)
    })
}

#[tauri::command]
pub async fn delete_environment(state: State<'_, AppState>, id: String) -> ApiResult<()> {
    state.sync.exclusive(|| {
        sync::remove_environment(&state.db, &id).map_err(file_error)?;
        Ok(state.db.delete_environment(&id)?)
    })
}

// ---- Templates ----

#[tauri::command]
pub async fn list_templates(
    state: State<'_, AppState>,
    space_id: String,
) -> ApiResult<Vec<Template>> {
    Ok(state.db.list_templates(&space_id)?)
}

#[tauri::command]
pub async fn create_templates(
    state: State<'_, AppState>,
    inputs: Vec<CreateTemplateInput>,
) -> ApiResult<Vec<Template>> {
    state.sync.exclusive(|| {
        let created = state.db.create_templates(inputs)?;
        for tpl in &created {
            sync::write_template(&state.db, &tpl.id).map_err(file_error)?;
        }
        Ok(created)
    })
}

#[tauri::command]
pub async fn update_template(
    state: State<'_, AppState>,
    id: String,
    input: UpdateTemplateInput,
) -> ApiResult<Template> {
    state.sync.exclusive(|| {
        let tpl = state.db.update_template(&id, input)?;
        sync::write_template(&state.db, &tpl.id).map_err(file_error)?;
        Ok(tpl)
    })
}

#[tauri::command]
pub async fn delete_template(state: State<'_, AppState>, id: String) -> ApiResult<()> {
    state.sync.exclusive(|| {
        sync::remove_template(&state.db, &id).map_err(file_error)?;
        Ok(state.db.delete_template(&id)?)
    })
}

// ---- Template folders ----

#[tauri::command]
pub async fn list_template_folders(
    state: State<'_, AppState>,
    space_id: String,
) -> ApiResult<Vec<TemplateFolder>> {
    Ok(state.db.list_template_folders(&space_id)?)
}

#[tauri::command]
pub async fn create_template_folder(
    state: State<'_, AppState>,
    space_id: String,
    path: String,
) -> ApiResult<TemplateLayout> {
    state.sync.exclusive(|| {
        let folder = state.db.create_template_folder(&space_id, &path)?;
        sync::ensure_folder_dir(&state.db, &space_id, &folder.path).map_err(file_error)?;
        template_layout(&state.db, &space_id)
    })
}

#[tauri::command]
pub async fn rename_template_folder(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> ApiResult<TemplateLayout> {
    state.sync.exclusive(|| {
        let rename = state.db.rename_template_folder(&id, &path)?;
        for template_id in &rename.moved_template_ids {
            sync::write_template(&state.db, template_id).map_err(file_error)?;
        }
        let space_id = rename.folder.space_id.clone();
        sync::ensure_folder_dir(&state.db, &space_id, &rename.folder.path).map_err(file_error)?;
        sync::remove_folder_dir(&state.db, &space_id, &rename.old_path).map_err(file_error)?;
        template_layout(&state.db, &space_id)
    })
}

#[tauri::command]
pub async fn delete_template_folder(
    state: State<'_, AppState>,
    id: String,
) -> ApiResult<TemplateLayout> {
    state.sync.exclusive(|| {
        let folder = state.db.delete_template_folder(&id)?;
        sync::remove_folder_dir(&state.db, &folder.space_id, &folder.path).map_err(file_error)?;
        template_layout(&state.db, &folder.space_id)
    })
}

/// New folder order in the sidebar, top to bottom.
#[tauri::command]
pub async fn arrange_template_folders(
    state: State<'_, AppState>,
    space_id: String,
    paths: Vec<String>,
) -> ApiResult<TemplateLayout> {
    state.sync.exclusive(|| {
        state.db.arrange_template_folders(&space_id, &paths)?;
        template_layout(&state.db, &space_id)
    })
}

/// Drag result for templates: their new folder and position.
#[tauri::command]
pub async fn arrange_templates(
    state: State<'_, AppState>,
    space_id: String,
    items: Vec<TemplateOrderInput>,
) -> ApiResult<TemplateLayout> {
    state.sync.exclusive(|| {
        let moved = state.db.arrange_templates(&space_id, &items)?;
        for id in &moved {
            sync::write_template(&state.db, id).map_err(file_error)?;
        }
        template_layout(&state.db, &space_id)
    })
}

// ---- Tabs ----

#[tauri::command]
pub async fn list_tabs(state: State<'_, AppState>, space_id: String) -> ApiResult<Vec<Tab>> {
    Ok(state.db.list_tabs(&space_id)?)
}

#[tauri::command]
pub async fn create_tab(state: State<'_, AppState>, input: CreateTabInput) -> ApiResult<Tab> {
    Ok(state.db.create_tab(input)?)
}

#[tauri::command]
pub async fn update_tab(
    state: State<'_, AppState>,
    id: String,
    input: UpdateTabInput,
) -> ApiResult<Tab> {
    Ok(state.db.update_tab(&id, input)?)
}

#[tauri::command]
pub async fn delete_tab(state: State<'_, AppState>, id: String) -> ApiResult<()> {
    Ok(state.db.delete_tab(&id)?)
}

/// New sidebar order of tabs, top to bottom, pinned ones included.
#[tauri::command]
pub async fn reorder_tabs(
    state: State<'_, AppState>,
    space_id: String,
    ids: Vec<String>,
) -> ApiResult<()> {
    Ok(state.db.reorder_tabs(&space_id, &ids)?)
}

// ---- App state ----

#[tauri::command]
pub async fn get_app_state(
    state: State<'_, AppState>,
) -> ApiResult<serde_json::Map<String, Value>> {
    Ok(state.db.get_app_state()?)
}

#[tauri::command]
pub async fn set_app_state(state: State<'_, AppState>, key: String, value: Value) -> ApiResult<()> {
    Ok(state.db.set_app_state(&key, &value)?)
}

// ---- HTTP ----

#[tauri::command]
pub async fn send_request(
    state: State<'_, AppState>,
    input: SendRequestInput,
) -> ApiResult<HttpResponse> {
    let http = Arc::clone(&state.http);
    http::send(&http, input).await.map_err(ApiError::Http)
}

#[tauri::command]
pub async fn cancel_request(state: State<'_, AppState>, request_id: String) -> ApiResult<bool> {
    Ok(state.http.cancel(&request_id))
}

// ---- Import ----

/// Read a Postman / OpenAPI file picked in the open dialog.
#[tauri::command]
pub async fn read_import_file(path: String) -> ApiResult<String> {
    let path = std::path::PathBuf::from(path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if !matches!(ext.as_str(), "json" | "yaml" | "yml") {
        return Err(ApiError::Validation(
            "Expected a .json, .yaml or .yml file".into(),
        ));
    }
    let meta = std::fs::metadata(&path)
        .map_err(|e| ApiError::Validation(format!("Cannot read file: {e}")))?;
    if !meta.is_file() {
        return Err(ApiError::Validation("Not a regular file".into()));
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(ApiError::Validation("File is larger than 20 MB".into()));
    }
    std::fs::read_to_string(&path)
        .map_err(|e| ApiError::Validation(format!("Cannot read file: {e}")))
}

// ---- Save response ----

/// Write a response body (base64) to a path chosen in the save dialog.
#[tauri::command]
pub async fn save_response_file(path: String, base64: String) -> ApiResult<()> {
    use base64::Engine;
    let path = std::path::PathBuf::from(path.trim());
    if path.as_os_str().is_empty() || path.file_name().is_none() {
        return Err(ApiError::Validation("Choose a file name".into()));
    }
    let lower = path.to_string_lossy().to_lowercase();
    for forbidden in [r"c:\windows", r"c:\program files"] {
        if lower.starts_with(forbidden) {
            return Err(ApiError::Validation(
                "Cannot write to a system folder".into(),
            ));
        }
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| ApiError::Validation(format!("Invalid response data: {e}")))?;
    std::fs::write(&path, bytes).map_err(|e| ApiError::Storage(format!("Cannot save file: {e}")))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn saves_base64_bytes_and_rejects_bad_input() {
        let dir = std::env::temp_dir().join(format!("kangpos-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("receipt.pdf");
        save_response_file(file.to_string_lossy().into_owned(), "JVBERi0xLjMK".into())
            .await
            .unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"%PDF-1.3\n");

        assert!(matches!(
            save_response_file(file.to_string_lossy().into_owned(), "not base64!".into()).await,
            Err(ApiError::Validation(_))
        ));
        assert!(matches!(
            save_response_file(r"C:\Windows\x.pdf".into(), "JVBERi0xLjMK".into()).await,
            Err(ApiError::Validation(_))
        ));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
