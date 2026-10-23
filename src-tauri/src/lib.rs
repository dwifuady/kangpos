pub mod commands;
pub mod http;
pub mod storage;
pub mod sync;

use commands::AppState;
use std::sync::Arc;
use storage::{get_default_db_path, DatabaseManager};
use tauri::window::{Effect, EffectsBuilder};
use tauri::Manager;

/// Whether the Windows 11 Mica backdrop was applied to the main window.
/// The frontend only switches to translucent surfaces when this is true.
pub struct MicaEnabled(pub bool);

#[tauri::command]
fn is_mica_enabled(state: tauri::State<'_, MicaEnabled>) -> bool {
    state.0
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = get_default_db_path()?;
    println!("[Startup] Database path: {:?}", db_path);
    let db = DatabaseManager::new(db_path)?;

    let db = Arc::new(db);
    let sync_manager = Arc::new(sync::SyncManager::new(Arc::clone(&db)));
    let app_state = AppState {
        db,
        http: Arc::new(http::HttpState::default()),
        sync: Arc::clone(&sync_manager),
    };

    tauri::Builder::default()
        .setup(move |app| {
            let mica = app
                .get_webview_window("main")
                .map(|w| {
                    w.set_effects(EffectsBuilder::new().effect(Effect::Mica).build())
                        .is_ok()
                })
                .unwrap_or(false);
            app.manage(MicaEnabled(mica));

            // Load and watch every space that is linked to a folder.
            sync_manager.set_app(app.handle().clone());
            let manager = Arc::clone(&sync_manager);
            std::thread::spawn(move || manager.start_all());
            Ok(())
        })
        .manage(app_state)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            is_mica_enabled,
            commands::list_spaces,
            commands::create_space,
            commands::update_space,
            commands::delete_space,
            commands::list_environments,
            commands::create_environment,
            commands::update_environment,
            commands::delete_environment,
            commands::list_templates,
            commands::create_templates,
            commands::update_template,
            commands::delete_template,
            commands::list_template_folders,
            commands::create_template_folder,
            commands::rename_template_folder,
            commands::delete_template_folder,
            commands::arrange_template_folders,
            commands::arrange_templates,
            commands::list_tabs,
            commands::create_tab,
            commands::update_tab,
            commands::delete_tab,
            commands::reorder_tabs,
            commands::get_app_state,
            commands::set_app_state,
            commands::send_request,
            commands::cancel_request,
            commands::read_import_file,
            commands::save_response_file,
            commands::link_space_folder,
            commands::unlink_space_folder,
            commands::open_workspace_folder,
            commands::get_sync_status,
            commands::reload_space_folder,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}
