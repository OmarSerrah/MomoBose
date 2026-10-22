import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, Command, UpdateState } from '../src/shared/types';
contextBridge.exposeInMainWorld('momoBose', {
  updates: {
    snapshot: () => ipcRenderer.invoke('momobose:updates:snapshot'),
    check: () => ipcRenderer.invoke('momobose:updates:check'),
    install: () => ipcRenderer.invoke('momobose:updates:install'),
    openRelease: () => ipcRenderer.invoke('momobose:updates:open-release'),
    subscribe: (callback: (state: UpdateState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
      ipcRenderer.on('momobose:updates:state', listener);
      return () => ipcRenderer.removeListener('momobose:updates:state', listener);
    },
  },
  snapshot: () => ipcRenderer.invoke('momobose:snapshot'),
  command: (command: Command) => ipcRenderer.invoke('momobose:command', command),
  subscribe: (callback: (state: AppState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state);
    ipcRenderer.on('momobose:state', listener);
    return () => ipcRenderer.removeListener('momobose:state', listener);
  },
});
