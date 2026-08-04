// Bridge for the floating pet overlay (src/index.html).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  setIgnoreMouseEvents: (ignore, options) =>
    ipcRenderer.send('set-ignore-mouse-events', ignore, options),

  moveWindow: (deltaX, deltaY) =>
    ipcRenderer.send('move-window', { deltaX, deltaY }),

  // Which pet is active, and what it's called
  getState: () => ipcRenderer.invoke('get-state'),
  onPetUpdated: (callback) =>
    ipcRenderer.on('pet-updated', (event, pet) => callback(pet)),

  // Autonomous walking (main process owns the actual window motion)
  walk: (distance) => ipcRenderer.invoke('walk', distance),
  stopWalk: () => ipcRenderer.send('stop-walk'),
  onWalkDirection: (callback) =>
    ipcRenderer.on('walk-direction', (event, direction) => callback(direction))
});
