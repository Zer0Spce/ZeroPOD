const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zeroPOD', {
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    login: (serviceId) => ipcRenderer.invoke('connections:login', serviceId),
    test: (serviceId) => ipcRenderer.invoke('connections:test', serviceId),
    preflight: () => ipcRenderer.invoke('connections:preflight'),
    logout: (serviceId) => ipcRenderer.invoke('connections:logout', serviceId)
  },
  pod: { rules: () => ipcRenderer.invoke('pod:rules') },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    archived: () => ipcRenderer.invoke('projects:archived'),
    get: (projectId) => ipcRenderer.invoke('projects:get', projectId),
    duplicates: (sourceUrl) => ipcRenderer.invoke('projects:duplicates', sourceUrl),
    archive: (projectId) => ipcRenderer.invoke('projects:archive', projectId),
    restore: (projectId) => ipcRenderer.invoke('projects:restore', projectId),
    delete: (projectId) => ipcRenderer.invoke('projects:delete', projectId)
  },
  workspace: {
    backup: () => ipcRenderer.invoke('workspace:backup'),
    restore: () => ipcRenderer.invoke('workspace:restore'),
    health: () => ipcRenderer.invoke('workspace:health'),
    diagnostics: () => ipcRenderer.invoke('workspace:diagnostics')
  },
  generation: { start: (payload) => ipcRenderer.invoke('generation:start', payload) },
  review: {
    reject: (payload) => ipcRenderer.invoke('review:reject', payload),
    pass: (payload) => ipcRenderer.invoke('review:pass', payload)
  },
  metadata: {
    generate: (projectId) => ipcRenderer.invoke('metadata:generate', projectId),
    save: (payload) => ipcRenderer.invoke('metadata:save', payload)
  },
  quality: { check: (projectId) => ipcRenderer.invoke('quality:check', projectId) },
  vectorizer: { start: (projectId) => ipcRenderer.invoke('vectorizer:start', projectId) },
  export: { png: (projectId) => ipcRenderer.invoke('export:png', projectId) },
  redbubble: {
    prepare: (projectId) => ipcRenderer.invoke('redbubble:prepare', projectId),
    publish: (projectId) => ipcRenderer.invoke('redbubble:publish', projectId)
  },
  automation: {
    list: () => ipcRenderer.invoke('automation:list'),
    add: (rows) => ipcRenderer.invoke('automation:add', rows),
    update: (payload) => ipcRenderer.invoke('automation:update', payload),
    move: (payload) => ipcRenderer.invoke('automation:move', payload),
    remove: (rowId) => ipcRenderer.invoke('automation:remove', rowId),
    clearCompleted: () => ipcRenderer.invoke('automation:clear-completed'),
    start: () => ipcRenderer.invoke('automation:start'),
    pause: () => ipcRenderer.invoke('automation:pause'),
    stop: () => ipcRenderer.invoke('automation:stop'),
    importCsv: () => ipcRenderer.invoke('automation:import-csv'),
    exportCsv: () => ipcRenderer.invoke('automation:export-csv'),
    importXlsx: () => ipcRenderer.invoke('automation:import-xlsx'),
    exportXlsx: () => ipcRenderer.invoke('automation:export-xlsx')
  },
  files: {
    chooseReference: () => ipcRenderer.invoke('file:choose-reference'),
    chooseMultipleReferences: () => ipcRenderer.invoke('file:choose-multiple-references')
  }
});
