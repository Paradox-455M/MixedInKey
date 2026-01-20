const { contextBridge, ipcRenderer } = require('electron');

console.log('[PRELOAD] Setting up electron API bridge...');

contextBridge.exposeInMainWorld('electronAPI', {
  // Audio analysis
  analyzeAudioFile: (filePath) => {
    console.log('[PRELOAD] analyzeAudioFile called with:', filePath);
    return ipcRenderer.invoke('analyze-audio-file', filePath);
  },
  
  // File selection
  selectAudioFiles: () => {
    console.log('[PRELOAD] selectAudioFiles called');
    return ipcRenderer.invoke('select-audio-files');
  },
  
  // Export functionality
  exportAnalysis: (data) => {
    console.log('[PRELOAD] exportAnalysis called');
    return ipcRenderer.invoke('export-analysis', data);
  },

  exportRekordboxXml: (data) => {
    console.log('[PRELOAD] exportRekordboxXml called');
    return ipcRenderer.invoke('export-rekordbox-xml', data);
  },
  
  // Platform info
  platform: process.platform,
  
  // App version
  appVersion: process.env.npm_package_version || '1.0.0'
});

console.log('[PRELOAD] Electron API bridge setup complete'); 