const { app, BrowserWindow, Tray, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let setupWindow = null;
let tray = null;
let walkTimer = null;
let saveTimer = null;
let isQuitting = false;

const WINDOW_SIZE = { width: 220, height: 220 };
const SETUP_SIZE = { width: 520, height: 580 };
const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json');

// ---------- Persisted state (plain JSON, no extra dependency) ----------
let state = { pet: null, name: null, position: null };

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      state = {
        pet: parsed.pet ?? null,
        name: parsed.name ?? null,
        position: parsed.position ?? null
      };
    }
  } catch {
    // No state file yet (first launch) or it's unreadable — fall back to defaults.
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Could not save state:', err.message);
  }
}

// Window position changes constantly while dragging/walking, so batch the writes.
function saveStateSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 500);
}

// ---------- Positioning ----------
function defaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WINDOW_SIZE.width - 40,
    y: workArea.y + workArea.height - WINDOW_SIZE.height - 40
  };
}

// A saved position is only usable if that screen still exists — monitors get
// unplugged, and a window restored off-screen would be invisible.
function isOnScreen({ x, y }) {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const cx = x + WINDOW_SIZE.width / 2;
    const cy = y + WINDOW_SIZE.height / 2;
    return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height;
  });
}

function startPosition() {
  const saved = state.position;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && isOnScreen(saved)) {
    return saved;
  }
  return defaultPosition();
}

function clampToDisplay(x, y) {
  const bounds = { x, y, width: WINDOW_SIZE.width, height: WINDOW_SIZE.height };
  const { workArea } = screen.getDisplayMatching(bounds);
  return {
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - WINDOW_SIZE.width),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - WINDOW_SIZE.height)
  };
}

function createWindow() {
  const { x, y } = startPosition();

  mainWindow = new BrowserWindow({
    width: WINDOW_SIZE.width,
    height: WINDOW_SIZE.height,
    x,
    y,
    // Stays hidden until a pet has actually been chosen on the setup page.
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('move', () => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    state.position = { x, y };
    saveStateSoon();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------- Setup page (pick a pet, name it) ----------
function openSetup() {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: SETUP_SIZE.width,
    height: SETUP_SIZE.height,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#16141d',
    title: 'Desktop Pet',
    webPreferences: {
      preload: path.join(__dirname, 'preload-setup.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setupWindow.loadFile(path.join(__dirname, 'src', 'setup.html'));
  setupWindow.once('ready-to-show', () => setupWindow.show());

  setupWindow.on('closed', () => {
    setupWindow = null;
    // Closing the setup page on a first run (no pet ever chosen) means the
    // user backed out — don't leave an invisible app running in the tray.
    if (!state.pet) {
      isQuitting = true;
      app.quit();
    }
  });
}

// ---------- IPC ----------
function registerIpc() {
  // Click-through: the renderer tells us when the cursor is over empty
  // (transparent) space vs. over the pet itself.
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    if (mainWindow) mainWindow.setIgnoreMouseEvents(ignore, options);
  });

  // Frameless windows have no native drag region, so the renderer forwards
  // mouse deltas and we reposition the real OS window.
  ipcMain.on('move-window', (event, { deltaX, deltaY }) => {
    if (!mainWindow) return;
    stopWalk(); // a user drag always wins over an autonomous walk
    const [x, y] = mainWindow.getPosition();
    const next = clampToDisplay(x + deltaX, y + deltaY);
    mainWindow.setPosition(next.x, next.y);
  });

  ipcMain.handle('get-state', () => ({ pet: state.pet, name: state.name }));

  // The setup page is the only thing that can change which pet is active.
  ipcMain.on('save-setup', (event, { pet, name }) => {
    state.pet = pet;
    state.name = String(name || '').trim().slice(0, 20);
    saveState();

    if (mainWindow) {
      mainWindow.webContents.send('pet-updated', { pet: state.pet, name: state.name });
      if (!mainWindow.isVisible()) mainWindow.show();
    }
    if (setupWindow) setupWindow.close();
  });

  // Autonomous walk: the renderer decides *when*, the main process owns the
  // actual motion because only it knows the screen bounds.
  ipcMain.handle('walk', async (event, requestedDistance) => walk(requestedDistance));
  ipcMain.on('stop-walk', stopWalk);
}

// ---------- Autonomous walking ----------
function stopWalk() {
  if (walkTimer) {
    clearInterval(walkTimer);
    walkTimer = null;
  }
}

// Steps the window horizontally a short distance, turning around at the screen
// edge. Resolves with the direction walked so the renderer can face the pet.
function walk(requestedDistance = 160) {
  return new Promise((resolve) => {
    if (!mainWindow || !mainWindow.isVisible() || walkTimer) {
      resolve(null);
      return;
    }

    const [startX, startY] = mainWindow.getPosition();
    const { workArea } = screen.getDisplayMatching({
      x: startX,
      y: startY,
      width: WINDOW_SIZE.width,
      height: WINDOW_SIZE.height
    });

    const roomRight = workArea.x + workArea.width - WINDOW_SIZE.width - startX;
    const roomLeft = startX - workArea.x;

    // Prefer a random direction, but turn around if that side is cramped.
    let direction = Math.random() < 0.5 ? -1 : 1;
    if (direction === 1 && roomRight < 40) direction = -1;
    else if (direction === -1 && roomLeft < 40) direction = 1;

    const available = direction === 1 ? roomRight : roomLeft;
    const distance = Math.min(requestedDistance, Math.max(available, 0));
    if (distance < 20) {
      resolve(null);
      return;
    }

    const STEP = 2;
    let travelled = 0;

    walkTimer = setInterval(() => {
      if (!mainWindow) {
        stopWalk();
        resolve(null);
        return;
      }
      const [x, y] = mainWindow.getPosition();
      const step = Math.min(STEP, distance - travelled);
      const next = clampToDisplay(x + step * direction, y);
      mainWindow.setPosition(next.x, next.y);
      travelled += step;

      if (travelled >= distance || next.x === x) {
        stopWalk();
        resolve(direction);
      }
    }, 16);

    // Tell the renderer immediately which way we're heading.
    mainWindow.webContents.send('walk-direction', direction);
  });
}

// ---------- Tray ----------
function togglePetVisibility() {
  if (!mainWindow) return;
  // Nothing to show yet — send them to the setup page instead.
  if (!state.pet) {
    openSetup();
    return;
  }
  if (mainWindow.isVisible()) {
    stopWalk();
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
}

function openPetSelector() {
  stopWalk();
  openSetup();
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'src', 'assets', 'tray-icon.png'));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show/Hide Pet', click: togglePetVisibility },
    { label: 'Change Pet / Rename…', click: openPetSelector },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Desktop Pet');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', togglePetVisibility);
}

// ---------- Lifecycle ----------
// A second copy would spawn a duplicate pet and a duplicate tray icon.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (setupWindow) setupWindow.focus();
    else if (mainWindow && state.pet && !mainWindow.isVisible()) mainWindow.show();
  });

  app.whenReady().then(() => {
    loadState();
    registerIpc();
    createWindow();
    createTray();

    // First launch (or state was cleared) opens the setup page; otherwise the
    // saved pet just reappears where it was left.
    if (state.pet) mainWindow.once('ready-to-show', () => mainWindow.show());
    else openSetup();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// The pet lives in the tray, so closing/hiding the window must not quit the app.
app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopWalk();
  clearTimeout(saveTimer);
  saveState();
});
