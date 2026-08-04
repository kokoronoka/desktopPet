// Bridge for the setup page (src/setup.html) — deliberately narrower than the
// overlay's bridge: this window only reads and writes the pet choice.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveSetup: (pet, name) => ipcRenderer.send('save-setup', { pet, name })
});
