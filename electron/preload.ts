import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, Command } from '../src/shared/types';
contextBridge.exposeInMainWorld('momoBose', {
  snapshot: () => ipcRenderer.invoke('momobose:snapshot'),
  command: (command: Command) => ipcRenderer.invoke('momobose:command', command),
  subscribe: (callback: (state: AppState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state);
    ipcRenderer.on('momobose:state', listener);
    return () => ipcRenderer.removeListener('momobose:state', listener);
  },
});
