use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init());

    // Desktop-only plugins
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window when another instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));

        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            // Create main window pointing to external URL
            let url = WebviewUrl::External("https://nubo.email".parse().unwrap());

            let window = WebviewWindowBuilder::new(app, "main", url)
                .title("Nubo")
                .inner_size(1400.0, 900.0)
                .min_inner_size(800.0, 600.0)
                .resizable(true)
                .fullscreen(false)
                .decorations(true)
                .build()?;

            // Set title bar style for macOS
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
            }

            // Handle deep links (mailto:)
            #[cfg(desktop)]
            {
                use tauri::Listener;
                let handle = app.handle().clone();
                app.listen("deep-link://new-url", move |event| {
                    let payload = event.payload();
                    handle_deep_link(&handle, payload);
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::show_notification,
            commands::set_badge_count,
            commands::check_for_updates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn handle_deep_link(app: &tauri::AppHandle, url: &str) {
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
            let _ = window.eval(&format!("window.location.href = '{}';", nav_url));
        }
    }
}
