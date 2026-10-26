const { contextBridge, ipcRenderer } = require('electron');

// Every call that sends something resolves to { ok, error } instead of throwing.
contextBridge.exposeInMainWorld('ba', {
  get: () => ipcRenderer.invoke('app:get'),
  onLive: (fn) => ipcRenderer.on('live', (_, live) => fn(live)),
  onShowTab: (fn) => ipcRenderer.on('show-tab', (_, tab) => fn(tab)),
  // send('kiss'), send('status', { status: 'work' }), send('gift', { gift: 'cuddle' })
  send: (type, extra = {}) => ipcRenderer.invoke('app:send', { type, ...extra }),
  note: (text, later) => ipcRenderer.invoke('app:note', { text, later }),
  preview: (name) => ipcRenderer.invoke('app:preview', name),
  snooze: (mins) => ipcRenderer.invoke('app:snooze', mins),
  save: (patch) => ipcRenderer.invoke('app:save', patch),
  pair: (code) => ipcRenderer.invoke('app:pair', code),
  resetPairing: () => ipcRenderer.invoke('app:reset-pairing'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  open: (what) => ipcRenderer.invoke('app:open', what),
  clipboardCode: () => ipcRenderer.invoke('app:clipboard-code'),
  setup: (step) => ipcRenderer.invoke('app:setup', step),
});
