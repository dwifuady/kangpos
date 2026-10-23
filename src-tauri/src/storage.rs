// Local SQLite persistence: spaces, environments, templates, tabs and app state.
//
// Request definitions (`request`), environment variables, tab param values and
// the last response are stored as JSON text. The frontend owns their shape, so
// it can evolve without SQLite migrations.

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Failed to get app data directory")]
    AppDataDir,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
}

pub type StorageResult<T> = Result<T, StorageError>;

/// Stored responses keep at most this many body characters.
const MAX_STORED_BODY: usize = 2 * 1024 * 1024;

pub fn get_default_db_path() -> StorageResult<PathBuf> {
    let dirs = directories::ProjectDirs::from("com", "kangpos", "KangPos")
        .ok_or(StorageError::AppDataDir)?;
    Ok(dirs.data_dir().join("kangpos.db"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Space {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub active_environment_id: Option<String>,
    /// Folder this space's templates and environments are synced to, if linked.
    pub sync_dir: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub id: String,
    pub space_id: String,
    pub name: String,
    pub variables: Value,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub space_id: String,
    pub name: String,
    pub folder: String,
    pub request: Value,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// A folder in the template sidebar. Templates only store the folder path, so the
/// folder itself is a row here to keep its order (and empty folders) around.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateFolder {
    pub id: String,
    pub space_id: String,
    pub path: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// New place of one template after a drag.
#[derive(Debug, Deserialize)]
pub struct TemplateOrderInput {
    pub id: String,
    #[serde(default)]
    pub folder: String,
    pub sort_order: i64,
}

/// What a folder rename changed, so the linked folder on disk can follow.
#[derive(Debug)]
pub struct TemplateFolderRename {
    pub folder: TemplateFolder,
    pub old_path: String,
    pub moved_template_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tab {
    pub id: String,
    pub space_id: String,
    pub template_id: Option<String>,
    pub template_name: Option<String>,
    pub custom_title: Option<String>,
    pub request: Value,
    pub param_values: Value,
    pub response: Option<Value>,
    pub is_pinned: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSpaceInput {
    pub name: Option<String>,
    pub color: Option<String>,
    /// `Some(None)` clears the active environment.
    #[serde(default, with = "double_option")]
    pub active_environment_id: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEnvironmentInput {
    pub name: Option<String>,
    pub variables: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTemplateInput {
    pub space_id: String,
    pub name: String,
    #[serde(default)]
    pub folder: String,
    pub request: Value,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTemplateInput {
    pub name: Option<String>,
    pub folder: Option<String>,
    pub request: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTabInput {
    pub space_id: String,
    pub template_id: Option<String>,
    pub template_name: Option<String>,
    pub request: Value,
    pub param_values: Value,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTabInput {
    #[serde(default, with = "double_option")]
    pub template_id: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub template_name: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub custom_title: Option<Option<String>>,
    pub request: Option<Value>,
    pub param_values: Option<Value>,
    #[serde(default, with = "double_option")]
    pub response: Option<Option<Value>>,
    pub is_pinned: Option<bool>,
}

/// Distinguishes a missing field (`None`) from an explicit `null` (`Some(None)`).
mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
    where
        T: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        Option::<T>::deserialize(d).map(Some)
    }
}

pub struct DatabaseManager {
    connection: Mutex<Connection>,
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Canonical folder path: levels trimmed and joined with " / ", e.g. `Contacts / Admin`.
/// Backslashes count as separators so hand-typed and imported paths line up.
pub fn normalize_folder_path(path: &str) -> String {
    path.replace('\\', "/")
        .split('/')
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .collect::<Vec<_>>()
        .join(" / ")
}

/// Parent path (`A` for `A / B`), empty for a top-level folder.
fn folder_parent(path: &str) -> String {
    let mut parts: Vec<&str> = path.split(" / ").filter(|s| !s.is_empty()).collect();
    parts.pop();
    parts.join(" / ")
}

/// Make sure a folder row exists for a path templates were placed in, plus its parents
/// (`A` for `A / B`), so the tree stays consistent.
fn ensure_folder_row(conn: &Connection, space_id: &str, path: &str) -> StorageResult<()> {
    let parts: Vec<&str> = path.split(" / ").filter(|s| !s.is_empty()).collect();
    for i in 1..=parts.len() {
        let current = parts[..i].join(" / ");
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM template_folders WHERE space_id = ?1 AND path = ?2",
                params![space_id, current],
                |r| r.get(0),
            )
            .optional()?;
        if exists.is_some() {
            continue;
        }
        let next: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM template_folders WHERE space_id = ?1",
            [space_id],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT INTO template_folders (id, space_id, path, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![new_id(), space_id, current, next],
        )?;
    }
    Ok(())
}

fn parse_json(text: String) -> Value {
    serde_json::from_str(&text).unwrap_or(Value::Null)
}

/// Cut an oversized response body so one big download doesn't bloat the database.
/// `stored` is the frontend's StoredResponse (`{ response: { body, bodyBase64, .. }, .. }`);
/// a cut body is flagged with `truncated: true` at the top level.
fn trim_response(mut stored: Value) -> Value {
    let mut cut_any = false;
    if let Some(inner) = stored.get_mut("response") {
        for field in ["body", "bodyBase64"] {
            if let Some(Value::String(body)) = inner.get_mut(field) {
                if body.len() > MAX_STORED_BODY {
                    let mut cut = MAX_STORED_BODY;
                    while !body.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    body.truncate(cut);
                    cut_any = true;
                }
            }
        }
    }
    if cut_any {
        stored["truncated"] = Value::Bool(true);
    }
    stored
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    sql_type: &str,
) -> StorageResult<()> {
    let exists = conn
        .prepare(&format!(
            "SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"
        ))?
        .exists([column])?;
    if !exists {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {sql_type}"
        ))?;
    }
    Ok(())
}

impl DatabaseManager {
    pub fn new(db_path: PathBuf) -> StorageResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Self::from_connection(Connection::open(&db_path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> StorageResult<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> StorageResult<Self> {
        connection.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
        "#,
        )?;
        let manager = Self {
            connection: Mutex::new(connection),
        };
        manager.init_schema()?;
        Ok(manager)
    }

    fn init_schema(&self) -> StorageResult<()> {
        let conn = self.connection.lock();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS spaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                active_environment_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS environments (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                name TEXT NOT NULL,
                variables TEXT NOT NULL DEFAULT '[]',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS templates (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                name TEXT NOT NULL,
                folder TEXT NOT NULL DEFAULT '',
                request TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
            );

            -- template_id is not a foreign key on purpose: a tab is a snapshot and
            -- keeps working after its template is deleted.
            CREATE TABLE IF NOT EXISTS tabs (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                template_id TEXT,
                template_name TEXT,
                custom_title TEXT,
                request TEXT NOT NULL,
                param_values TEXT NOT NULL DEFAULT '{}',
                response TEXT,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
            );

            -- Folders are paths on templates; this table only owns their order.
            CREATE TABLE IF NOT EXISTS template_folders (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                path TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_environments_space ON environments(space_id);
            CREATE INDEX IF NOT EXISTS idx_templates_space ON templates(space_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_template_folders_path ON template_folders(space_id, path);
            CREATE INDEX IF NOT EXISTS idx_tabs_space ON tabs(space_id);
        "#,
        )?;
        // Columns added after the first release.
        add_column_if_missing(&conn, "spaces", "sync_dir", "TEXT")?;
        add_column_if_missing(&conn, "templates", "file_path", "TEXT")?;
        add_column_if_missing(&conn, "environments", "file_path", "TEXT")?;
        Ok(())
    }

    /// Direct connection access for the folder sync module.
    pub(crate) fn conn(&self) -> parking_lot::MutexGuard<'_, Connection> {
        self.connection.lock()
    }

    // ---- Spaces ----

    fn row_to_space(row: &Row) -> rusqlite::Result<Space> {
        Ok(Space {
            id: row.get("id")?,
            name: row.get("name")?,
            color: row.get("color")?,
            active_environment_id: row.get("active_environment_id")?,
            sync_dir: row.get("sync_dir")?,
            sort_order: row.get("sort_order")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    pub fn list_spaces(&self) -> StorageResult<Vec<Space>> {
        let conn = self.connection.lock();
        let mut stmt = conn.prepare("SELECT * FROM spaces ORDER BY sort_order, created_at")?;
        let rows = stmt.query_map([], Self::row_to_space)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn get_space(&self, id: &str) -> StorageResult<Space> {
        let conn = self.connection.lock();
        conn.query_row(
            "SELECT * FROM spaces WHERE id = ?1",
            [id],
            Self::row_to_space,
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound(format!("space {id}")))
    }

    pub fn create_space(&self, name: &str, color: Option<&str>) -> StorageResult<Space> {
        let id = new_id();
        {
            let conn = self.connection.lock();
            let next: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM spaces",
                [],
                |r| r.get(0),
            )?;
            conn.execute(
                "INSERT INTO spaces (id, name, color, sort_order) VALUES (?1, ?2, ?3, ?4)",
                params![id, name, color, next],
            )?;
        }
        self.get_space(&id)
    }

    pub fn update_space(&self, id: &str, input: UpdateSpaceInput) -> StorageResult<Space> {
        {
            let conn = self.connection.lock();
            if let Some(name) = &input.name {
                conn.execute(
                    "UPDATE spaces SET name = ?1 WHERE id = ?2",
                    params![name, id],
                )?;
            }
            if let Some(color) = &input.color {
                conn.execute(
                    "UPDATE spaces SET color = ?1 WHERE id = ?2",
                    params![color, id],
                )?;
            }
            if let Some(env) = &input.active_environment_id {
                conn.execute(
                    "UPDATE spaces SET active_environment_id = ?1 WHERE id = ?2",
                    params![env, id],
                )?;
            }
            conn.execute(
                "UPDATE spaces SET updated_at = datetime('now') WHERE id = ?1",
                [id],
            )?;
        }
        self.get_space(id)
    }

    pub fn delete_space(&self, id: &str) -> StorageResult<()> {
        let conn = self.connection.lock();
        conn.execute("DELETE FROM spaces WHERE id = ?1", [id])?;
        Ok(())
    }

    // ---- Environments ----

    fn row_to_environment(row: &Row) -> rusqlite::Result<Environment> {
        Ok(Environment {
            id: row.get("id")?,
            space_id: row.get("space_id")?,
            name: row.get("name")?,
            variables: parse_json(row.get("variables")?),
            sort_order: row.get("sort_order")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    pub fn list_environments(&self, space_id: &str) -> StorageResult<Vec<Environment>> {
        let conn = self.connection.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM environments WHERE space_id = ?1 ORDER BY sort_order, created_at",
        )?;
        let rows = stmt.query_map([space_id], Self::row_to_environment)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub(crate) fn get_environment(&self, id: &str) -> StorageResult<Environment> {
        let conn = self.connection.lock();
        conn.query_row(
            "SELECT * FROM environments WHERE id = ?1",
            [id],
            Self::row_to_environment,
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound(format!("environment {id}")))
    }

    pub fn create_environment(
        &self,
        space_id: &str,
        name: &str,
        variables: &Value,
    ) -> StorageResult<Environment> {
        let id = new_id();
        {
            let conn = self.connection.lock();
            let next: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM environments WHERE space_id = ?1",
                [space_id],
                |r| r.get(0),
            )?;
            conn.execute(
                "INSERT INTO environments (id, space_id, name, variables, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, space_id, name, serde_json::to_string(variables)?, next],
            )?;
        }
        self.get_environment(&id)
    }

    pub fn update_environment(
        &self,
        id: &str,
        input: UpdateEnvironmentInput,
    ) -> StorageResult<Environment> {
        {
            let conn = self.connection.lock();
            if let Some(name) = &input.name {
                conn.execute(
                    "UPDATE environments SET name = ?1 WHERE id = ?2",
                    params![name, id],
                )?;
            }
            if let Some(vars) = &input.variables {
                conn.execute(
                    "UPDATE environments SET variables = ?1 WHERE id = ?2",
                    params![serde_json::to_string(vars)?, id],
                )?;
            }
            conn.execute(
                "UPDATE environments SET updated_at = datetime('now') WHERE id = ?1",
                [id],
            )?;
        }
        self.get_environment(id)
    }

    pub fn delete_environment(&self, id: &str) -> StorageResult<()> {
        let conn = self.connection.lock();
        conn.execute(
            "UPDATE spaces SET active_environment_id = NULL WHERE active_environment_id = ?1",
            [id],
        )?;
        conn.execute("DELETE FROM environments WHERE id = ?1", [id])?;
        Ok(())
    }

    // ---- Templates ----

    fn row_to_template(row: &Row) -> rusqlite::Result<Template> {
        Ok(Template {
            id: row.get("id")?,
            space_id: row.get("space_id")?,
            name: row.get("name")?,
            folder: row.get("folder")?,
            request: parse_json(row.get("request")?),
            sort_order: row.get("sort_order")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    pub fn list_templates(&self, space_id: &str) -> StorageResult<Vec<Template>> {
        let conn = self.connection.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM templates WHERE space_id = ?1 ORDER BY folder, sort_order, name",
        )?;
        let rows = stmt.query_map([space_id], Self::row_to_template)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub(crate) fn get_template(&self, id: &str) -> StorageResult<Template> {
        let conn = self.connection.lock();
        conn.query_row(
            "SELECT * FROM templates WHERE id = ?1",
            [id],
            Self::row_to_template,
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound(format!("template {id}")))
    }

    /// Insert several templates in one transaction (used by imports).
    pub fn create_templates(
        &self,
        inputs: Vec<CreateTemplateInput>,
    ) -> StorageResult<Vec<Template>> {
        let mut ids = Vec::with_capacity(inputs.len());
        {
            let mut conn = self.connection.lock();
            let tx = conn.transaction()?;
            for (i, input) in inputs.iter().enumerate() {
                let id = new_id();
                let folder = normalize_folder_path(&input.folder);
                ensure_folder_row(&tx, &input.space_id, &folder)?;
                tx.execute(
                    "INSERT INTO templates (id, space_id, name, folder, request, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        id,
                        input.space_id,
                        input.name,
                        folder,
                        serde_json::to_string(&input.request)?,
                        i as i64
                    ],
                )?;
                ids.push(id);
            }
            tx.commit()?;
        }
        ids.iter().map(|id| self.get_template(id)).collect()
    }

    pub fn update_template(&self, id: &str, input: UpdateTemplateInput) -> StorageResult<Template> {
        {
            let mut conn = self.connection.lock();
            let tx = conn.transaction()?;
            if let Some(name) = &input.name {
                tx.execute(
                    "UPDATE templates SET name = ?1 WHERE id = ?2",
                    params![name, id],
                )?;
            }
            if let Some(folder) = &input.folder {
                let folder = normalize_folder_path(folder);
                let space_id: Option<String> = tx
                    .query_row("SELECT space_id FROM templates WHERE id = ?1", [id], |r| {
                        r.get(0)
                    })
                    .optional()?;
                if let Some(space_id) = space_id {
                    ensure_folder_row(&tx, &space_id, &folder)?;
                }
                tx.execute(
                    "UPDATE templates SET folder = ?1 WHERE id = ?2",
                    params![folder, id],
                )?;
            }
            if let Some(request) = &input.request {
                tx.execute(
                    "UPDATE templates SET request = ?1 WHERE id = ?2",
                    params![serde_json::to_string(request)?, id],
                )?;
            }
            tx.execute(
                "UPDATE templates SET updated_at = datetime('now') WHERE id = ?1",
                [id],
            )?;
            tx.commit()?;
        }
        self.get_template(id)
    }

    pub fn delete_template(&self, id: &str) -> StorageResult<()> {
        let conn = self.connection.lock();
        conn.execute("DELETE FROM templates WHERE id = ?1", [id])?;
        Ok(())
    }

    // ---- Template folders ----

    fn row_to_template_folder(row: &Row) -> rusqlite::Result<TemplateFolder> {
        Ok(TemplateFolder {
            id: row.get("id")?,
            space_id: row.get("space_id")?,
            path: row.get("path")?,
            sort_order: row.get("sort_order")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    pub fn list_template_folders(&self, space_id: &str) -> StorageResult<Vec<TemplateFolder>> {
        let conn = self.connection.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM template_folders WHERE space_id = ?1 ORDER BY sort_order, path",
        )?;
        let rows = stmt.query_map([space_id], Self::row_to_template_folder)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    fn get_template_folder(&self, id: &str) -> StorageResult<TemplateFolder> {
        let conn = self.connection.lock();
        conn.query_row(
            "SELECT * FROM template_folders WHERE id = ?1",
            [id],
            Self::row_to_template_folder,
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound(format!("template folder {id}")))
    }

    pub fn create_template_folder(
        &self,
        space_id: &str,
        path: &str,
    ) -> StorageResult<TemplateFolder> {
        let path = normalize_folder_path(path);
        if path.is_empty() {
            return Err(StorageError::Validation("Enter a folder name".into()));
        }
        let id = {
            let mut conn = self.connection.lock();
            let tx = conn.transaction()?;
            let taken: Option<String> = tx
                .query_row(
                    "SELECT id FROM template_folders WHERE space_id = ?1 AND path = ?2",
                    params![space_id, path],
                    |r| r.get(0),
                )
                .optional()?;
            if taken.is_some() {
                return Err(StorageError::Validation(format!(
                    "Folder \"{path}\" already exists"
                )));
            }
            ensure_folder_row(&tx, space_id, &path)?;
            let id: String = tx.query_row(
                "SELECT id FROM template_folders WHERE space_id = ?1 AND path = ?2",
                params![space_id, path],
                |r| r.get(0),
            )?;
            tx.commit()?;
            id
        };
        self.get_template_folder(&id)
    }

    /// Rename a folder (and with it its subfolders), moving its templates along.
    pub fn rename_template_folder(
        &self,
        id: &str,
        path: &str,
    ) -> StorageResult<TemplateFolderRename> {
        let new_path = normalize_folder_path(path);
        if new_path.is_empty() {
            return Err(StorageError::Validation("Enter a folder name".into()));
        }
        let mut conn = self.connection.lock();
        let (space_id, old_path): (String, String) = conn
            .query_row(
                "SELECT space_id, path FROM template_folders WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound(format!("template folder {id}")))?;
        if new_path == old_path {
            drop(conn);
            return Ok(TemplateFolderRename {
                folder: self.get_template_folder(id)?,
                old_path,
                moved_template_ids: vec![],
            });
        }
        if new_path.starts_with(&format!("{old_path} / ")) {
            return Err(StorageError::Validation(
                "A folder cannot be moved inside itself".into(),
            ));
        }

        let prefix = format!("{old_path} / ");
        let move_path = |from: &str| format!("{new_path}{}", &from[old_path.len()..]);

        let folders: Vec<(String, String)> = {
            let mut stmt =
                conn.prepare("SELECT id, path FROM template_folders WHERE space_id = ?1")?;
            let rows = stmt.query_map([&space_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<Result<_, _>>()?
        };
        let affected: Vec<(String, String)> = folders
            .iter()
            .filter(|(_, p)| *p == old_path || p.starts_with(&prefix))
            .map(|(fid, p)| (fid.clone(), move_path(p)))
            .collect();
        let moved_ids: std::collections::HashSet<&str> =
            affected.iter().map(|(fid, _)| fid.as_str()).collect();
        let new_paths: std::collections::HashSet<&str> =
            affected.iter().map(|(_, p)| p.as_str()).collect();
        for (fid, p) in folders.iter() {
            if !moved_ids.contains(fid.as_str()) && new_paths.contains(p.as_str()) {
                return Err(StorageError::Validation(format!(
                    "A folder named \"{p}\" already exists"
                )));
            }
        }

        let templates: Vec<(String, String)> = {
            let mut stmt = conn.prepare("SELECT id, folder FROM templates WHERE space_id = ?1")?;
            let rows = stmt.query_map([&space_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<Result<_, _>>()?
        };
        let moved_templates: Vec<(String, String)> = templates
            .iter()
            .filter(|(_, f)| *f == old_path || f.starts_with(&prefix))
            .map(|(tid, f)| (tid.clone(), move_path(f)))
            .collect();

        let tx = conn.transaction()?;
        ensure_folder_row(&tx, &space_id, &folder_parent(&new_path))?;
        for (fid, p) in &affected {
            tx.execute(
                "UPDATE template_folders SET path = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![p, fid],
            )?;
        }
        for (tid, f) in &moved_templates {
            tx.execute(
                "UPDATE templates SET folder = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![f, tid],
            )?;
        }
        tx.commit()?;
        drop(conn);

        Ok(TemplateFolderRename {
            folder: self.get_template_folder(id)?,
            old_path,
            moved_template_ids: moved_templates.into_iter().map(|(id, _)| id).collect(),
        })
    }

    /// Delete an empty folder (no templates, no subfolders).
    pub fn delete_template_folder(&self, id: &str) -> StorageResult<TemplateFolder> {
        let folder = self.get_template_folder(id)?;
        let prefix = format!("{} / ", folder.path);
        let conn = self.connection.lock();
        let mut stmt = conn.prepare("SELECT path FROM template_folders WHERE space_id = ?1")?;
        let paths: Vec<String> = stmt
            .query_map([&folder.space_id], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        if paths.iter().any(|p| p.starts_with(&prefix)) {
            return Err(StorageError::Validation(format!(
                "Folder \"{}\" has subfolders; delete them first",
                folder.path
            )));
        }
        let templates: i64 = conn.query_row(
            "SELECT COUNT(*) FROM templates WHERE space_id = ?1 AND folder = ?2",
            params![folder.space_id, folder.path],
            |r| r.get(0),
        )?;
        if templates > 0 {
            return Err(StorageError::Validation(format!(
                "Folder \"{}\" still holds templates; move or delete them first",
                folder.path
            )));
        }
        conn.execute("DELETE FROM template_folders WHERE id = ?1", [id])?;
        Ok(folder)
    }

    /// New folder order, top to bottom.
    pub fn arrange_template_folders(&self, space_id: &str, paths: &[String]) -> StorageResult<()> {
        let mut conn = self.connection.lock();
        let tx = conn.transaction()?;
        for (i, path) in paths.iter().enumerate() {
            tx.execute(
                "UPDATE template_folders SET sort_order = ?1, updated_at = datetime('now') WHERE space_id = ?2 AND path = ?3",
                params![i as i64, space_id, path],
            )?;
        }
        // Folders the caller did not mention keep their order, after the listed ones.
        let listed: std::collections::HashSet<&str> = paths.iter().map(String::as_str).collect();
        let rest: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT path FROM template_folders WHERE space_id = ?1 ORDER BY sort_order, path",
            )?;
            let rows = stmt.query_map([space_id], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .filter(|p| !listed.contains(p.as_str()))
                .collect()
        };
        for (i, path) in rest.iter().enumerate() {
            tx.execute(
                "UPDATE template_folders SET sort_order = ?1, updated_at = datetime('now') WHERE space_id = ?2 AND path = ?3",
                params![(paths.len() + i) as i64, space_id, path],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Apply a drag: new folder and position for the templates that moved.
    /// Returns the ids whose folder changed, so their files can follow.
    pub fn arrange_templates(
        &self,
        space_id: &str,
        items: &[TemplateOrderInput],
    ) -> StorageResult<Vec<String>> {
        let mut conn = self.connection.lock();
        let tx = conn.transaction()?;
        let mut moved = Vec::new();
        for item in items {
            let folder = normalize_folder_path(&item.folder);
            let old: Option<String> = tx
                .query_row(
                    "SELECT folder FROM templates WHERE id = ?1 AND space_id = ?2",
                    params![item.id, space_id],
                    |r| r.get(0),
                )
                .optional()?;
            let Some(old) = old else { continue };
            if old != folder {
                moved.push(item.id.clone());
                ensure_folder_row(&tx, space_id, &folder)?;
            }
            tx.execute(
                "UPDATE templates SET folder = ?1, sort_order = ?2, updated_at = datetime('now') WHERE id = ?3 AND space_id = ?4",
                params![folder, item.sort_order, item.id, space_id],
            )?;
        }
        tx.commit()?;
        Ok(moved)
    }

    /// Persist the sidebar order of tabs (top to bottom).
    pub fn reorder_tabs(&self, space_id: &str, ids: &[String]) -> StorageResult<()> {
        let mut conn = self.connection.lock();
        let tx = conn.transaction()?;
        let count = ids.len() as i64;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE tabs SET sort_order = ?1, updated_at = datetime('now') WHERE id = ?2 AND space_id = ?3",
                params![count - i as i64, id, space_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---- Tabs ----

    fn row_to_tab(row: &Row) -> rusqlite::Result<Tab> {
        let response: Option<String> = row.get("response")?;
        Ok(Tab {
            id: row.get("id")?,
            space_id: row.get("space_id")?,
            template_id: row.get("template_id")?,
            template_name: row.get("template_name")?,
            custom_title: row.get("custom_title")?,
            request: parse_json(row.get("request")?),
            param_values: parse_json(row.get("param_values")?),
            response: response.map(parse_json),
            is_pinned: row.get::<_, i64>("is_pinned")? != 0,
            sort_order: row.get("sort_order")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    /// Newest first, pinned tabs on top (like Larik).
    pub fn list_tabs(&self, space_id: &str) -> StorageResult<Vec<Tab>> {
        let conn = self.connection.lock();
        let mut stmt = conn.prepare(
            "SELECT * FROM tabs WHERE space_id = ?1 ORDER BY is_pinned DESC, sort_order DESC",
        )?;
        let rows = stmt.query_map([space_id], Self::row_to_tab)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    fn get_tab(&self, id: &str) -> StorageResult<Tab> {
        let conn = self.connection.lock();
        conn.query_row("SELECT * FROM tabs WHERE id = ?1", [id], Self::row_to_tab)
            .optional()?
            .ok_or_else(|| StorageError::NotFound(format!("tab {id}")))
    }

    pub fn create_tab(&self, input: CreateTabInput) -> StorageResult<Tab> {
        let id = new_id();
        {
            let conn = self.connection.lock();
            let next: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tabs WHERE space_id = ?1",
                [&input.space_id],
                |r| r.get(0),
            )?;
            conn.execute(
                "INSERT INTO tabs (id, space_id, template_id, template_name, request, param_values, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    id,
                    input.space_id,
                    input.template_id,
                    input.template_name,
                    serde_json::to_string(&input.request)?,
                    serde_json::to_string(&input.param_values)?,
                    next
                ],
            )?;
        }
        self.get_tab(&id)
    }

    pub fn update_tab(&self, id: &str, input: UpdateTabInput) -> StorageResult<Tab> {
        {
            let conn = self.connection.lock();
            if let Some(v) = &input.template_id {
                conn.execute(
                    "UPDATE tabs SET template_id = ?1 WHERE id = ?2",
                    params![v, id],
                )?;
            }
            if let Some(v) = &input.template_name {
                conn.execute(
                    "UPDATE tabs SET template_name = ?1 WHERE id = ?2",
                    params![v, id],
                )?;
            }
            if let Some(v) = &input.custom_title {
                conn.execute(
                    "UPDATE tabs SET custom_title = ?1 WHERE id = ?2",
                    params![v, id],
                )?;
            }
            if let Some(v) = &input.request {
                conn.execute(
                    "UPDATE tabs SET request = ?1 WHERE id = ?2",
                    params![serde_json::to_string(v)?, id],
                )?;
            }
            if let Some(v) = &input.param_values {
                conn.execute(
                    "UPDATE tabs SET param_values = ?1 WHERE id = ?2",
                    params![serde_json::to_string(v)?, id],
                )?;
            }
            if let Some(v) = input.response {
                let text = v
                    .map(|r| serde_json::to_string(&trim_response(r)))
                    .transpose()?;
                conn.execute(
                    "UPDATE tabs SET response = ?1 WHERE id = ?2",
                    params![text, id],
                )?;
            }
            if let Some(v) = input.is_pinned {
                conn.execute(
                    "UPDATE tabs SET is_pinned = ?1 WHERE id = ?2",
                    params![v as i64, id],
                )?;
            }
            conn.execute(
                "UPDATE tabs SET updated_at = datetime('now') WHERE id = ?1",
                [id],
            )?;
        }
        self.get_tab(id)
    }

    pub fn delete_tab(&self, id: &str) -> StorageResult<()> {
        let conn = self.connection.lock();
        conn.execute("DELETE FROM tabs WHERE id = ?1", [id])?;
        Ok(())
    }

    // ---- App state ----

    pub fn get_app_state(&self) -> StorageResult<serde_json::Map<String, Value>> {
        let conn = self.connection.lock();
        let mut stmt = conn.prepare("SELECT key, value FROM app_state")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut map = serde_json::Map::new();
        for row in rows {
            let (key, value) = row?;
            map.insert(key, parse_json(value));
        }
        Ok(map)
    }

    pub fn set_app_state(&self, key: &str, value: &Value) -> StorageResult<()> {
        let conn = self.connection.lock();
        conn.execute(
            "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, serde_json::to_string(value)?],
        )?;
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tab_is_snapshot_and_survives_template_delete() {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Work", None).unwrap();
        let tpl = db
            .create_templates(vec![CreateTemplateInput {
                space_id: space.id.clone(),
                name: "Get contact".into(),
                folder: "Contacts".into(),
                request: json!({"method": "GET", "url": "{{baseUrl}}/contacts/{{id}}"}),
            }])
            .unwrap()
            .remove(0);
        let tab = db
            .create_tab(CreateTabInput {
                space_id: space.id.clone(),
                template_id: Some(tpl.id.clone()),
                template_name: Some(tpl.name.clone()),
                request: tpl.request.clone(),
                param_values: json!({"id": "42"}),
            })
            .unwrap();

        db.update_template(
            &tpl.id,
            UpdateTemplateInput {
                name: None,
                folder: None,
                request: Some(json!({"method": "POST", "url": "changed"})),
            },
        )
        .unwrap();
        db.delete_template(&tpl.id).unwrap();

        let tabs = db.list_tabs(&space.id).unwrap();
        assert_eq!(tabs.len(), 1);
        assert_eq!(tabs[0].id, tab.id);
        assert_eq!(tabs[0].request["method"], "GET");
        assert_eq!(tabs[0].param_values["id"], "42");
    }

    #[test]
    fn update_tab_distinguishes_missing_and_null() {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Work", None).unwrap();
        let tab = db
            .create_tab(CreateTabInput {
                space_id: space.id,
                template_id: None,
                template_name: None,
                request: json!({}),
                param_values: json!({}),
            })
            .unwrap();

        let input: UpdateTabInput =
            serde_json::from_value(json!({"custom_title": "Mine"})).unwrap();
        let tab2 = db.update_tab(&tab.id, input).unwrap();
        assert_eq!(tab2.custom_title.as_deref(), Some("Mine"));

        // Field absent: title untouched.
        let input: UpdateTabInput = serde_json::from_value(json!({"is_pinned": true})).unwrap();
        let tab3 = db.update_tab(&tab.id, input).unwrap();
        assert_eq!(tab3.custom_title.as_deref(), Some("Mine"));
        assert!(tab3.is_pinned);

        // Explicit null: title cleared.
        let input: UpdateTabInput = serde_json::from_value(json!({"custom_title": null})).unwrap();
        let tab4 = db.update_tab(&tab.id, input).unwrap();
        assert_eq!(tab4.custom_title, None);
    }

    #[test]
    fn large_response_body_is_trimmed() {
        let big = "x".repeat(MAX_STORED_BODY + 10);
        let trimmed =
            trim_response(json!({"sentAt": "t", "response": {"status": 200, "bodyBase64": big}}));
        assert_eq!(
            trimmed["response"]["bodyBase64"].as_str().unwrap().len(),
            MAX_STORED_BODY
        );
        assert_eq!(trimmed["truncated"], true);

        let small = trim_response(json!({"response": {"body": "ok"}}));
        assert_eq!(small["response"]["body"], "ok");
        assert!(small.get("truncated").is_none());
    }

    fn add_template(db: &DatabaseManager, space_id: &str, name: &str, folder: &str) -> Template {
        db.create_templates(vec![CreateTemplateInput {
            space_id: space_id.into(),
            name: name.into(),
            folder: folder.into(),
            request: json!({"method": "GET", "url": "{{baseUrl}}/x"}),
        }])
        .unwrap()
        .remove(0)
    }

    #[test]
    fn folder_paths_are_normalized_and_keep_their_order() {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Work", None).unwrap();

        let admin = db
            .create_template_folder(&space.id, " Contacts /  Admin ")
            .unwrap();
        assert_eq!(admin.path, "Contacts / Admin");
        // The parent came along, so the tree is complete.
        let paths: Vec<String> = db
            .list_template_folders(&space.id)
            .unwrap()
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert_eq!(paths, vec!["Contacts", "Contacts / Admin"]);

        let err = db
            .create_template_folder(&space.id, "Contacts / Admin")
            .unwrap_err();
        assert!(matches!(err, StorageError::Validation(_)), "{err:?}");
        let err = db
            .create_template_folder(&space.id, "Contacts")
            .unwrap_err();
        assert!(matches!(err, StorageError::Validation(_)), "{err:?}");
        let err = db.create_template_folder(&space.id, "   ").unwrap_err();
        assert!(matches!(err, StorageError::Validation(_)), "{err:?}");

        // A template put into a new folder brings its folder rows along.
        let tpl = add_template(&db, &space.id, "List", "Teams\\Sales");
        assert_eq!(tpl.folder, "Teams / Sales");

        let folders = db.list_template_folders(&space.id).unwrap();
        let paths: Vec<&str> = folders.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            vec!["Contacts", "Contacts / Admin", "Teams", "Teams / Sales"]
        );

        // Renaming through the template editor keeps its folder row, not a duplicate.
        db.update_template(
            &tpl.id,
            UpdateTemplateInput {
                name: None,
                folder: Some("Teams".into()),
                request: None,
            },
        )
        .unwrap();
        let paths: Vec<String> = db
            .list_template_folders(&space.id)
            .unwrap()
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert!(paths.contains(&"Teams".to_string()), "{paths:?}");
        assert_eq!(
            paths.iter().filter(|p| p.as_str() == "Teams").count(),
            1,
            "{paths:?}"
        );
        assert!(paths.contains(&"Teams / Sales".to_string()), "{paths:?}");
        assert_eq!(paths.len(), 4, "{paths:?}");
        let _ = admin;
    }

    #[test]
    fn renaming_a_folder_moves_templates_and_subfolders() {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Work", None).unwrap();
        let people = db.create_template_folder(&space.id, "People").unwrap();
        db.create_template_folder(&space.id, "People / Admin")
            .unwrap();
        db.create_template_folder(&space.id, "Other").unwrap();
        add_template(&db, &space.id, "List people", "People");
        add_template(&db, &space.id, "List admins", "People / Admin");

        let rename = db
            .rename_template_folder(&people.id, "Contacts / People")
            .unwrap();
        assert_eq!(rename.old_path, "People");
        assert_eq!(rename.folder.path, "Contacts / People");
        assert_eq!(rename.moved_template_ids.len(), 2);

        let paths: Vec<String> = db
            .list_template_folders(&space.id)
            .unwrap()
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert!(
            paths.contains(&"Contacts / People".to_string()),
            "{paths:?}"
        );
        assert!(
            paths.contains(&"Contacts / People / Admin".to_string()),
            "{paths:?}"
        );
        assert!(paths.contains(&"Contacts".to_string()), "{paths:?}");
        let folders: Vec<String> = db
            .list_templates(&space.id)
            .unwrap()
            .into_iter()
            .map(|t| t.folder)
            .collect();
        assert_eq!(
            folders,
            vec!["Contacts / People", "Contacts / People / Admin"]
        );

        // Collisions and moving a folder inside itself are refused.
        let err = db.rename_template_folder(&people.id, "Other").unwrap_err();
        assert!(matches!(err, StorageError::Validation(_)), "{err:?}");
        let err = db
            .rename_template_folder(&people.id, "Contacts / People / Deep")
            .unwrap_err();
        assert!(matches!(err, StorageError::Validation(_)), "{err:?}");
    }

    #[test]
    fn only_empty_folders_can_be_deleted() {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Work", None).unwrap();
        let parent = db.create_template_folder(&space.id, "Contacts").unwrap();
        let child = db
            .create_template_folder(&space.id, "Contacts / Admin")
            .unwrap();
        let tpl = add_template(&db, &space.id, "List admins", "Contacts / Admin");

        let err = db.delete_template_folder(&parent.id).unwrap_err();
        assert!(matches!(err, StorageError::Validation(_)), "{err:?}");
        let err = db.delete_template_folder(&child.id).unwrap_err();
        assert!(matches!(err, StorageError::Validation(_)), "{err:?}");

        db.arrange_templates(
            &space.id,
            &[TemplateOrderInput {
                id: tpl.id.clone(),
                folder: "".into(),
                sort_order: 0,
            }],
        )
        .unwrap();
        db.delete_template_folder(&child.id).unwrap();
        db.delete_template_folder(&parent.id).unwrap();
        assert!(db.list_template_folders(&space.id).unwrap().is_empty());
    }

    #[test]
    fn arranging_folders_and_templates_persists_order() {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Work", None).unwrap();
        db.create_template_folder(&space.id, "A").unwrap();
        db.create_template_folder(&space.id, "B").unwrap();
        db.create_template_folder(&space.id, "C").unwrap();
        let first = add_template(&db, &space.id, "First", "A");
        let second = add_template(&db, &space.id, "Second", "A");
        let third = add_template(&db, &space.id, "Third", "B");

        db.arrange_template_folders(
            &space.id,
            &["C".to_string(), "A".to_string(), "B".to_string()],
        )
        .unwrap();
        let paths: Vec<String> = db
            .list_template_folders(&space.id)
            .unwrap()
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert_eq!(paths, vec!["C", "A", "B"]);

        // Drag `second` to the top of A and `third` into A at the bottom.
        let moved = db
            .arrange_templates(
                &space.id,
                &[
                    TemplateOrderInput {
                        id: second.id.clone(),
                        folder: "A".into(),
                        sort_order: 0,
                    },
                    TemplateOrderInput {
                        id: first.id.clone(),
                        folder: "A".into(),
                        sort_order: 1,
                    },
                    TemplateOrderInput {
                        id: third.id.clone(),
                        folder: "A".into(),
                        sort_order: 2,
                    },
                ],
            )
            .unwrap();
        assert_eq!(moved, vec![third.id.clone()]);

        let folders: Vec<String> = db
            .list_templates(&space.id)
            .unwrap()
            .into_iter()
            .map(|t| t.folder)
            .collect();
        assert_eq!(folders, vec!["A", "A", "A"]);
        let ordered: Vec<String> = db
            .list_templates(&space.id)
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(ordered, vec!["Second", "First", "Third"]);
    }

    #[test]
    fn reordering_tabs_persists_sidebar_order() {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Work", None).unwrap();
        let mut ids = Vec::new();
        for _ in 0..3 {
            ids.push(
                db.create_tab(CreateTabInput {
                    space_id: space.id.clone(),
                    template_id: None,
                    template_name: None,
                    request: json!({}),
                    param_values: json!({}),
                })
                .unwrap()
                .id,
            );
        }
        db.reorder_tabs(&space.id, &[ids[0].clone(), ids[2].clone(), ids[1].clone()])
            .unwrap();
        let order: Vec<String> = db
            .list_tabs(&space.id)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(order, vec![ids[0].clone(), ids[2].clone(), ids[1].clone()]);
    }

    #[test]
    fn deleting_environment_clears_active_reference() {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Work", None).unwrap();
        let env = db.create_environment(&space.id, "Dev", &json!([])).unwrap();
        db.update_space(
            &space.id,
            UpdateSpaceInput {
                name: None,
                color: None,
                active_environment_id: Some(Some(env.id.clone())),
            },
        )
        .unwrap();
        db.delete_environment(&env.id).unwrap();
        assert_eq!(db.get_space(&space.id).unwrap().active_environment_id, None);
    }
}
