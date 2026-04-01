const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const isDev = !app.isPackaged;

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,          // <-- this hides the title bar and borders
    kiosk: true,
    webPreferences: {
      nodeIntegration: false,  // set according to your project
      contextIsolation: true,
      // preload: path.join(__dirname, 'preload.js') // if used
    }
  });
  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    win.loadFile(indexPath);
  }

  // Debug (remove later)
  win.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});