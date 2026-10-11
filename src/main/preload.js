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
    delete: (projectId) => ipcRenderer.invoke('projects:delete', projectId),
    clearAll: (payload) => ipcRenderer.invoke('projects:clear-all', payload)
  },
  workspace: {
    backup: () => ipcRenderer.invoke('workspace:backup'),
    restore: () => ipcRenderer.invoke('workspace:restore'),
    health: () => ipcRenderer.invoke('workspace:health'),
    diagnostics: () => ipcRenderer.invoke('workspace:diagnostics')
  },
  generation: {
    start: (payload) => ipcRenderer.invoke('generation:start', payload),
    newChat: () => ipcRenderer.invoke('generation:new-chat')
  },
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
    publish: (projectId) => ipcRenderer.invoke('redbubble:publish', projectId),
    dailyUsage: () => ipcRenderer.invoke('redbubble:daily-usage')
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
  research: {
    list: (filters) => ipcRenderer.invoke('research:list', filters),
    get: (key) => ipcRenderer.invoke('research:get', key),
    marketplaces: () => ipcRenderer.invoke('research:marketplaces'),
    presets: () => ipcRenderer.invoke('research:presets'),
    refreshBestSellers: (payload) => ipcRenderer.invoke('research:refresh-best-sellers', payload),
    importProduct: (payload) => ipcRenderer.invoke('research:import-product', payload),
    save: (payload) => ipcRenderer.invoke('research:save', payload),
    addToAutomation: (keys) => ipcRenderer.invoke('research:add-to-automation', keys),
    openAmazon: (url) => ipcRenderer.invoke('research:open-amazon', url)
  },
  flyingResearch: {
    options: () => ipcRenderer.invoke('flying:options'),
    list: (filters) => ipcRenderer.invoke('flying:list', filters),
    save: (payload) => ipcRenderer.invoke('flying:save', payload),
    login: () => ipcRenderer.invoke('flying:login'),
    test: () => ipcRenderer.invoke('flying:test'),
    open: (tool) => ipcRenderer.invoke('flying:open', tool),
    search: (payload) => ipcRenderer.invoke('flying:search', payload),
    capture: () => ipcRenderer.invoke('flying:capture'),
    workflow: (key) => ipcRenderer.invoke('flying:workflow', key),
    addToAutomation: (payload) => ipcRenderer.invoke('flying:automation', payload),
    openAmazon: (key) => ipcRenderer.invoke('flying:amazon', key)
  },
  storage: {
    usage: () => ipcRenderer.invoke('storage:usage'),
    settings: () => ipcRenderer.invoke('storage:settings'),
    updateSettings: (patch) => ipcRenderer.invoke('storage:update-settings', patch),
    cleanup: (payload) => ipcRenderer.invoke('storage:cleanup', payload)
  },
  files: {
    chooseReference: () => ipcRenderer.invoke('file:choose-reference'),
    chooseMultipleReferences: () => ipcRenderer.invoke('file:choose-multiple-references')
  }
});
