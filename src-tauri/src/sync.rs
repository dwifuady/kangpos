// Optional folder sync for a space: templates and environments are mirrored
// to YAML files so they can live in git. SQLite stays the cache the UI reads;
// once a space is linked, the folder is the source of truth.
//
// Folder layout:
//   kangpos.yaml                  space name, colour, format version
//   <Folder>/<Sub>/<template>.yaml one file per template (folder = directories)
//   environments/<env>.yaml       one file per environment (secret values omitted)
//
// Tabs, responses and secret values never leave the local database.

use crate::storage::{DatabaseManager, Space, StorageError};
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const FORMAT_VERSION: u64 = 1;
const WORKSPACE_FILE: &str = "kangpos.yaml";
const ENV_DIR: &str = "environments";
pub const SYNC_EVENT: &str = "kangpos://sync";

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("{0}")]
    Storage(#[from] StorageError),
    #[error("{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Invalid(String),
}

pub type SyncResult<T> = Result<T, SyncError>;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FileError {
    /// Path relative to the space folder.
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SyncStatus {
    pub space_id: String,
    pub dir: String,
    /// The folder no longer exists (moved, unplugged drive, ...).
    pub missing: bool,
    pub errors: Vec<FileError>,
}

#[derive(Debug, Clone, Serialize)]
struct SyncEvent {
    space_id: String,
    /// Templates, environments or the space itself changed in the database.
    changed: bool,
    status: SyncStatus,
}

// ---------------------------------------------------------------------------
// File content: stable key order, no empty noise

/// Keys in the order they are written; anything else follows alphabetically.
const KEY_ORDER: &[&str] = &[
    "kangpos", "id", "name", "color", "method", "url", "params", "query", "headers", "body", "auth",
    "scripts", "before", "after",
    "variables", "type", "key", "value", "enabled", "secret", "kind", "default", "required", "options",
    "description", "raw", "fields", "token", "username", "password", "in",
];

/// Fields that are always strings in KangPos, even if YAML parsed `123` or `true`.
const STRING_KEYS: &[&str] = &[
    "id", "name", "method", "url", "key", "value", "default", "description", "raw", "token",
    "username", "password", "in", "type", "kind",
];

/// Drop values that only add noise to diffs: nulls, empty lists, empty
/// `raw`/`description`/script text, `body`/`auth` objects of type "none",
/// and a `scripts` object with no scripts.
fn clean(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = Map::new();
            for (k, v) in map {
                if v.is_null() || matches!(v, Value::Array(a) if a.is_empty()) {
                    continue;
                }
                if matches!(k.as_str(), "raw" | "description" | "before" | "after") && v.as_str().is_some_and(|t| t.trim().is_empty()) {
                    continue;
                }
                if (k == "body" || k == "auth") && v.get("type").and_then(Value::as_str) == Some("none") {
                    continue;
                }
                let cleaned = clean(v);
                if k == "scripts" && cleaned.as_object().is_some_and(|o| o.is_empty()) {
                    continue;
                }
                out.insert(k.clone(), cleaned);
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(clean).collect()),
        other => other.clone(),
    }
}

/// Undo YAML typing surprises in hand-edited files (`value: 123` -> "123").
fn coerce_strings(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                if STRING_KEYS.contains(&k.as_str()) && (v.is_number() || v.is_boolean()) {
                    *v = Value::String(v.to_string());
                } else {
                    coerce_strings(v);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(coerce_strings),
        _ => {}
    }
}

fn key_rank(key: &str) -> (usize, String) {
    let rank = KEY_ORDER.iter().position(|k| *k == key).unwrap_or(KEY_ORDER.len());
    (rank, key.to_string())
}

fn to_yaml(value: &Value) -> serde_yaml_ng::Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by_key(|k| key_rank(k));
            let mut out = serde_yaml_ng::Mapping::new();
            for k in keys {
                out.insert(serde_yaml_ng::Value::String(k.clone()), to_yaml(&map[k]));
            }
            serde_yaml_ng::Value::Mapping(out)
        }
        Value::Array(items) => serde_yaml_ng::Value::Sequence(items.iter().map(to_yaml).collect()),
        Value::String(s) => serde_yaml_ng::Value::String(s.clone()),
        Value::Number(n) => serde_yaml_ng::to_value(n).unwrap_or(serde_yaml_ng::Value::Null),
        Value::Bool(b) => serde_yaml_ng::Value::Bool(*b),
        Value::Null => serde_yaml_ng::Value::Null,
    }
}

fn render(value: &Value) -> SyncResult<String> {
    serde_yaml_ng::to_string(&to_yaml(&clean(value))).map_err(|e| SyncError::Invalid(e.to_string()))
}

fn parse_yaml(text: &str) -> Result<Map<String, Value>, String> {
    let mut value: Value = serde_yaml_ng::from_str(text).map_err(|e| e.to_string())?;
    coerce_strings(&mut value);
    match value {
        Value::Object(map) => Ok(map),
        _ => Err("Expected a YAML mapping (key: value pairs) at the top level".into()),
    }
}

/// What a template file holds: id + name + the request fields, flattened.
pub fn template_document(id: &str, name: &str, request: &Value) -> Value {
    let mut doc = Map::new();
    doc.insert("id".into(), Value::String(id.into()));
    doc.insert("name".into(), Value::String(name.into()));
    if let Value::Object(req) = request {
        for (k, v) in req {
            if k != "id" && k != "name" {
                doc.insert(k.clone(), v.clone());
            }
        }
    }
    Value::Object(doc)
}

/// Environment file: secret values are left out (they stay in the local database).
pub fn environment_document(id: &str, name: &str, variables: &Value) -> Value {
    let vars: Vec<Value> = variables
        .as_array()
        .map(|list| {
            list.iter()
                .map(|v| {
                    let mut var = v.as_object().cloned().unwrap_or_default();
                    if var.get("secret").and_then(Value::as_bool) == Some(true) {
                        var.remove("value");
                    }
                    Value::Object(var)
                })
                .collect()
        })
        .unwrap_or_default();
    let mut doc = Map::new();
    doc.insert("id".into(), Value::String(id.into()));
    doc.insert("name".into(), Value::String(name.into()));
    doc.insert("variables".into(), Value::Array(vars));
    Value::Object(doc)
}

// ---------------------------------------------------------------------------
// Paths

/// File-name stem for a template or environment name: `Get contact` -> `get-contact`.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for ch in name.trim().chars() {
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
        } else if matches!(ch, ' ' | '-' | '_' | '.' | '/' | '\\' | ':') && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "untitled".into()
    } else {
        reserved_safe(out)
    }
}

/// A template folder segment kept readable (`Contacts`, `Admin users`), minus characters Windows rejects.
fn folder_segment(segment: &str) -> String {
    let cleaned: String = segment
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.').trim().to_string();
    if cleaned.is_empty() || cleaned.starts_with('.') || cleaned == ENV_DIR {
        format!("_{cleaned}")
    } else {
        reserved_safe(cleaned)
    }
}

fn reserved_safe(name: String) -> String {
    const RESERVED: &[&str] = &[
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "lpt1", "lpt2", "lpt3",
    ];
    if RESERVED.contains(&name.to_lowercase().as_str()) {
        format!("{name}_")
    } else {
        name
    }
}

fn folder_dirs(folder: &str) -> Vec<String> {
    folder
        .split('/')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(folder_segment)
        .collect()
}

/// Relative path with forward slashes (stored in SQLite, shown in errors).
fn rel_string(path: &Path) -> String {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Pick `<stem>.yaml`, or `<stem>-2.yaml`, ... if another item already uses that name.
fn unique_path(dir: &Path, base: &Path, stem: &str, taken: &HashSet<String>, own: Option<&str>) -> String {
    for n in 1.. {
        let file = if n == 1 { format!("{stem}.yaml") } else { format!("{stem}-{n}.yaml") };
        let rel = rel_string(&base.join(&file));
        if own == Some(rel.as_str()) {
            return rel;
        }
        if !taken.contains(&rel) && !dir.join(&rel).exists() {
            return rel;
        }
    }
    unreachable!()
}

/// `get-contact.yaml` or a numbered twin like `get-contact-2.yaml`.
fn stem_matches(rel: &str, stem: &str) -> bool {
    let Some(file_stem) = Path::new(rel).file_stem().and_then(|s| s.to_str()) else { return false };
    file_stem == stem
        || file_stem
            .strip_prefix(stem)
            .and_then(|rest| rest.strip_prefix('-'))
            .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// Write via a temp file + rename so the watcher never sees half a file.
fn write_atomic(path: &Path, content: &str) -> SyncResult<()> {
    if std::fs::read_to_string(path).ok().as_deref() == Some(content) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("yaml.tmp");
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Remove a file and any directories it leaves empty (never the space folder itself).
fn remove_file(dir: &Path, rel: &str) {
    let path = dir.join(rel);
    let _ = std::fs::remove_file(&path);
    let mut parent = path.parent().map(Path::to_path_buf);
    while let Some(p) = parent {
        if p == dir || !p.starts_with(dir) {
            break;
        }
        if std::fs::remove_dir(&p).is_err() {
            break; // not empty
        }
        parent = p.parent().map(Path::to_path_buf);
    }
}

// ---------------------------------------------------------------------------
// Writing (database -> folder)

fn space_dir(db: &DatabaseManager, space_id: &str) -> SyncResult<Option<PathBuf>> {
    Ok(db.get_space(space_id)?.sync_dir.map(PathBuf::from))
}

pub fn write_workspace_file(dir: &Path, space: &Space) -> SyncResult<()> {
    let mut doc = Map::new();
    doc.insert("kangpos".into(), Value::from(FORMAT_VERSION));
    doc.insert("name".into(), Value::String(space.name.clone()));
    if let Some(color) = &space.color {
        doc.insert("color".into(), Value::String(color.clone()));
    }
    write_atomic(&dir.join(WORKSPACE_FILE), &render(&Value::Object(doc))?)
}

fn taken_paths(db: &DatabaseManager, table: &str, space_id: &str, except_id: &str) -> SyncResult<HashSet<String>> {
    let conn = db.conn();
    let mut stmt = conn.prepare(&format!(
        "SELECT file_path FROM {table} WHERE space_id = ?1 AND id != ?2 AND file_path IS NOT NULL"
    ))?;
    let rows = stmt.query_map(params![space_id, except_id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn current_file_path(db: &DatabaseManager, table: &str, id: &str) -> SyncResult<Option<String>> {
    let conn = db.conn();
    Ok(conn
        .query_row(&format!("SELECT file_path FROM {table} WHERE id = ?1"), [id], |r| r.get::<_, Option<String>>(0))
        .optional()?
        .flatten())
}

fn set_file_path(db: &DatabaseManager, table: &str, id: &str, rel: Option<&str>) -> SyncResult<()> {
    db.conn()
        .execute(&format!("UPDATE {table} SET file_path = ?1 WHERE id = ?2"), params![rel, id])?;
    Ok(())
}

/// Write one template to its file, moving the file if its name or folder changed.
pub fn write_template(db: &DatabaseManager, id: &str) -> SyncResult<()> {
    let tpl = db.get_template(id)?;
    let Some(dir) = space_dir(db, &tpl.space_id)? else { return Ok(()) };
    let old = current_file_path(db, "templates", id)?;
    let base: PathBuf = folder_dirs(&tpl.folder).iter().collect();
    let stem = slug(&tpl.name);
    // Keep the current file if it already sits at the right place.
    let keep = old.as_deref().filter(|rel| {
        Path::new(rel).parent().map(Path::to_path_buf).unwrap_or_default() == base && stem_matches(rel, &stem)
    });
    let rel = match keep {
        Some(rel) => rel.to_string(),
        None => unique_path(&dir, &base, &stem, &taken_paths(db, "templates", &tpl.space_id, id)?, None),
    };
    write_atomic(&dir.join(&rel), &render(&template_document(&tpl.id, &tpl.name, &tpl.request))?)?;
    if let Some(old) = old.filter(|o| *o != rel) {
        remove_file(&dir, &old);
    }
    set_file_path(db, "templates", id, Some(&rel))
}

/// Remove a template's file (call before deleting the row).
pub fn remove_template(db: &DatabaseManager, id: &str) -> SyncResult<()> {
    let Ok(tpl) = db.get_template(id) else { return Ok(()) };
    if let (Some(dir), Some(rel)) = (space_dir(db, &tpl.space_id)?, current_file_path(db, "templates", id)?) {
        remove_file(&dir, &rel);
    }
    Ok(())
}

pub fn write_environment(db: &DatabaseManager, id: &str) -> SyncResult<()> {
    let env = db.get_environment(id)?;
    let Some(dir) = space_dir(db, &env.space_id)? else { return Ok(()) };
    let old = current_file_path(db, "environments", id)?;
    let base = PathBuf::from(ENV_DIR);
    let stem = slug(&env.name);
    let keep = old.as_deref().filter(|rel| stem_matches(rel, &stem));
    let rel = match keep {
        Some(rel) => rel.to_string(),
        None => unique_path(&dir, &base, &stem, &taken_paths(db, "environments", &env.space_id, id)?, None),
    };
    write_atomic(&dir.join(&rel), &render(&environment_document(&env.id, &env.name, &env.variables))?)?;
    if let Some(old) = old.filter(|o| *o != rel) {
        remove_file(&dir, &old);
    }
    set_file_path(db, "environments", id, Some(&rel))
}

pub fn remove_environment(db: &DatabaseManager, id: &str) -> SyncResult<()> {
    let Ok(env) = db.get_environment(id) else { return Ok(()) };
    if let (Some(dir), Some(rel)) = (space_dir(db, &env.space_id)?, current_file_path(db, "environments", id)?) {
        remove_file(&dir, &rel);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Reading (folder -> database)

struct Scan {
    templates: Vec<(String, Map<String, Value>)>,
    environments: Vec<(String, Map<String, Value>)>,
    workspace: Option<Map<String, Value>>,
    errors: Vec<FileError>,
}

fn is_yaml(path: &Path) -> bool {
    matches!(path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref(), Some("yaml" | "yml"))
}

fn scan(dir: &Path) -> Scan {
    let mut out = Scan { templates: vec![], environments: vec![], workspace: None, errors: vec![] };
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "node_modules" {
                continue; // .git, editor folders, temp files
            }
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if !is_yaml(&path) {
                continue;
            }
            let rel = rel_string(path.strip_prefix(dir).unwrap_or(&path));
            let parsed = std::fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|t| parse_yaml(&t));
            match parsed {
                Err(message) => out.errors.push(FileError { path: rel, message }),
                Ok(doc) if rel == WORKSPACE_FILE => out.workspace = Some(doc),
                Ok(doc) if rel.starts_with(&format!("{ENV_DIR}/")) => out.environments.push((rel, doc)),
                Ok(doc) => out.templates.push((rel, doc)),
            }
        }
    }
    out
}

fn folder_of(rel: &str) -> String {
    let parts: Vec<&str> = rel.split('/').collect();
    parts[..parts.len().saturating_sub(1)].join(" / ")
}

fn name_from_file(rel: &str) -> String {
    Path::new(rel).file_stem().map(|s| s.to_string_lossy().replace('-', " ")).unwrap_or_else(|| "Untitled".into())
}

/// Give a hand-written file without an `id` one, and write it back.
fn ensure_id(dir: &Path, rel: &str, doc: &mut Map<String, Value>) -> String {
    if let Some(id) = doc.get("id").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
        return id.to_string();
    }
    let id = uuid::Uuid::new_v4().to_string();
    doc.insert("id".into(), Value::String(id.clone()));
    if let Ok(text) = render(&Value::Object(doc.clone())) {
        let _ = write_atomic(&dir.join(rel), &text);
    }
    id
}

/// Read the folder into SQLite. Returns whether anything changed, plus file errors.
/// Rows whose file failed to parse are kept, so a merge conflict never deletes data.
pub fn load_from_disk(db: &DatabaseManager, space_id: &str) -> SyncResult<(bool, SyncStatus)> {
    let space = db.get_space(space_id)?;
    let Some(dir_str) = space.sync_dir.clone() else {
        return Err(SyncError::Invalid("Space is not linked to a folder".into()));
    };
    let dir = PathBuf::from(&dir_str);
    let mut status = SyncStatus { space_id: space_id.into(), dir: dir_str, missing: false, errors: vec![] };
    if !dir.is_dir() {
        status.missing = true;
        return Ok((false, status));
    }

    let mut found = scan(&dir);
    let errored: HashSet<String> = found.errors.iter().map(|e| e.path.clone()).collect();
    let mut changed = false;

    // Space name and colour are shared through kangpos.yaml.
    if let Some(ws) = &found.workspace {
        let name = ws.get("name").and_then(Value::as_str).map(str::to_string);
        let color = ws.get("color").and_then(Value::as_str).map(str::to_string);
        let conn = db.conn();
        if let Some(name) = name.filter(|n| !n.trim().is_empty() && *n != space.name) {
            conn.execute("UPDATE spaces SET name = ?1 WHERE id = ?2", params![name, space_id])?;
            changed = true;
        }
        if color.is_some() && color != space.color {
            conn.execute("UPDATE spaces SET color = ?1 WHERE id = ?2", params![color, space_id])?;
            changed = true;
        }
    }

    // Templates
    let mut seen = HashSet::new();
    for (rel, doc) in found.templates.iter_mut() {
        let id = ensure_id(&dir, rel, doc);
        if !seen.insert(id.clone()) {
            status.errors.push(FileError { path: rel.clone(), message: format!("Duplicate id {id} (another file already uses it); give this file a new id or delete the line") });
            continue;
        }
        let name = doc.get("name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| name_from_file(rel));
        let mut request = doc.clone();
        request.remove("id");
        request.remove("name");
        let request = clean(&Value::Object(request));
        let folder = folder_of(rel);
        let request_text = serde_json::to_string(&request).map_err(|e| SyncError::Invalid(e.to_string()))?;

        let conn = db.conn();
        let existing: Option<(String, String, String, String, Option<String>)> = conn
            .query_row(
                "SELECT space_id, name, folder, request, file_path FROM templates WHERE id = ?1",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        match existing {
            Some((other, ..)) if other != space_id => {
                status.errors.push(FileError { path: rel.clone(), message: format!("id {id} belongs to a template in another space") });
                seen.remove(&id);
            }
            Some((_, old_name, old_folder, old_request, old_path)) => {
                let old_clean = clean(&serde_json::from_str(&old_request).unwrap_or(Value::Null));
                if old_name != name || old_folder != folder || old_clean != request || old_path.as_deref() != Some(rel.as_str()) {
                    conn.execute(
                        "UPDATE templates SET name = ?1, folder = ?2, request = ?3, file_path = ?4, updated_at = datetime('now') WHERE id = ?5",
                        params![name, folder, request_text, rel.as_str(), id],
                    )?;
                    changed = true;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO templates (id, space_id, name, folder, request, file_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![id, space_id, name, folder, request_text, rel.as_str()],
                )?;
                changed = true;
            }
        }
    }
    changed |= delete_missing(db, "templates", space_id, &seen, &errored)?;

    // Environments: keep local secret values when the file omits them.
    let mut seen = HashSet::new();
    for (rel, doc) in found.environments.iter_mut() {
        let id = ensure_id(&dir, rel, doc);
        if !seen.insert(id.clone()) {
            status.errors.push(FileError { path: rel.clone(), message: format!("Duplicate id {id}") });
            continue;
        }
        let name = doc.get("name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| name_from_file(rel));
        let conn = db.conn();
        let existing: Option<(String, String, String, Option<String>)> = conn
            .query_row(
                "SELECT space_id, name, variables, file_path FROM environments WHERE id = ?1",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        if let Some((other, ..)) = &existing {
            if other != space_id {
                status.errors.push(FileError { path: rel.clone(), message: format!("id {id} belongs to an environment in another space") });
                seen.remove(&id);
                continue;
            }
        }
        let local: HashMap<String, String> = existing
            .as_ref()
            .and_then(|(_, _, vars, _)| serde_json::from_str::<Value>(vars).ok())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| Some((v.get("key")?.as_str()?.to_string(), v.get("value")?.as_str()?.to_string())))
            .collect();
        let variables: Vec<Value> = doc
            .get("variables")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| {
                let mut var = v.as_object()?.clone();
                let key = var.get("key")?.as_str()?.to_string();
                var.entry("enabled").or_insert(Value::Bool(true));
                if var.get("value").and_then(Value::as_str).unwrap_or("").is_empty() {
                    let fallback = if var.get("secret").and_then(Value::as_bool) == Some(true) {
                        local.get(&key).cloned().unwrap_or_default()
                    } else {
                        String::new()
                    };
                    var.insert("value".into(), Value::String(fallback));
                }
                Some(Value::Object(var))
            })
            .collect();
        let vars_value = Value::Array(variables);
        let vars_text = serde_json::to_string(&vars_value).map_err(|e| SyncError::Invalid(e.to_string()))?;
        match existing {
            Some((_, old_name, old_vars, old_path)) => {
                let old_value: Value = serde_json::from_str(&old_vars).unwrap_or(Value::Null);
                if old_name != name || clean(&old_value) != clean(&vars_value) || old_path.as_deref() != Some(rel.as_str()) {
                    conn.execute(
                        "UPDATE environments SET name = ?1, variables = ?2, file_path = ?3, updated_at = datetime('now') WHERE id = ?4",
                        params![name, vars_text, rel.as_str(), id],
                    )?;
                    changed = true;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO environments (id, space_id, name, variables, file_path) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, space_id, name, vars_text, rel.as_str()],
                )?;
                changed = true;
            }
        }
    }
    changed |= delete_missing(db, "environments", space_id, &seen, &errored)?;

    status.errors.extend(found.errors);
    status.errors.sort_by(|a, b| a.path.cmp(&b.path));
    Ok((changed, status))
}

/// Delete rows whose file is gone (but not rows whose file only failed to parse).
fn delete_missing(db: &DatabaseManager, table: &str, space_id: &str, seen: &HashSet<String>, errored: &HashSet<String>) -> SyncResult<bool> {
    let conn = db.conn();
    let rows: Vec<(String, Option<String>)> = {
        let mut stmt = conn.prepare(&format!("SELECT id, file_path FROM {table} WHERE space_id = ?1"))?;
        let mapped = stmt.query_map([space_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        mapped.collect::<Result<_, _>>()?
    };
    let mut changed = false;
    for (id, path) in rows {
        let parse_failed = path.as_ref().is_some_and(|p| errored.contains(p));
        if !seen.contains(&id) && !parse_failed {
            if table == "environments" {
                conn.execute("UPDATE spaces SET active_environment_id = NULL WHERE active_environment_id = ?1", [&id])?;
            }
            conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [&id])?;
            changed = true;
        }
    }
    Ok(changed)
}

// ---------------------------------------------------------------------------
// Link / unlink / open

fn canonical_dir(path: &str) -> SyncResult<PathBuf> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err(SyncError::Invalid("Choose a full folder path".into()));
    }
    std::fs::create_dir_all(&path)?;
    let canon = dunce_canonical(&path)?;
    let lower = canon.to_string_lossy().to_lowercase();
    if lower.starts_with(r"c:\windows") || lower.starts_with(r"c:\program files") {
        return Err(SyncError::Invalid("Choose a folder outside the system folders".into()));
    }
    Ok(canon)
}

/// `canonicalize` without Windows' `\\?\` prefix (kept readable in the UI).
fn dunce_canonical(path: &Path) -> std::io::Result<PathBuf> {
    let canon = std::fs::canonicalize(path)?;
    let text = canon.to_string_lossy();
    Ok(match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => canon,
    })
}

fn ensure_not_linked_elsewhere(db: &DatabaseManager, dir: &Path, space_id: Option<&str>) -> SyncResult<()> {
    for other in db.list_spaces()? {
        if Some(other.id.as_str()) == space_id {
            continue;
        }
        if other.sync_dir.as_deref().map(PathBuf::from).as_deref() == Some(dir) {
            return Err(SyncError::Invalid(format!("This folder is already linked to the space \"{}\"", other.name)));
        }
    }
    Ok(())
}

/// Link a space to a folder and write its templates and environments there.
pub fn link(db: &DatabaseManager, space_id: &str, path: &str) -> SyncResult<Space> {
    let dir = canonical_dir(path)?;
    if dir.join(WORKSPACE_FILE).exists() {
        return Err(SyncError::Invalid(
            "That folder already holds a KangPos workspace. Use \"Open workspace folder\" to add it as a new space, or pick an empty folder.".into(),
        ));
    }
    ensure_not_linked_elsewhere(db, &dir, Some(space_id))?;
    let dir_text = dir.to_string_lossy().into_owned();
    {
        let conn = db.conn();
        conn.execute("UPDATE spaces SET sync_dir = ?1 WHERE id = ?2", params![dir_text, space_id])?;
        conn.execute("UPDATE templates SET file_path = NULL WHERE space_id = ?1", [space_id])?;
        conn.execute("UPDATE environments SET file_path = NULL WHERE space_id = ?1", [space_id])?;
    }
    let space = db.get_space(space_id)?;
    write_workspace_file(&dir, &space)?;
    for tpl in db.list_templates(space_id)? {
        write_template(db, &tpl.id)?;
    }
    for env in db.list_environments(space_id)? {
        write_environment(db, &env.id)?;
    }
    Ok(space)
}

/// Stop syncing. Everything stays in the local database; files are left alone.
pub fn unlink(db: &DatabaseManager, space_id: &str) -> SyncResult<Space> {
    {
        let conn = db.conn();
        conn.execute("UPDATE spaces SET sync_dir = NULL WHERE id = ?1", [space_id])?;
        conn.execute("UPDATE templates SET file_path = NULL WHERE space_id = ?1", [space_id])?;
        conn.execute("UPDATE environments SET file_path = NULL WHERE space_id = ?1", [space_id])?;
    }
    Ok(db.get_space(space_id)?)
}

/// Add a folder that already holds a KangPos workspace (e.g. a git clone) as a new space.
pub fn open_workspace(db: &DatabaseManager, path: &str) -> SyncResult<(Space, SyncStatus)> {
    let dir = canonical_dir(path)?;
    let file = dir.join(WORKSPACE_FILE);
    if !file.exists() {
        return Err(SyncError::Invalid(
            "No kangpos.yaml in that folder. To start syncing an existing space, use \"Link to folder\" on it instead.".into(),
        ));
    }
    ensure_not_linked_elsewhere(db, &dir, None)?;
    let doc = std::fs::read_to_string(&file)
        .map_err(SyncError::from)
        .and_then(|t| parse_yaml(&t).map_err(|e| SyncError::Invalid(format!("kangpos.yaml: {e}"))))?;
    if let Some(version) = doc.get("kangpos").and_then(Value::as_u64) {
        if version > FORMAT_VERSION {
            return Err(SyncError::Invalid(format!("This workspace uses format {version}; update KangPos to open it")));
        }
    }
    let name = doc
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Workspace".into()));
    let color = doc.get("color").and_then(Value::as_str);
    let space = db.create_space(&name, color)?;
    db.conn().execute(
        "UPDATE spaces SET sync_dir = ?1 WHERE id = ?2",
        params![dir.to_string_lossy().into_owned(), space.id],
    )?;
    match load_from_disk(db, &space.id) {
        Ok((_, status)) => Ok((db.get_space(&space.id)?, status)),
        Err(e) => {
            // Don't leave a half-made space behind.
            let _ = db.delete_space(&space.id);
            Err(e)
        }
    }
}

// ---------------------------------------------------------------------------
// Watching

/// Owns one folder watcher per linked space and serialises disk <-> database work.
pub struct SyncManager {
    db: Arc<DatabaseManager>,
    app: Mutex<Option<AppHandle>>,
    watchers: Mutex<HashMap<String, Debouncer<RecommendedWatcher>>>,
    status: Arc<Mutex<HashMap<String, SyncStatus>>>,
    /// Held while the database and the folder are being brought in line.
    lock: Arc<Mutex<()>>,
}

impl SyncManager {
    pub fn new(db: Arc<DatabaseManager>) -> Self {
        Self {
            db,
            app: Mutex::new(None),
            watchers: Mutex::new(HashMap::new()),
            status: Arc::new(Mutex::new(HashMap::new())),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn set_app(&self, app: AppHandle) {
        *self.app.lock() = Some(app);
    }

    /// Run a database change plus its file writes without a watcher reload in between.
    pub fn exclusive<T>(&self, f: impl FnOnce() -> T) -> T {
        let _guard = self.lock.lock();
        f()
    }

    pub fn status(&self, space_id: &str) -> Option<SyncStatus> {
        self.status.lock().get(space_id).cloned()
    }

    /// Load from disk once, then watch. Safe to call again (restarts the watcher).
    pub fn start(&self, space_id: &str) -> SyncResult<SyncStatus> {
        self.stop(space_id);
        let space = self.db.get_space(space_id)?;
        let Some(dir) = space.sync_dir.clone() else {
            return Err(SyncError::Invalid("Space is not linked to a folder".into()));
        };
        let (changed, status) = self.exclusive(|| load_from_disk(&self.db, space_id))?;
        self.status.lock().insert(space_id.into(), status.clone());
        // At startup this runs in the background, so tell the UI when it's done.
        let app = self.app.lock().clone();
        if let Some(app) = &app {
            let _ = app.emit(SYNC_EVENT, SyncEvent { space_id: space_id.into(), changed, status: status.clone() });
        }
        if status.missing {
            return Ok(status);
        }

        let db = Arc::clone(&self.db);
        let statuses = Arc::clone(&self.status);
        let lock = Arc::clone(&self.lock);
        let id = space_id.to_string();
        let mut debouncer = new_debouncer(Duration::from_millis(400), move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            // Our own temp files and editors' swap files are noise.
            if !events.iter().any(|e| is_yaml(&e.path) || e.path.is_dir() || !e.path.exists()) {
                return;
            }
            let result = {
                let _guard = lock.lock();
                load_from_disk(&db, &id)
            };
            let (changed, status) = match result {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[Sync] {id}: {e}");
                    return;
                }
            };
            let status_changed = statuses.lock().insert(id.clone(), status.clone()).as_ref() != Some(&status);
            if changed || status_changed {
                if let Some(app) = &app {
                    let _ = app.emit(SYNC_EVENT, SyncEvent { space_id: id.clone(), changed, status });
                }
            }
        })
        .map_err(|e| SyncError::Invalid(format!("Cannot watch folder: {e}")))?;
        debouncer
            .watcher()
            .watch(Path::new(&dir), RecursiveMode::Recursive)
            .map_err(|e| SyncError::Invalid(format!("Cannot watch folder: {e}")))?;
        self.watchers.lock().insert(space_id.into(), debouncer);
        Ok(status)
    }

    pub fn stop(&self, space_id: &str) {
        self.watchers.lock().remove(space_id);
        self.status.lock().remove(space_id);
    }

    /// Start every linked space (app startup).
    pub fn start_all(&self) {
        let Ok(spaces) = self.db.list_spaces() else { return };
        for space in spaces.into_iter().filter(|s| s.sync_dir.is_some()) {
            if let Err(e) = self.start(&space.id) {
                eprintln!("[Sync] could not start {}: {e}", space.name);
            }
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::storage::{CreateTemplateInput, UpdateTemplateInput};
    use serde_json::json;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kangpos-sync-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn setup() -> (DatabaseManager, Space, PathBuf) {
        let db = DatabaseManager::in_memory().unwrap();
        let space = db.create_space("Payments", Some("#93C5FD")).unwrap();
        (db, space, temp_dir())
    }

    fn add_template(db: &DatabaseManager, space: &str, name: &str, folder: &str) -> String {
        db.create_templates(vec![CreateTemplateInput {
            space_id: space.into(),
            name: name.into(),
            folder: folder.into(),
            request: json!({
                "method": "GET",
                "url": "{{baseUrl}}/contacts/{{id}}",
                "query": [],
                "headers": [{"key": "Accept", "value": "application/json", "enabled": true}],
                "body": {"type": "none", "raw": "", "fields": []},
                "auth": {"type": "none"},
                "params": [{"name": "id", "default": "", "required": true}]
            }),
        }])
        .unwrap()
        .remove(0)
        .id
    }

    #[test]
    fn link_writes_clean_readable_files() {
        let (db, space, dir) = setup();
        add_template(&db, &space.id, "Get contact", "Contacts / Admin");
        let env = db
            .create_environment(&space.id, "Dev", &json!([
                {"key": "baseUrl", "value": "https://dev.test", "enabled": true},
                {"key": "token", "value": "s3cret", "enabled": true, "secret": true}
            ]))
            .unwrap();

        link(&db, &space.id, dir.to_str().unwrap()).unwrap();

        let ws = std::fs::read_to_string(dir.join("kangpos.yaml")).unwrap();
        assert!(ws.starts_with("kangpos: 1\nname: Payments\n"), "{ws}");

        let tpl = std::fs::read_to_string(dir.join("Contacts/Admin/get-contact.yaml")).unwrap();
        let lines: Vec<&str> = tpl.lines().collect();
        assert!(lines[0].starts_with("id: "));
        assert_eq!(lines[1], "name: Get contact");
        assert_eq!(lines[2], "method: GET");
        assert!(!tpl.contains("body:") && !tpl.contains("auth:") && !tpl.contains("query:"), "{tpl}");

        let env_file = std::fs::read_to_string(dir.join("environments/dev.yaml")).unwrap();
        assert!(env_file.contains("https://dev.test"));
        assert!(!env_file.contains("s3cret"), "secret leaked: {env_file}");
        assert_eq!(db.get_environment(&env.id).unwrap().variables[1]["value"], "s3cret");

        // A fresh load finds nothing to change (no echo loop after our own writes).
        let (changed, status) = load_from_disk(&db, &space.id).unwrap();
        assert!(!changed);
        assert!(status.errors.is_empty(), "{:?}", status.errors);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn renaming_moves_the_file_and_deleting_removes_it() {
        let (db, space, dir) = setup();
        let id = add_template(&db, &space.id, "Get contact", "Contacts");
        link(&db, &space.id, dir.to_str().unwrap()).unwrap();

        db.update_template(&id, UpdateTemplateInput { name: Some("Fetch contact".into()), folder: Some("People".into()), request: None }).unwrap();
        write_template(&db, &id).unwrap();
        assert!(dir.join("People/fetch-contact.yaml").exists());
        assert!(!dir.join("Contacts").exists(), "empty folder left behind");

        remove_template(&db, &id).unwrap();
        db.delete_template(&id).unwrap();
        assert!(!dir.join("People").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn external_edits_are_loaded_and_bad_files_keep_their_data() {
        let (db, space, dir) = setup();
        let id = add_template(&db, &space.id, "Get contact", "Contacts");
        link(&db, &space.id, dir.to_str().unwrap()).unwrap();

        // Someone edits the URL in git.
        let path = dir.join("Contacts/get-contact.yaml");
        let text = std::fs::read_to_string(&path).unwrap().replace("/contacts/", "/people/");
        std::fs::write(&path, text).unwrap();
        // ...and adds a hand-written template without an id or name.
        std::fs::write(dir.join("Contacts/list-contacts.yaml"), "method: GET\nurl: '{{baseUrl}}/contacts'\nquery:\n  - key: page\n    value: 2\n    enabled: true\n").unwrap();

        let (changed, status) = load_from_disk(&db, &space.id).unwrap();
        assert!(changed);
        assert!(status.errors.is_empty());
        let templates = db.list_templates(&space.id).unwrap();
        assert_eq!(templates.len(), 2);
        let edited = templates.iter().find(|t| t.id == id).unwrap();
        assert_eq!(edited.request["url"], "{{baseUrl}}/people/{{id}}");
        let added = templates.iter().find(|t| t.id != id).unwrap();
        assert_eq!(added.name, "list contacts");
        assert_eq!(added.folder, "Contacts");
        assert_eq!(added.request["query"][0]["value"], "2", "number coerced to string");
        assert!(std::fs::read_to_string(dir.join("Contacts/list-contacts.yaml")).unwrap().starts_with("id: "));

        // A merge conflict makes the file unreadable: report it, keep the template.
        std::fs::write(&path, "<<<<<<< HEAD\nmethod: GET\n=======\n: :\n>>>>>>> branch\n").unwrap();
        let (_, status) = load_from_disk(&db, &space.id).unwrap();
        assert_eq!(status.errors.len(), 1);
        assert_eq!(status.errors[0].path, "Contacts/get-contact.yaml");
        assert!(db.list_templates(&space.id).unwrap().iter().any(|t| t.id == id));

        // Deleting the file removes the template.
        std::fs::remove_file(&path).unwrap();
        let (changed, _) = load_from_disk(&db, &space.id).unwrap();
        assert!(changed);
        assert!(!db.list_templates(&space.id).unwrap().iter().any(|t| t.id == id));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn secrets_survive_a_reload_and_open_creates_a_space() {
        let (db, space, dir) = setup();
        let env = db
            .create_environment(&space.id, "Dev", &json!([{"key": "token", "value": "s3cret", "enabled": true, "secret": true}]))
            .unwrap();
        link(&db, &space.id, dir.to_str().unwrap()).unwrap();

        // Reload from the file (which has no value): the local secret stays.
        let path = dir.join("environments/dev.yaml");
        let text = std::fs::read_to_string(&path).unwrap();
        // Match the writer's list indentation.
        let indent = if text.contains("\n- key") { "" } else { "  " };
        std::fs::write(&path, format!("{text}{indent}- key: tenant\n{indent}  value: acme\n{indent}  enabled: true\n")).unwrap();
        load_from_disk(&db, &space.id).unwrap();
        let vars = db.get_environment(&env.id).unwrap().variables;
        assert_eq!(vars[0]["value"], "s3cret");
        assert_eq!(vars[1]["value"], "acme");

        // Linking the same folder twice, or opening it while linked, is refused.
        let other = db.create_space("Other", None).unwrap();
        assert!(link(&db, &other.id, dir.to_str().unwrap()).is_err());
        assert!(open_workspace(&db, dir.to_str().unwrap()).is_err());

        // A clone elsewhere opens as a new space with its templates.
        unlink(&db, &space.id).unwrap();
        db.delete_space(&space.id).unwrap();
        let (opened, status) = open_workspace(&db, dir.to_str().unwrap()).unwrap();
        assert_eq!(opened.name, "Payments");
        assert_eq!(opened.color.as_deref(), Some("#93C5FD"));
        assert!(status.errors.is_empty());
        assert_eq!(db.list_environments(&opened.id).unwrap().len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn slugs_and_folder_names_are_safe() {
        assert_eq!(slug("Get contact"), "get-contact");
        assert_eq!(slug("  Create / Update: user!! "), "create-update-user");
        assert_eq!(slug("???"), "untitled");
        assert_eq!(slug("CON"), "con_");
        assert_eq!(folder_dirs("Contacts / Admin: users / "), vec!["Contacts", "Admin_ users"]);
        assert_eq!(folder_dirs("environments"), vec!["_environments"]);
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod format_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_body_is_a_readable_block() {
        let doc = template_document(
            "abc",
            "Create post",
            &json!({
                "method": "POST",
                "url": "{{baseUrl}}/posts",
                "body": {"type": "json", "raw": "{\n  \"title\": \"{{title}}\",\n  \"userId\": 1\n}", "fields": []},
                "params": [{"name": "title", "default": "", "required": true}],
                "headers": [{"key": "X-Count", "value": "123", "enabled": true}]
            }),
        );
        let text = render(&doc).unwrap();
        println!("{text}");
        assert!(text.contains("raw: |-\n"), "{text}");
        // Numeric-looking strings stay strings when read back.
        let back = parse_yaml(&text).unwrap();
        assert_eq!(back["headers"][0]["value"], "123");
        assert_eq!(back["body"]["raw"], "{\n  \"title\": \"{{title}}\",\n  \"userId\": 1\n}");
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod watcher_tests {
    use super::*;
    use crate::storage::CreateTemplateInput;
    use serde_json::json;

    /// Wait up to `secs` for `check` to pass (the watcher debounces by 400 ms).
    fn eventually(secs: u64, mut check: impl FnMut() -> bool) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_secs(secs);
        while std::time::Instant::now() < deadline {
            if check() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        false
    }

    #[test]
    fn watcher_picks_up_edits_made_outside_the_app() {
        let db = Arc::new(DatabaseManager::in_memory().unwrap());
        let space = db.create_space("Payments", None).unwrap();
        let id = db
            .create_templates(vec![CreateTemplateInput {
                space_id: space.id.clone(),
                name: "Get contact".into(),
                folder: "".into(),
                request: json!({"method": "GET", "url": "https://a.test/contacts"}),
            }])
            .unwrap()
            .remove(0)
            .id;
        let dir = std::env::temp_dir().join(format!("kangpos-watch-{}", uuid::Uuid::new_v4()));
        let manager = SyncManager::new(Arc::clone(&db));
        manager.exclusive(|| link(&db, &space.id, dir.to_str().unwrap())).unwrap();
        let canon = PathBuf::from(db.get_space(&space.id).unwrap().sync_dir.unwrap());
        let status = manager.start(&space.id).unwrap();
        assert!(status.errors.is_empty() && !status.missing);

        // Edit like git or VS Code would.
        let path = canon.join("get-contact.yaml");
        let text = std::fs::read_to_string(&path).unwrap().replace("a.test", "b.test");
        std::fs::write(&path, text).unwrap();
        assert!(
            eventually(5, || db.get_template(&id).unwrap().request["url"] == "https://b.test/contacts"),
            "edit was not loaded"
        );

        // A new file appears.
        std::fs::write(canon.join("ping.yaml"), "name: Ping\nmethod: GET\nurl: https://b.test/ping\n").unwrap();
        assert!(eventually(5, || db.list_templates(&space.id).unwrap().len() == 2), "new file was not loaded");

        // A broken file is reported in the status without losing the template.
        std::fs::write(&path, "method: [unclosed\n").unwrap();
        assert!(eventually(5, || manager.status(&space.id).is_some_and(|s| s.errors.len() == 1)), "error not reported");
        assert!(db.get_template(&id).is_ok());

        manager.stop(&space.id);
        std::fs::remove_dir_all(&canon).unwrap();
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod dropdown_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dropdown_inputs_round_trip_in_order() {
        let doc = template_document(
            "abc",
            "List orders",
            &json!({"method": "GET", "url": "x", "params": [
                {"options": ["open", "closed"], "required": true, "default": "open", "type": "select", "name": "status"}
            ]}),
        );
        let text = render(&doc).unwrap();
        assert!(
            text.contains("- name: status\n  type: select\n  default: open\n  required: true\n  options:\n  - open\n  - closed\n"),
            "{text}"
        );
        let back = parse_yaml(&text).unwrap();
        assert_eq!(back["params"][0]["options"], json!(["open", "closed"]));
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod script_file_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scripts_are_blocks_and_empty_ones_are_left_out() {
        let with = render(&template_document("a", "Login", &json!({
            "method": "POST", "url": "x", "auth": {"type": "none"},
            "scripts": {"before": "", "after": "pm.test('ok', () => {\n  pm.response.to.have.status(200);\n});"}
        }))).unwrap();
        assert!(with.ends_with("scripts:\n  after: |-\n    pm.test('ok', () => {\n      pm.response.to.have.status(200);\n    });\n"), "{with}");

        let without = render(&template_document("a", "Login", &json!({
            "method": "GET", "url": "x", "scripts": {"before": "  ", "after": ""}
        }))).unwrap();
        assert!(!without.contains("scripts"), "{without}");
    }
}
