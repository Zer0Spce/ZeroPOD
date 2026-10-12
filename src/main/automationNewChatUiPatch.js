const { app, BrowserWindow } = require('electron');

function installAutomationNewChatScript(window) {
  if (!window?.webContents) return;

  const inject = () => {
    const currentUrl = window.webContents.getURL();
    if (!currentUrl || !currentUrl.startsWith('file:')) return;
    window.webContents.executeJavaScript(`(() => {
      if (document.querySelector('script[data-zeropod-automation-new-chat]')) return;
      const script = document.createElement('script');
      script.src = 'automationNewChat.js';
      script.dataset.zeropodAutomationNewChat = '1';
      document.body.appendChild(script);
    })()`).catch(() => {});
  };

  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', inject);
  else inject();
}

app.on('browser-window-created', (_event, window) => installAutomationNewChatScript(window));

app.whenReady().then(() => {
  for (const window of BrowserWindow.getAllWindows()) installAutomationNewChatScript(window);
});

module.exports = { installAutomationNewChatScript };
