mod state;

use state::{
    apply_renames_impl, create_batch_impl, download_required_models_impl, get_history_impl, get_model_status_impl,
    get_settings_impl, save_settings_impl, save_suggestion_impl, set_approval_impl, undo_last_batch_impl, AppState,
    FileRecord, ModelStatus, NamingSettings,
};
use tauri::Manager;

#[tauri::command]
fn create_batch(app: tauri::AppHandle, paths: Vec<String>) -> Result<state::BatchWithFiles, String> {
    create_batch_impl(&app, paths).map_err(|error| error.to_string())
}

#[tauri::command]
fn analyze_batch(app: tauri::AppHandle, batch_id: String) -> Result<Vec<FileRecord>, String> {
    state::analyze_batch_impl(&app, &batch_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_suggestion(app: tauri::AppHandle, file_id: String, suggested_name: String) -> Result<FileRecord, String> {
    save_suggestion_impl(&app, &file_id, &suggested_name).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_approval(app: tauri::AppHandle, file_ids: Vec<String>, approval: String) -> Result<Vec<FileRecord>, String> {
    set_approval_impl(&app, file_ids, &approval).map_err(|error| error.to_string())
}

#[tauri::command]
fn apply_renames(app: tauri::AppHandle, batch_id: String) -> Result<Vec<FileRecord>, String> {
    apply_renames_impl(&app, &batch_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn undo_last_batch(app: tauri::AppHandle) -> Result<(), String> {
    undo_last_batch_impl(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_history(app: tauri::AppHandle) -> Result<Vec<state::BatchRecord>, String> {
    get_history_impl(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<NamingSettings, String> {
    get_settings_impl(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: NamingSettings) -> Result<NamingSettings, String> {
    save_settings_impl(&app, settings).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_model_status(app: tauri::AppHandle) -> Result<ModelStatus, String> {
    get_model_status_impl(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn download_required_models(app: tauri::AppHandle) -> Result<ModelStatus, String> {
    download_required_models_impl(&app).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = AppState::new(&app_handle).map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_batch,
            analyze_batch,
            save_suggestion,
            set_approval,
            apply_renames,
            undo_last_batch,
            get_history,
            get_settings,
            save_settings,
            get_model_status,
            download_required_models
        ])
        .run(tauri::generate_context!())
        .expect("failed to run FileSift");
}
