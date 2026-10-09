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
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    get: (projectId) => ipcRenderer.invoke('projects:get', projectId)
  },
  generation: {
    start: (payload) => ipcRenderer.invoke('generation:start', payload)
  },
  review: {
    reject: (payload) => ipcRenderer.invoke('review:reject', payload),
    pass: (payload) => ipcRenderer.invoke('review:pass', payload)
  },
  metadata: {
    generate: (projectId) => ipcRenderer.invoke('metadata:generate', projectId)
  },
  vectorizer: {
    start: (projectId) => ipcRenderer.invoke('vectorizer:start', projectId)
  },
  export: {
    png: (projectId) => ipcRenderer.invoke('export:png', projectId)
  },
  files: {
    chooseReference: () => ipcRenderer.invoke('file:choose-reference')
  }
});
