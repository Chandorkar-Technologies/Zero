const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods for the web app to communicate with Electron
contextBridge.exposeInMainWorld('electron', {
  // Set badge count on dock icon (macOS)
  setBadgeCount: (count) => {
    ipcRenderer.send('set-badge-count', count);
  },

  // Show native notification
  showNotification: (title, options) => {
    ipcRenderer.send('show-notification', { title, ...options });
  },

  // Check if running in Electron
  isElectron: true,

  // Platform info
  platform: process.platform,

  // App version
  getVersion: () => {
    return process.env.npm_package_version || '1.0.0';
  },
});

// Log that we're running in Electron (helps with debugging)
console.log('[Nubo Desktop] Running in Electron on', process.platform);
