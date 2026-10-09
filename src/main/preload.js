const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zeroPOD', {
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    login: (serviceId) => ipcRenderer.invoke('connections:login', serviceId),
    logout: (serviceId) => ipcRenderer.invoke('connections:logout', serviceId)
  },
  pod: {
    rules: () => ipcRenderer.invoke('pod:rules')
  },
  files: {
    chooseReference: () => ipcRenderer.invoke('file:choose-reference')
  }
});
