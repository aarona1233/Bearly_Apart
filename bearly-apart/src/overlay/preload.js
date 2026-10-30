const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ba', {
  onPlay: (fn) => ipcRenderer.on('play', (_, msg) => fn(msg)),
  done: () => ipcRenderer.send('scene-done'),
  setClickable: (on) => ipcRenderer.send('overlay-clickable', !!on),
  poke: () => ipcRenderer.send('poke-back'),
  candy: (result) => ipcRenderer.send('candy-result', result),
  hotspots: (rects) => ipcRenderer.send('overlay-hotspots', rects),
  debug: (msg) => ipcRenderer.send('overlay-debug', msg),
});
