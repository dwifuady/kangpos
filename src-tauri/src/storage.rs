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

fn add_column_if_missing(conn: &Connection, table: &str, column: &str, sql_type: &str) -> StorageResult<()> {
    let exists = conn
        .prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"))?
        .exists([column])?;
    if !exists {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))?;
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

            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_environments_space ON environments(space_id);
            CREATE INDEX IF NOT EXISTS idx_templates_space ON templates(space_id);
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
                conn.execute("UPDATE spaces SET name = ?1 WHERE id = ?2", params![name, id])?;
            }
            if let Some(color) = &input.color {
                conn.execute("UPDATE spaces SET color = ?1 WHERE id = ?2", params![color, id])?;
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
    pub fn create_templates(&self, inputs: Vec<CreateTemplateInput>) -> StorageResult<Vec<Template>> {
        let mut ids = Vec::with_capacity(inputs.len());
        {
            let mut conn = self.connection.lock();
            let tx = conn.transaction()?;
            for (i, input) in inputs.iter().enumerate() {
                let id = new_id();
                tx.execute(
                    "INSERT INTO templates (id, space_id, name, folder, request, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        id,
                        input.space_id,
                        input.name,
                        input.folder,
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
            let conn = self.connection.lock();
            if let Some(name) = &input.name {
                conn.execute("UPDATE templates SET name = ?1 WHERE id = ?2", params![name, id])?;
            }
            if let Some(folder) = &input.folder {
                conn.execute(
                    "UPDATE templates SET folder = ?1 WHERE id = ?2",
                    params![folder, id],
                )?;
            }
            if let Some(request) = &input.request {
                conn.execute(
                    "UPDATE templates SET request = ?1 WHERE id = ?2",
                    params![serde_json::to_string(request)?, id],
                )?;
            }
            conn.execute(
                "UPDATE templates SET updated_at = datetime('now') WHERE id = ?1",
                [id],
            )?;
        }
        self.get_template(id)
    }

    pub fn delete_template(&self, id: &str) -> StorageResult<()> {
        let conn = self.connection.lock();
        conn.execute("DELETE FROM templates WHERE id = ?1", [id])?;
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
                conn.execute("UPDATE tabs SET template_id = ?1 WHERE id = ?2", params![v, id])?;
            }
            if let Some(v) = &input.template_name {
                conn.execute("UPDATE tabs SET template_name = ?1 WHERE id = ?2", params![v, id])?;
            }
            if let Some(v) = &input.custom_title {
                conn.execute("UPDATE tabs SET custom_title = ?1 WHERE id = ?2", params![v, id])?;
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
                conn.execute("UPDATE tabs SET response = ?1 WHERE id = ?2", params![text, id])?;
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
        let input: UpdateTabInput =
            serde_json::from_value(json!({"custom_title": null})).unwrap();
        let tab4 = db.update_tab(&tab.id, input).unwrap();
        assert_eq!(tab4.custom_title, None);
    }

    #[test]
    fn large_response_body_is_trimmed() {
        let big = "x".repeat(MAX_STORED_BODY + 10);
        let trimmed = trim_response(json!({"sentAt": "t", "response": {"status": 200, "bodyBase64": big}}));
        assert_eq!(trimmed["response"]["bodyBase64"].as_str().unwrap().len(), MAX_STORED_BODY);
        assert_eq!(trimmed["truncated"], true);

        let small = trim_response(json!({"response": {"body": "ok"}}));
        assert_eq!(small["response"]["body"], "ok");
        assert!(small.get("truncated").is_none());
    }

    #[test]
    fn deleting_environment_clears_active_reference() {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Work", None).unwrap();
        let env = db
            .create_environment(&space.id, "Dev", &json!([]))
            .unwrap();
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
