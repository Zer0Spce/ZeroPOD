const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { SessionManager } = require('./sessionManager');
const { ProjectStore } = require('./projectStore');
const { ChatGPTController } = require('./chatgptController');
const { MetadataController } = require('./metadataController');
const { VectorizerController } = require('./vectorizerController');
const { ExportController } = require('./exportController');
const { RedbubbleController } = require('./redbubbleController');
const { AutomationQueueStore } = require('./automationQueueStore');
const { AutomationQueueController } = require('./automationQueueController');
const { WorkspaceManager } = require('./workspaceManager');
const { parseCsv, toCsv } = require('./automationCsv');
const { readAutomationWorkbook, writeAutomationWorkbook } = require('./automationSpreadsheet');
const { validateMetadata, validateProject } = require('./qualityControl');
const workflow = require('./workflowState');

const POD_RULES = [
  'TEXT ALWAYS WINS: preserve the exact slogan when the reference contains text.',
  'Copy the slogan and create a new style rather than duplicating the original artwork.',
  'Make it clean and Print On Demand friendly.',
  'Avoid using specific colors and elements from the last output unless explicitly requested.',
  'Make sure the font styling is different.',
  'Add only a few supporting elements and keep the design uncluttered.',
  'Make the text large, bold, easy to read, and visually uniform.',
  'Do not use cursive, script, handwritten, or AI brush-style text unless explicitly requested.',
  'Avoid adding decorative elements on top of text.',
  'Prefer straight text baselines; avoid curved, arched, or warped text unless requested.',
  'Use solid typography colors and avoid text gradients unless requested.',
  'Avoid ribbons.',
  'Use a real transparent background with true alpha; never fake transparency.',
  'Use a 4:5 output aspect ratio.',
  'Do not add text when the reference has no text.',
  'If the reference is text-only, add only minimal supporting elements based on the theme.'
];

let mainWindow;
const sessions = new SessionManager();
const projects = new ProjectStore();
const chatgpt = new ChatGPTController({ sessions, projects, podRules: POD_RULES });
const metadata = new MetadataController({ sessions, projects });
const vectorizer = new VectorizerController({ sessions, projects });
const exporter = new ExportController({ projects });
const redbubble = new RedbubbleController({ sessions, projects });
const automationStore = new AutomationQueueStore();
const automation = new AutomationQueueController({ store: automationStore, projects, chatgpt, metadata, vectorizer, exporter, redbubble });
const workspace = new WorkspaceManager({ projects, automationStore });

function enrich(project) { return { ...project, workflow: workflow.describe(project) }; }
function linkedLiveRows(projectId) {
  return automationStore.read().rows.filter((row) => row.projectId === projectId && !['completed', 'skipped'].includes(row.status));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420, height: 900, minWidth: 1100, minHeight: 720,
    backgroundColor: '#101114', title: 'ZeroPOD',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  await automation.recoverAfterRestart();

  ipcMain.handle('connections:list', () => sessions.getStatuses());
  ipcMain.handle('connections:login', (_event, serviceId) => sessions.login(serviceId));
  ipcMain.handle('connections:test', (_event, serviceId) => sessions.test(serviceId));
  ipcMain.handle('connections:preflight', () => sessions.preflight(['chatgpt', 'vectorizer', 'redbubble']));
  ipcMain.handle('connections:logout', (_event, serviceId) => sessions.logout(serviceId));
  ipcMain.handle('pod:rules', () => POD_RULES);
  ipcMain.handle('projects:list', () => projects.list().map(enrich));
  ipcMain.handle('projects:archived', () => projects.list({ archivedOnly: true }).map(enrich));
  ipcMain.handle('projects:get', (_event, projectId) => enrich(projects.read(projectId)));
  ipcMain.handle('projects:duplicates', (_event, sourceUrl) => projects.findBySourceUrl(sourceUrl).map(enrich));
  ipcMain.handle('projects:archive', (_event, projectId) => {
    const live = linkedLiveRows(projectId);
    if (live.some((row) => row.status === 'running')) throw new Error('Cannot archive a project while its Automation List row is running. Pause the queue first.');
    return enrich(projects.archive(projectId));
  });
  ipcMain.handle('projects:restore', (_event, projectId) => enrich(projects.restore(projectId)));
  ipcMain.handle('projects:delete', (_event, projectId) => {
    const live = linkedLiveRows(projectId);
    if (live.length) throw new Error('This project is still linked to an active Automation List row. Remove or complete that row before deleting the project.');
    return projects.delete(projectId);
  });
  ipcMain.handle('workspace:backup', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose ZeroPOD backup destination', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, ...workspace.exportTo(result.filePaths[0]) };
  });

  ipcMain.handle('generation:start', (_event, payload) => chatgpt.start(payload));
  ipcMain.handle('review:reject', async (_event, { projectId, notes }) => {
    const project = projects.read(projectId); workflow.assertReviewable(project);
    projects.write({ ...project, status: 'regenerating', review: { decision: 'rejected', notes: notes || '' } });
    return chatgpt.start({ referencePath: project.referencePath, sourceUrl: project.sourceUrl, reviewNotes: notes || '', existingProjectId: projectId });
  });
  ipcMain.handle('review:pass', (_event, { projectId }) => {
    const project = projects.read(projectId); workflow.assertReviewable(project);
    return projects.write({ ...project, status: 'approved-image', review: { ...project.review, decision: 'passed' } });
  });
  ipcMain.handle('metadata:generate', (_event, projectId) => { const project = projects.read(projectId); workflow.assertMetadata(project); return metadata.generate(projectId); });
  ipcMain.handle('metadata:save', (_event, { projectId, metadata: nextMetadata }) => {
    const validation = validateMetadata(nextMetadata, projects.list(), projectId);
    if (!validation.ok) throw new Error(validation.errors.join(' '));
    const updated = projects.update(projectId, { metadata: validation.metadata, metadataMode: 'POD WINNER', metadataEditedAt: new Date().toISOString() });
    return { ok: true, validation, project: enrich(updated) };
  });
  ipcMain.handle('quality:check', async (_event, projectId) => {
    const project = projects.read(projectId); const result = await validateProject(project, projects.list());
    projects.update(projectId, { qualityCheck: { ...result, checkedAt: new Date().toISOString() } }); return result;
  });
  ipcMain.handle('vectorizer:start', (_event, projectId) => { const project = projects.read(projectId); workflow.assertVectorize(project); return vectorizer.start(projectId); });
  ipcMain.handle('export:png', (_event, projectId) => { const project = projects.read(projectId); workflow.assertExport(project); return exporter.exportPng(projectId); });
  ipcMain.handle('redbubble:prepare', async (_event, projectId) => {
    const project = projects.read(projectId); workflow.assertRedbubblePrepare(project);
    const validation = await validateProject(project, projects.list()); projects.update(projectId, { qualityCheck: { ...validation, checkedAt: new Date().toISOString() } });
    if (!validation.ok) throw new Error(`Quality check failed: ${validation.errors.join(' ')}`); return redbubble.prepare(projectId);
  });
  ipcMain.handle('redbubble:publish', async (_event, projectId) => {
    const project = projects.read(projectId); workflow.assertPublish(project); const validation = await validateProject(project, projects.list());
    if (!validation.ok) throw new Error(`Quality check failed: ${validation.errors.join(' ')}`); return redbubble.publish(projectId);
  });

  ipcMain.handle('automation:list', () => automation.snapshot());
  ipcMain.handle('automation:add', (_event, rows) => automation.addRows(rows));
  ipcMain.handle('automation:update', (_event, { rowId, patch }) => automation.updateRow(rowId, patch));
  ipcMain.handle('automation:move', (_event, { rowIds, direction }) => automationStore.moveRows(rowIds, direction));
  ipcMain.handle('automation:remove', (_event, rowId) => automation.removeRow(rowId));
  ipcMain.handle('automation:clear-completed', () => automation.clearCompleted());
  ipcMain.handle('automation:start', async () => {
    const preflight = await sessions.preflight(['chatgpt', 'vectorizer', 'redbubble']);
    if (!preflight.ok) {
      const names = preflight.needsLogin.map((id) => sessions.getStatuses()[id]?.name || id).join(', ');
      throw new Error(`Login required before starting the queue: ${names}. Open Connections, sign in normally, then test the session.`);
    }
    return { ...automation.start(), preflight };
  });
  ipcMain.handle('automation:pause', () => automation.pause());
  ipcMain.handle('automation:stop', () => automation.stop());
  ipcMain.handle('automation:import-csv', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import ZeroPOD Automation List CSV', properties: ['openFile'], filters: [{ name: 'CSV files', extensions: ['csv'] }] });
    if (result.canceled) return { canceled: true }; const rows = parseCsv(fs.readFileSync(result.filePaths[0], 'utf8'));
    if (!rows.length) throw new Error('CSV did not contain any automation rows.'); automation.addRows(rows); return { canceled: false, imported: rows.length, snapshot: automation.snapshot() };
  });
  ipcMain.handle('automation:export-csv', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Export ZeroPOD Automation List', defaultPath: 'ZeroPOD-Automation-List.csv', filters: [{ name: 'CSV files', extensions: ['csv'] }] });
    if (result.canceled || !result.filePath) return { canceled: true }; fs.writeFileSync(result.filePath, toCsv(automation.snapshot().rows), 'utf8'); return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('automation:import-xlsx', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import ZeroPOD Automation List Excel File', properties: ['openFile'], filters: [{ name: 'Excel workbooks', extensions: ['xlsx'] }] });
    if (result.canceled) return { canceled: true }; const rows = await readAutomationWorkbook(result.filePaths[0]);
    if (!rows.length) throw new Error('Excel workbook did not contain any automation rows.'); automation.addRows(rows); return { canceled: false, imported: rows.length, snapshot: automation.snapshot() };
  });
  ipcMain.handle('automation:export-xlsx', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Export ZeroPOD Automation List Excel File', defaultPath: 'ZeroPOD-Automation-List.xlsx', filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] });
    if (result.canceled || !result.filePath) return { canceled: true }; await writeAutomationWorkbook(result.filePath, automation.snapshot().rows); return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('file:choose-reference', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose reference image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('file:choose-multiple-references', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose reference images for Automation List', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    return result.canceled ? [] : result.filePaths;
  });
  createWindow();
});

app.on('window-all-closed', async () => {
  automation.pause(); automationStore.markCleanShutdown(); await sessions.closeAll(); app.quit();
});
