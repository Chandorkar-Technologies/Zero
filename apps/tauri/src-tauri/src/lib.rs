use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

mod commands;

/// Window state for persistence
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

/// App settings stored persistently
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub window_state: WindowState,
    pub last_version: Option<String>,
    pub update_check_enabled: bool,
    pub notifications_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            window_state: WindowState {
                width: 1400.0,
                height: 900.0,
                x: 100,
                y: 100,
                maximized: false,
            },
            last_version: None,
            update_check_enabled: true,
            notifications_enabled: true,
        }
    }
}

/// Load settings from store
fn load_settings(app: &tauri::AppHandle) -> AppSettings {
    let store = match app.store(".nubo-settings.json") {
        Ok(s) => s,
        Err(e) => {
            warn!("Failed to open settings store: {}", e);
            return AppSettings::default();
        }
    };

    let window_state = store
        .get("window_state")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let last_version = store
        .get("last_version")
        .and_then(|v| v.as_str().map(String::from));

    let update_check_enabled = store
        .get("update_check_enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let notifications_enabled = store
        .get("notifications_enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    AppSettings {
        window_state,
        last_version,
        update_check_enabled,
        notifications_enabled,
    }
}

/// Save settings to store
fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) {
    let store = match app.store(".nubo-settings.json") {
        Ok(s) => s,
        Err(e) => {
            error!("Failed to open settings store for saving: {}", e);
            return;
        }
    };

    if let Ok(value) = serde_json::to_value(&settings.window_state) {
        let _ = store.set("window_state", value);
    }
    if let Some(ref version) = settings.last_version {
        let _ = store.set("last_version", serde_json::json!(version));
    }
    let _ = store.set("update_check_enabled", serde_json::json!(settings.update_check_enabled));
    let _ = store.set("notifications_enabled", serde_json::json!(settings.notifications_enabled));
    let _ = store.save();
}

/// Save current window state
pub fn save_window_state(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let mut settings = load_settings(app);

    if let Ok(size) = window.inner_size() {
        settings.window_state.width = size.width as f64;
        settings.window_state.height = size.height as f64;
    }

    if let Ok(position) = window.outer_position() {
        settings.window_state.x = position.x;
        settings.window_state.y = position.y;
    }

    if let Ok(maximized) = window.is_maximized() {
        settings.window_state.maximized = maximized;
    }

    save_settings(app, &settings);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Build Tauri app with all plugins
    let mut builder = tauri::Builder::default()
        // Logging plugin
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: Some("nubo.log".into()) },
                ))
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        // Persistent storage for settings
        .plugin(tauri_plugin_store::Builder::default().build())
        // Native notifications
        .plugin(tauri_plugin_notification::init())
        // Shell operations (restricted via config)
        .plugin(tauri_plugin_shell::init())
        // Deep link handling
        .plugin(tauri_plugin_deep_link::init())
        // OS information for theme detection
        .plugin(tauri_plugin_os::init());

    // Desktop-only plugins
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            info!("Another instance attempted to launch, focusing existing window");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));

        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            info!("Setting up Nubo application...");

            // Load saved settings
            let settings = load_settings(app.handle());
            info!("Loaded settings: window {}x{}", settings.window_state.width, settings.window_state.height);

            // Create main window
            let url = WebviewUrl::External("https://nubo.email".parse().unwrap());

            let window = WebviewWindowBuilder::new(app, "main", url)
                .title("Nubo")
                .inner_size(settings.window_state.width, settings.window_state.height)
                .min_inner_size(800.0, 600.0)
                .position(settings.window_state.x as f64, settings.window_state.y as f64)
                .resizable(true)
                .fullscreen(false)
                .decorations(true)
                .visible(true)
                .build()?;

            // Restore maximized state
            if settings.window_state.maximized {
                let _ = window.maximize();
            }

            // macOS: overlay title bar
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
            }

            // Save window state on close
            let app_handle = app.handle().clone();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    info!("Window closing, saving state...");
                    save_window_state(&app_handle, &window_clone);
                }
            });

            // Handle deep links
            #[cfg(desktop)]
            {
                use tauri::Listener;
                let handle = app.handle().clone();
                app.listen("deep-link://new-url", move |event| {
                    let payload = event.payload();
                    info!("Received deep link: {}", payload);
                    handle_deep_link(&handle, payload);
                });
            }

            // Check for updates on startup (silent)
            #[cfg(desktop)]
            {
                let app_handle_updater = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Wait before checking
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    check_and_install_update(&app_handle_updater).await;
                });
            }

            info!("Nubo application setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::show_notification,
            commands::set_badge_count,
            commands::check_for_updates,
            commands::get_os_theme,
            commands::get_window_state,
            commands::save_window_state_cmd,
            commands::is_online,
            commands::get_app_version,
            commands::rollback_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn handle_deep_link(app: &tauri::AppHandle, url: &str) {
    info!("Processing deep link: {}", url);

    if url.starts_with("mailto:") {
        let cleaned = url.replace("mailto:", "");
        let email = cleaned.split('?').next().unwrap_or("");

        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
            let nav_url = format!(
                "https://nubo.email/mail/inbox?isComposeOpen=true&to={}",
                urlencoding::encode(email)
            );
            info!("Navigating to compose for: {}", email);
            let _ = window.eval(&format!("window.location.href = '{}';", nav_url));
        }
    } else if url.starts_with("nubo://") {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
            let path = url.replace("nubo://", "");
            let nav_url = format!("https://nubo.email/{}", path);
            info!("Navigating to: {}", nav_url);
            let _ = window.eval(&format!("window.location.href = '{}';", nav_url));
        }
    }
}

/// Check for updates and install silently
#[cfg(desktop)]
async fn check_and_install_update(app: &tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;

    info!("Checking for updates...");

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            warn!("Failed to get updater: {}", e);
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            info!("Update available: {} -> {}", env!("CARGO_PKG_VERSION"), update.version);

            // Save current version for rollback
            let mut settings = load_settings(app);
            settings.last_version = Some(env!("CARGO_PKG_VERSION").to_string());
            save_settings(app, &settings);

            info!("Downloading update...");
            match update.download_and_install(
                |downloaded, total| {
                    if let Some(t) = total {
                        let percent = (downloaded as f64 / t as f64) * 100.0;
                        info!("Download progress: {:.1}%", percent);
                    }
                },
                || {
                    info!("Download complete, preparing to install...");
                },
            ).await {
                Ok(_) => {
                    info!("Update installed successfully. Will apply on next restart.");
                }
                Err(e) => {
                    error!("Failed to install update: {}", e);
                }
            }
        }
        Ok(None) => {
            info!("No updates available");
        }
        Err(e) => {
            warn!("Failed to check for updates: {}", e);
        }
    }
}
