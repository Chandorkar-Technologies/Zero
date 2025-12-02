use tauri_plugin_notification::NotificationExt;

/// Show a native notification
#[tauri::command]
pub async fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: Option<String>,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(body.as_deref().unwrap_or(""))
        .show()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Set badge count (macOS only - currently a no-op as badge API requires cocoa)
#[tauri::command]
pub async fn set_badge_count(_app: tauri::AppHandle, _count: i32) -> Result<(), String> {
    // Badge count on macOS requires cocoa bindings which add complexity
    // For now, this is a placeholder that succeeds silently
    Ok(())
}

/// Check for app updates (desktop only)
#[cfg(desktop)]
#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            // Start download and install in background
            tauri::async_runtime::spawn(async move {
                if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                    eprintln!("Failed to install update: {}", e);
                }
            });
            Ok(format!("Update {} available - downloading...", version))
        }
        Ok(None) => Ok("No updates available".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn check_for_updates(_app: tauri::AppHandle) -> Result<String, String> {
    Ok("Updates not available on this platform".to_string())
}
