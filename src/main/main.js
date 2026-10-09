const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { SessionManager } = require('./sessionManager');
const { ProjectStore } = require('./projectStore');
const { ChatGPTController } = require('./chatgptController');
const { MetadataController } = require('./metadataController');
const { VectorizerController } = require('./vectorizerController');
const { ExportController } = require('./exportController');
const { RedbubbleController } = require('./redbubbleController');
const workflow = require('./workflowState');

const POD_RULES = [
  'Copy slogan and create a new style.',
  'Make it clean and Print On Demand friendly.',
  'Avoid using specific colors and elements from the last output unless explicitly requested.',
  'Make sure the font styling is different.',
  'Add a few supporting elements, but do not add too much.',
  'Make the text large and easy to read.',
  'Do not use cursive text unless explicitly defined.',
  'Avoid adding decorative elements on top of text.',
  'Keep text large and visually uniform.',
  'Avoid ribbons.',
  'Use a real transparent background with true alpha; never fake transparency.',
  'Use a 4:5 output aspect ratio.',
  'Do not use AI brush-style text.'
];

let mainWindow;
const sessions = new SessionManager();
const projects = new ProjectStore();
const chatgpt = new ChatGPTController({ sessions, projects, podRules: POD_RULES });
const metadata = new MetadataController({ sessions, projects });
const vectorizer = new VectorizerController({ sessions, projects });
const exporter = new ExportController({ projects });
const redbubble = new RedbubbleController({ sessions, projects });

function enrich(project) {
  return { ...project, workflow: workflow.describe(project) };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#101114',
    title: 'ZeroPOD',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('connections:list', () => sessions.getStatuses());
  ipcMain.handle('connections:login', (_event, serviceId) => sessions.login(serviceId));
  ipcMain.handle('connections:logout', (_event, serviceId) => sessions.logout(serviceId));
  ipcMain.handle('pod:rules', () => POD_RULES);
  ipcMain.handle('projects:list', () => projects.list().map(enrich));
  ipcMain.handle('projects:get', (_event, projectId) => enrich(projects.read(projectId)));
  ipcMain.handle('generation:start', (_event, payload) => chatgpt.start(payload));
  ipcMain.handle('review:reject', async (_event, { projectId, notes }) => {
    const project = projects.read(projectId);
    workflow.assertReviewable(project);
    projects.write({ ...project, status: 'regenerating', review: { decision: 'rejected', notes: notes || '' } });
    return chatgpt.start({ referencePath: project.referencePath, sourceUrl: project.sourceUrl, reviewNotes: notes || '', existingProjectId: projectId });
  });
  ipcMain.handle('review:pass', (_event, { projectId }) => {
    const project = projects.read(projectId);
    workflow.assertReviewable(project);
    return projects.write({ ...project, status: 'approved-image', review: { ...project.review, decision: 'passed' } });
  });
  ipcMain.handle('metadata:generate', (_event, projectId) => {
    const project = projects.read(projectId);
    workflow.assertMetadata(project);
    return metadata.generate(projectId);
  });
  ipcMain.handle('vectorizer:start', (_event, projectId) => {
    const project = projects.read(projectId);
    workflow.assertVectorize(project);
    return vectorizer.start(projectId);
  });
  ipcMain.handle('export:png', (_event, projectId) => {
    const project = projects.read(projectId);
    workflow.assertExport(project);
    return exporter.exportPng(projectId);
  });
  ipcMain.handle('redbubble:prepare', (_event, projectId) => {
    const project = projects.read(projectId);
    workflow.assertRedbubblePrepare(project);
    return redbubble.prepare(projectId);
  });
  ipcMain.handle('redbubble:publish', (_event, projectId) => {
    const project = projects.read(projectId);
    workflow.assertPublish(project);
    return redbubble.publish(projectId);
  });
  ipcMain.handle('file:choose-reference', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose reference image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  createWindow();
});

app.on('window-all-closed', async () => {
  await sessions.closeAll();
  app.quit();
});
