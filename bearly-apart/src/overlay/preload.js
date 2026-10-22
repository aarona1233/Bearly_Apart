const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ba', {
  onPlay: (fn) => ipcRenderer.on('play', (_, msg) => fn(msg)),
  done: () => ipcRenderer.send('scene-done'),
  setClickable: (on) => ipcRenderer.send('overlay-clickable', !!on),
  poke: () => ipcRenderer.send('poke-back'),
});
