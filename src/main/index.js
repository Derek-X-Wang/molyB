import { app, protocol, screen, shell, ipcMain, BrowserWindow, Menu, MenuItem } from 'electron'; // eslint-disable-line
import fs from 'fs';
import path from 'path';

const userDataPath = app.getPath('userData');
let isFocusMode = false;
let appIsReady = false;

/**
 * Set `__static` path to static files in production
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-static-assets.html
 */
if (process.env.NODE_ENV !== 'development') {
  global.__static = require('path').join(__dirname, '/static').replace(/\\/g, '\\\\') // eslint-disable-line
}

let mainWindow;
const winURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080'
  : `file://${__dirname}/index.html`;

function saveWindowBounds() {
  if (mainWindow) {
    fs.writeFile(path.join(userDataPath, 'windowBounds.json'), JSON.stringify(mainWindow.getBounds()));
  }
}

function sendIPCToWindow(window, action, data) {
  if (mainWindow) {
    mainWindow.webContents.send(action, data || {});
  }
}

function openTabInWindow(url) {
  sendIPCToWindow(mainWindow, 'addTab', {
    url,
  });
}

function createWindowWithBounds(bounds, shouldMaximize) {
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 320,
    minHeight: 350,
    // frame: false, // https://github.com/electron/electron/blob/master/docs/api/frameless-window.md
    titleBarStyle: 'hidden-inset',
    icon: `${__dirname}/static/icon256.png`,
  });

  // and load the index.html of the app.
  mainWindow.loadURL(winURL);

  if (shouldMaximize) {
    mainWindow.maximize();
  }

  // save the window size for the next launch of the app
  mainWindow.on('close', () => {
    saveWindowBounds();
  });

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  /* handle pdf downloads - ipc recieved in fileDownloadManager.js */

  mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
    const itemURL = item.getURL();
    if (item.getMimeType() === 'application/pdf' && itemURL.indexOf('blob:') !== 0 && itemURL.indexOf('#pdfjs.action=download') === -1) { // clicking the download button in the viewer opens a blob url, so we don't want to open those in the viewer (since that would make it impossible to download a PDF)
      event.preventDefault();
      sendIPCToWindow(mainWindow, 'openPDF', {
        url: itemURL,
        webContentsId: webContents.getId(),
        event,
        item, // as of electron 0.35.1, this is an empty object
      });
    }
    return true;
  });

  mainWindow.on('enter-full-screen', () => {
    sendIPCToWindow(mainWindow, 'enter-full-screen');
  });

  mainWindow.on('leave-full-screen', () => {
    sendIPCToWindow(mainWindow, 'leave-full-screen');
  });

  mainWindow.on('app-command', (e, command) => {
    if (command === 'browser-backward') {
      sendIPCToWindow(mainWindow, 'goBack');
    } else if (command === 'browser-forward') {
      sendIPCToWindow(mainWindow, 'goForward');
    }
  });

  // prevent remote pages from being loaded using drag-and-drop, since they would have node access
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== winURL) {
      e.preventDefault();
    }
  });

  // registerFiltering(); // register filtering for the default session

  return mainWindow;
}

function createWindow(callback) {
  let bounds;
  fs.readFile(path.join(userDataPath, 'windowBounds.json'), 'utf-8', (e, data) => {
    if (e || !data) { // there was an error, probably because the file doesn't exist
      const size = screen.getPrimaryDisplay().workAreaSize;
      bounds = {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      };
    } else {
      bounds = JSON.parse(data);
    }
    // maximizes the window frame in windows 10
    // fixes https://github.com/minbrowser/min/issues/214
    // should be removed once https://github.com/electron/electron/issues/4045 is fixed
    let shouldMaximize = false;
    if (process.platform === 'win32') {
      if (bounds.x === 0 || bounds.y === 0 || bounds.x === -8 || bounds.y === -8) {
        const screenSize = screen.getPrimaryDisplay().workAreaSize;
        if ((screenSize.width === bounds.width || bounds.width - screenSize.width === 16)
          && (screenSize.height === bounds.height || bounds.height - screenSize.height === 16)) {
          shouldMaximize = true;
        }
      }
    }

    createWindowWithBounds(bounds, shouldMaximize);

    if (callback) {
      callback();
    }
  });
}

function registerProtocols() {
  protocol.registerStringProtocol('mailto', (req, cb) => {
    shell.openExternal(req.url);
    cb();
    return null;
  }, (error) => {
    if (error) {
      console.log('Could not register mailto protocol.');
    }
  });
}

function createAppMenu() {
  // create the menu. based on example from http://electron.atom.io/docs/v0.34.0/api/menu/
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+t',
          click: (item, window) => {
            sendIPCToWindow(window, 'addTab');
          },
        },
        {
          label: 'New Private Tab',
          accelerator: 'shift+CmdOrCtrl+p',
          click: (item, window) => {
            sendIPCToWindow(window, 'addPrivateTab');
          },
        },
        {
          label: 'New Task',
          accelerator: 'CmdOrCtrl+n',
          click: (item, window) => {
            sendIPCToWindow(window, 'addTask');
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Save Page As',
          accelerator: 'CmdOrCtrl+s',
          click: (item, window) => {
            sendIPCToWindow(window, 'saveCurrentPage');
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Print',
          accelerator: 'CmdOrCtrl+p',
          click: (item, window) => {
            sendIPCToWindow(window, 'print');
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          role: 'undo',
        },
        {
          label: 'Redo',
          accelerator: 'Shift+CmdOrCtrl+Z',
          role: 'redo',
        },
        {
          type: 'separator',
        },
        {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          role: 'cut',
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          role: 'copy',
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          role: 'paste',
        },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          role: 'selectall',
        },
        {
          type: 'separator',
        },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: (item, window) => {
            sendIPCToWindow(window, 'findInPage');
          },
        },
      ],
    },
    /* these items are added by os x */
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: (item, window) => {
            sendIPCToWindow(window, 'zoomIn');
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: (item, window) => {
            sendIPCToWindow(window, 'zoomOut');
          },
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: (item, window) => {
            sendIPCToWindow(window, 'zoomReset');
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Full Screen',
          accelerator: (() => {
            if (process.platform === 'darwin') {
              return 'Ctrl+Command+F';
            }
            return 'F11';
          })(),
          role: 'togglefullscreen',
        },
        {
          label: 'Focus Mode',
          accelerator: undefined,
          type: 'checkbox',
          checked: false,
          click: (item, window) => {
            if (isFocusMode) {
              item.checked = false;
              isFocusMode = false;
              sendIPCToWindow(window, 'exitFocusMode');
            } else {
              item.checked = true;
              isFocusMode = true;
              sendIPCToWindow(window, 'enterFocusMode');
            }
          },
        },
        {
          label: 'Reading List',
          accelerator: undefined,
          click: (item, window) => {
            sendIPCToWindow(window, 'showReadingList');
          },
        },
      ],
    },
    {
      label: 'Developer',
      submenu: [
        {
          label: 'Reload Browser',
          accelerator: undefined,
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.reload();
          },
        },
        {
          label: 'Inspect Browser',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.toggleDevTools();
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Inspect Page',
          accelerator: (() => {
            if (process.platform === 'darwin') {
              return 'Cmd+Alt+I';
            }
            return 'Ctrl+Shift+I';
          })(),
          click: (item, window) => {
            sendIPCToWindow(window, 'inspectPage');
          },
        },
      ],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'CmdOrCtrl+M',
          role: 'minimize',
        },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          role: 'close',
        },
      ],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          click: () => {
            openTabInWindow('https://github.com/minbrowser/min/wiki#keyboard-shortcuts');
          },
        },
        {
          label: 'Report a Bug',
          click: () => {
            openTabInWindow('https://github.com/minbrowser/min/issues/new');
          },
        },
        {
          label: 'Take a Tour',
          click: () => {
            openTabInWindow('https://minbrowser.github.io/min/tour/');
          },
        },
        {
          label: 'View on GitHub',
          click: () => {
            openTabInWindow('https://github.com/minbrowser/min');
          },
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    const name = app.getName();
    template.unshift({
      label: name,
      submenu: [
        {
          label: 'About %n'.replace('%n', name),
          role: 'about',
        },
        {
          type: 'separator',
        },
        {
          label: 'Preferences',
          accelerator: 'CmdOrCtrl+,',
          click: (item, window) => {
            sendIPCToWindow(window, 'addTab', {
              url: `file://${__dirname}/pages/settings/index.html`,
            });
          },
        },
        {
          label: 'Services',
          role: 'services',
          submenu: [],
        },
        {
          type: 'separator',
        },
        {
          label: 'Hide %n'.replace('%n', name),
          accelerator: 'CmdOrCtrl+H',
          role: 'hide',
        },
        {
          label: 'Hide Others',
          accelerator: 'CmdOrCtrl+Shift+H',
          role: 'hideothers',
        },
        {
          label: 'Show All',
          role: 'unhide',
        },
        {
          type: 'separator',
        },
        {
          label: 'Quit %n'.replace('%n', name),
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    });
    // Window menu.
    template[3].submenu.push(
      {
        type: 'separator',
      },
      {
        label: 'Bring All to Front',
        role: 'front',
      });
  }

  // preferences item on linux and windows

  if (process.platform !== 'darwin') {
    template[1].submenu.push({
      type: 'separator',
    });

    template[1].submenu.push({
      label: 'Preferences',
      accelerator: 'CmdOrCtrl+,',
      click: (item, window) => {
        sendIPCToWindow(window, 'addTab', {
          url: `file://${__dirname}/pages/settings/index.html`,
        });
      },
    });
  }

  let menu = new Menu();

  menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createDockMenu() {
  // create the menu. based on example from https://github.com/electron/electron/blob/master/docs/tutorial/desktop-environment-integration.md#custom-dock-menu-macos
  if (process.platform === 'darwin') {
    const template = [
      {
        label: 'New Tab',
        click: (item, window) => {
          sendIPCToWindow(window, 'addTab');
        },
      },
      {
        label: 'New Private Tab',
        click: (item, window) => {
          sendIPCToWindow(window, 'addPrivateTab');
        },
      },
      {
        label: 'New Task',
        click: (item, window) => {
          sendIPCToWindow(window, 'addTask');
        },
      },
    ];

    const dockMenu = Menu.buildFromTemplate(template);
    app.dock.setMenu(dockMenu);
  }
}

// Life cycle
app.on('ready', () => {
  appIsReady = true;
  createWindow(() => {
    mainWindow.webContents.on('did-finish-load', () => {
      // if a URL was passed as a command line argument
      // (probably because Min is set as the default browser on Linux), open it.
      if (process.argv && process.argv[1] && process.argv[1].toLowerCase() !== __dirname.toLowerCase() && process.argv[1].indexOf('://') !== -1) {
        sendIPCToWindow(mainWindow, 'addTab', {
          url: process.argv[1],
        });
      } else if (global.URLToOpen) {
        // if there is a previously set URL to open (probably from opening a link on macOS), open it
        sendIPCToWindow(mainWindow, 'addTab', {
          url: global.URLToOpen,
        });
        global.URLToOpen = null;
      }
    });
    // Open the DevTools.
    // mainWindow.openDevTools()

    createAppMenu();
    createDockMenu();
    registerProtocols();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow && appIsReady) {
    // sometimes, the event will be triggered before the app is ready,
    // and creating new windows will fail
    createWindow();
  }
});

app.on('open-url', (e, url) => {
  if (appIsReady) {
    openTabInWindow(url);
  } else {
    global.URLToOpen = url; // this will be handled later in the createWindow callback
  }
});

/**
 * Auto Updater
 *
 * Uncomment the following code below and install `electron-updater` to
 * support auto updating. Code Signing with a valid certificate is required.
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-electron-builder.html#auto-updating
 */

/*
import { autoUpdater } from 'electron-updater'

autoUpdater.on('update-downloaded', () => {
  autoUpdater.quitAndInstall()
})

app.on('ready', () => {
  if (process.env.NODE_ENV === 'production') autoUpdater.checkForUpdates()
})
 */
