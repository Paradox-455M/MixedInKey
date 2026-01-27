const { contextBridge, ipcRenderer } = require('electron');

console.log('[PRELOAD] Setting up electron API bridge...');

contextBridge.exposeInMainWorld('electronAPI', {
  // Audio analysis
  analyzeAudioFile: (filePath) => {
    console.log('[PRELOAD] analyzeAudioFile called with:', filePath);
    return ipcRenderer.invoke('analyze-audio-file', filePath);
  },

  analyzeAudioFilesBatch: (filePaths) => {
    console.log('[PRELOAD] analyzeAudioFilesBatch called with:', filePaths.length, 'files');
    return ipcRenderer.invoke('analyze-audio-files-batch', filePaths);
  },

  // Listen for batch analysis progress updates
  onBatchAnalysisProgress: (callback) => {
    ipcRenderer.on('batch-analysis-progress', (event, progress) => callback(progress));
  },

  removeBatchAnalysisProgressListener: () => {
    ipcRenderer.removeAllListeners('batch-analysis-progress');
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

  exportSerato: (data) => {
    console.log('[PRELOAD] exportSerato called');
    return ipcRenderer.invoke('export-serato', data);
  },

  exportTraktor: (data) => {
    console.log('[PRELOAD] exportTraktor called');
    return ipcRenderer.invoke('export-traktor', data);
  },

  exportSetPlanSerato: (data) => {
    console.log('[PRELOAD] exportSetPlanSerato called');
    return ipcRenderer.invoke('export-set-plan-serato', data);
  },

  exportSetPlanTraktor: (data) => {
    console.log('[PRELOAD] exportSetPlanTraktor called');
    return ipcRenderer.invoke('export-set-plan-traktor', data);
  },

  separateStems: (filePath) => {
    console.log('[PRELOAD] separateStems called');
    return ipcRenderer.invoke('separate-stems', { filePath });
  },

  // Platform info
  platform: process.platform,

  // App version
  appVersion: process.env.npm_package_version || '1.0.0'
});

console.log('[PRELOAD] Electron API bridge setup complete'); 