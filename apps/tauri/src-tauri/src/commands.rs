use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

/// Window state structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

/// Show a native notification
#[tauri::command]
pub async fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: Option<String>,
) -> Result<(), String> {
    info!("Showing notification: {}", title);
    app.notification()
        .builder()
        .title(&title)
        .body(body.as_deref().unwrap_or(""))
        .show()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Set badge count (macOS only - placeholder)
#[tauri::command]
pub async fn set_badge_count(_app: tauri::AppHandle, count: i32) -> Result<(), String> {
    info!("Setting badge count to: {}", count);
    Ok(())
}

/// Check for app updates (desktop only)
#[cfg(desktop)]
#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;

    info!("Manual update check requested");

    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            info!("Update found: {}", version);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                    warn!("Failed to install update: {}", e);
                }
            });
            Ok(format!("Update {} available - downloading...", version))
        }
        Ok(None) => {
            info!("No updates available");
            Ok("No updates available".to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn check_for_updates(_app: tauri::AppHandle) -> Result<String, String> {
    Ok("Updates not available on this platform".to_string())
}

/// Get OS theme (light/dark)
#[tauri::command]
pub async fn get_os_theme() -> Result<String, String> {
    Ok("system".to_string())
}

/// Get saved window state
#[tauri::command]
pub async fn get_window_state(app: tauri::AppHandle) -> Result<WindowState, String> {
    let store = app.store(".nubo-settings.json").map_err(|e| e.to_string())?;

    let state = store
        .get("window_state")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    Ok(state)
}

/// Save window state
#[tauri::command]
pub async fn save_window_state_cmd(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        crate::save_window_state(&app, &window);
    }
    Ok(())
}

/// Check if online
#[tauri::command]
pub async fn is_online() -> Result<bool, String> {
    Ok(true)
}

/// Get app version
#[tauri::command]
pub async fn get_app_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

/// Rollback to previous version
#[tauri::command]
pub async fn rollback_update(app: tauri::AppHandle) -> Result<String, String> {
    let store = app.store(".nubo-settings.json").map_err(|e| e.to_string())?;

    let last_version = store
        .get("last_version")
        .and_then(|v| v.as_str().map(String::from));

    match last_version {
        Some(version) => {
            info!("Rollback requested to version: {}", version);
            Ok(format!(
                "Previous version was {}. Please download from GitHub releases.",
                version
            ))
        }
        None => {
            warn!("No previous version found for rollback");
            Ok("No previous version available for rollback".to_string())
        }
    }
}
