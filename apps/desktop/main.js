const { app, BrowserWindow, shell, Menu, nativeImage, Tray, ipcMain, Notification } = require('electron');
const path = require('path');

// Remote URL - the app loads from this URL so updates are automatic
const REMOTE_URL = 'https://nubo.email';
const DEV_URL = 'http://localhost:3000';

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Get the URL based on environment
function getAppUrl() {
  return process.env.NODE_ENV === 'development' ? DEV_URL : REMOTE_URL;
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Nubo',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false, // Don't show until ready
  });

  // Load the remote URL
  mainWindow.loadURL(getAppUrl());

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow nubo.email URLs to open in app
    if (url.startsWith(REMOTE_URL) || url.startsWith(DEV_URL)) {
      return { action: 'allow' };
    }
    // Open external links in default browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle navigation to external sites
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = getAppUrl();
    if (!url.startsWith(appUrl) && !url.startsWith('https://accounts.google.com') && !url.startsWith('https://login.microsoftonline.com')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Handle close button - minimize to tray on macOS/Windows
  mainWindow.on('close', (event) => {
    if (!isQuitting && (process.platform === 'darwin' || process.platform === 'win32')) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create system tray
function createTray() {
  // Use a simple icon for now - you can replace with actual icon
  const iconPath = path.join(__dirname, 'resources', 'tray-icon.png');

  try {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  } catch {
    // If icon doesn't exist, create empty tray
    tray = new Tray(nativeImage.createEmpty());
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Nubo',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Compose Email',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.executeJavaScript(`
            window.location.href = '${getAppUrl()}/mail/inbox?isComposeOpen=true';
          `);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Nubo');
  tray.setContextMenu(contextMenu);

  // Click on tray icon to show window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow();
    }
  });
}

// Create application menu
function createMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Email',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(`
                window.location.href = '${getAppUrl()}/mail/inbox?isComposeOpen=true';
              `);
            }
          },
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        {
          label: 'Inbox',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(`
                window.location.href = '${getAppUrl()}/mail/inbox';
              `);
            }
          },
        },
        {
          label: 'Drafts',
          accelerator: 'CmdOrCtrl+2',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(`
                window.location.href = '${getAppUrl()}/mail/draft';
              `);
            }
          },
        },
        {
          label: 'Sent',
          accelerator: 'CmdOrCtrl+3',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(`
                window.location.href = '${getAppUrl()}/mail/sent';
              `);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(`
                window.location.href = '${getAppUrl()}/settings/general';
              `);
            }
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://nubo.email');
          },
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/nubo-email/nubo/issues');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Handle badge count updates from web app
ipcMain.on('set-badge-count', (event, count) => {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count > 0 ? String(count) : '');
  }
});

// Handle native notifications from web app
ipcMain.on('show-notification', (event, { title, body, icon, _tag, data }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title || 'Nubo',
      body: body || '',
      icon: icon || path.join(__dirname, 'resources', 'icon.png'),
      silent: false,
    });

    notification.on('click', () => {
      // Show and focus the main window when notification is clicked
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        // If there's data with a URL, navigate to it
        if (data?.url) {
          mainWindow.webContents.executeJavaScript(`
            window.location.href = '${data.url}';
          `);
        }
      }
    });

    notification.show();
  }
});

// App lifecycle
app.whenReady().then(() => {
  createMenu();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle deep links (mailto:)
app.setAsDefaultProtocolClient('mailto');

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('mailto:')) {
    const email = url.replace('mailto:', '').split('?')[0];
    if (mainWindow) {
      mainWindow.show();
      mainWindow.webContents.executeJavaScript(`
        window.location.href = '${getAppUrl()}/mail/inbox?isComposeOpen=true&to=${encodeURIComponent(email)}';
      `);
    }
  }
});
