/**
 * Preload — the ONLY bridge between renderer and main.
 * Exposes a small, promise-based API; nothing else leaks through.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  info: () => ipcRenderer.invoke('app:info'),
  vault: {
    create: pwd => ipcRenderer.invoke('vault:create', pwd),
    unlock: pwd => ipcRenderer.invoke('vault:unlock', pwd),
    lock: () => ipcRenderer.invoke('vault:lock'),
    list: () => ipcRenderer.invoke('vault:list'),
    erase: () => ipcRenderer.invoke('vault:erase'),
  },
  card: {
    add: data => ipcRenderer.invoke('card:add', data),
    update: (id, data) => ipcRenderer.invoke('card:update', id, data),
    delete: id => ipcRenderer.invoke('card:delete', id),
    setDefault: id => ipcRenderer.invoke('card:setDefault', id),
  },
  clip: {
    copy: (id, field) => ipcRenderer.invoke('clip:copy', id, field),
    clear: () => ipcRenderer.invoke('clip:clear'),
    status: () => ipcRenderer.invoke('clip:status'),
  },
  autofill: id => ipcRenderer.invoke('autofill', id),
  fillAll: id => ipcRenderer.invoke('fillall', id),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: patch => ipcRenderer.invoke('settings:set', patch),
  },
  master: {
    change: (oldPw, newPw) => ipcRenderer.invoke('master:change', oldPw, newPw),
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
  },
  quit: () => ipcRenderer.invoke('app:quit'),
  onLocked: cb => ipcRenderer.on('vault:locked', (_e, reason) => cb(reason)),
  onClipCleared: cb => ipcRenderer.on('clip:cleared', () => cb()),
  onMaximized: cb => ipcRenderer.on('win:maximized', (_e, isMax) => cb(isMax)),
};

contextBridge.exposeInMainWorld('wincredit', api);
