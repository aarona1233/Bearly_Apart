const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ba', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (patch) => ipcRenderer.invoke('settings:save', patch),
  pair: (code) => ipcRenderer.invoke('settings:pair', code),
  resetPairing: () => ipcRenderer.invoke('settings:reset-pairing'),
  sendNote: (text, later) => ipcRenderer.invoke('note:send', { text, later }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  tryList: () => ipcRenderer.invoke('try:list'),
  preview: (name) => ipcRenderer.invoke('try:preview', name),
  send: (type, status) => ipcRenderer.invoke('try:send', { type, status }),
  snooze: (mins) => ipcRenderer.invoke('try:snooze', mins),
});
