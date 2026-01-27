const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

let mainWindow;

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function filePathToUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return `file://localhost/${encodeURI(normalized)}`;
}

function buildRekordboxXml({ tracks, playlistName, includeCuePoints = false }) {
  const entries = tracks.length;
  const safeName = playlistName || 'Mixed In AI Set';
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<DJ_PLAYLISTS Version="1.0.0">');
  lines.push('  <PRODUCT Name="rekordbox" Version="7.0.4" Company="AlphaTheta"/>');
  lines.push(`  <COLLECTION Entries="${entries}">`);
  tracks.forEach((track, idx) => {
    const trackId = idx + 1;
    const location = filePathToUrl(track.path);
    const bpm = track.bpm ? `AverageBpm="${Math.round(track.bpm)}"` : '';
    const key = track.key ? `Tonality="${track.key}"` : '';
    
    lines.push(`    <TRACK TrackID="${trackId}" Name="${escapeXml(track.name)}" ` +
      `Artist="${escapeXml(track.artist || 'Unknown Artist')}" ` +
      `Album="${escapeXml(track.album || 'Unknown Album')}" ` +
      `Location="${escapeXml(location)}" ${bpm} ${key}>`);
    
    // Add cue points if available and requested
    if (includeCuePoints && track.analysis && track.analysis.cue_points) {
      track.analysis.cue_points.forEach((cue, cueIdx) => {
        const cueName = escapeXml(cue.name || `Cue ${cueIdx + 1}`);
        const cueTime = Math.round((cue.time || 0) * 1000); // Convert to milliseconds
        const cueType = cue.type || 'CUE';
        lines.push(`      <POSITION_MARK Name="${cueName}" Type="${cueType}" Start="${cueTime}" />`);
      });
    }
    
    // Add mix in/out points
    if (track.mixInTime !== undefined && track.mixInTime !== null) {
      const mixInMs = Math.round(track.mixInTime * 1000);
      lines.push(`      <POSITION_MARK Name="Mix In" Type="CUE" Start="${mixInMs}" />`);
    }
    if (track.mixOutTime !== undefined && track.mixOutTime !== null) {
      const mixOutMs = Math.round(track.mixOutTime * 1000);
      lines.push(`      <POSITION_MARK Name="Mix Out" Type="CUE" Start="${mixOutMs}" />`);
    }
    
    lines.push('    </TRACK>');
  });
  lines.push('  </COLLECTION>');
  lines.push('  <PLAYLISTS>');
  lines.push('    <NODE Type="0" Name="ROOT" Count="1">');
  lines.push(
    `      <NODE Name="${escapeXml(safeName)}" Type="1" KeyType="0" Entries="${entries}">`
  );
  tracks.forEach((track, idx) => {
    lines.push(`        <TRACK Key="${idx + 1}" />`);
  });
  lines.push('      </NODE>');
  lines.push('    </NODE>');
  lines.push('  </PLAYLISTS>');
  lines.push('</DJ_PLAYLISTS>');
  return lines.join('\n');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    titleBarStyle: 'default',
    show: false,
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle file analysis
ipcMain.handle('analyze-audio-file', async (event, filePath) => {
  console.log(`🔍 [MAIN] Starting analysis for file: ${filePath}`);
  console.log(`🔍 [MAIN] File path type: ${typeof filePath}`);
  console.log(`🔍 [MAIN] File path length: ${filePath ? filePath.length : 'undefined'}`);

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`❌ [MAIN] File does not exist: ${filePath}`);
      throw new Error(`File does not exist: ${filePath}`);
    }

    // Resolve Python interpreter with preflight import check (prefer a working system Python)
    const envOverride = process.env.MIXEDIN_PYTHON && String(process.env.MIXEDIN_PYTHON).trim();
    const systemCandidates = process.platform === 'win32'
      ? ['python', 'python3']
      : ['/usr/bin/python3', 'python3', 'python'];
    const venvCandidates = process.platform === 'win32'
      ? [
        path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe'),
        path.join(__dirname, '..', 'venv', 'Scripts', 'python3.exe')
      ]
      : [
        path.join(__dirname, '..', 'venv', 'bin', 'python3'),
        path.join(__dirname, '..', 'venv', 'bin', 'python')
      ];

    const candidates = [envOverride, ...systemCandidates, ...venvCandidates].filter((p) => !!p);

    function getRequirementsPath() {
      // In dev tree
      const devReq = path.join(__dirname, '..', 'requirements.txt');
      if (fs.existsSync(devReq)) return devReq;
      // In packaged app resources
      const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'requirements.txt') : null;
      if (packaged && fs.existsSync(packaged)) return packaged;
      return null;
    }

    function preflightPython(p) {
      try {
        const script = 'import os; os.environ.setdefault("OPENBLAS_NUM_THREADS","1"); os.environ.setdefault("OMP_NUM_THREADS","1"); import numpy as _np; import soundfile as _sf; import librosa as _lb; print("ok")';
        const res = spawnSync(p, ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
        if (res && res.status === 0 && String(res.stdout || '').toString().includes('ok')) {
          return true;
        }
      } catch (e) {
        // ignore
      }
      return false;
    }

    function attemptInstallDependencies(p) {
      const reqPath = getRequirementsPath();
      if (!reqPath) return false;
      try {
        console.log(`📦 [MAIN] Installing Python deps with ${p} -m pip install -r ${reqPath}`);
        const install = spawnSync(p, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', reqPath], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        console.log(`📦 [MAIN] pip install status: ${install.status}`);
        if (install.status === 0) {
          // Re-test imports
          return preflightPython(p);
        }
      } catch (e) {
        console.log('❌ [MAIN] pip install attempt failed:', e.message);
      }
      return false;
    }

    let pythonPath = null;
    let venvBinPath = null;
    for (const candidate of candidates) {
      if (!candidate) continue;
      const exists = candidate.includes(path.sep) ? fs.existsSync(candidate) : true;
      if (!exists) continue;
      if (preflightPython(candidate) || attemptInstallDependencies(candidate)) {
        pythonPath = candidate;
        if (candidate.includes(`${path.sep}venv${path.sep}`)) {
          venvBinPath = path.dirname(candidate);
        }
        break;
      }
    }

    if (pythonPath) {
      console.log(`🐍 [MAIN] Using Python at: ${pythonPath}`);
    } else {
      console.log('❌ [MAIN] No working Python interpreter found for imports.');
      throw new Error('No working Python interpreter found. Please ensure Python 3 and required packages are installed, or include the project venv.');
    }

    // Support both packaged extraResources and dev tree
    let scriptPath = path.join(__dirname, 'backend/analyzer.py');
    if (!fs.existsSync(scriptPath)) {
      // When packaged, backend is copied next to app.asar under resources
      const alt1 = path.join(process.resourcesPath || '', 'backend', 'analyzer.py');
      if (fs.existsSync(alt1)) {
        scriptPath = alt1;
      } else {
        // Fallback to project root layout during dev
        const alt2 = path.join(__dirname, '..', 'src', 'backend', 'analyzer.py');
        if (fs.existsSync(alt2)) scriptPath = alt2;
      }
    }
    console.log(`📜 [MAIN] Script path: ${scriptPath}`);

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      console.log(`❌ [MAIN] Script does not exist: ${scriptPath}`);
      throw new Error(`Analyzer script not found: ${scriptPath}`);
    }

    return new Promise((resolve, reject) => {
      console.log(`🚀 [MAIN] Spawning Python process with args: [${scriptPath}, ${filePath}]`);
      const envPath = venvBinPath ? `${venvBinPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}` : process.env.PATH;
      const pythonProcess = spawn(pythonPath, [scriptPath, filePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: envPath,
          VIRTUAL_ENV: venvBinPath ? path.join(__dirname, '..', 'venv') : process.env.VIRTUAL_ENV,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          NUMBA_NUM_THREADS: '1',
          NUMBA_CACHE_DIR: path.join(app.getPath('userData') || __dirname, 'numba_cache')
        }
      });

      let result = '';
      let error = '';

      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`📤 [PYTHON STDOUT] ${output.trim()}`);
        result += output;
      });

      pythonProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        console.log(`❌ [PYTHON STDERR] ${errorOutput.trim()}`);
        error += errorOutput;
      });

      const timeoutMs = Number(process.env.ANALYSIS_TIMEOUT_MS || 180000); // default 3 minutes
      const timeoutId = setTimeout(() => {
        console.log(`⏰ [MAIN] Analysis timeout after ${timeoutMs} ms`);
        try { pythonProcess.kill(); } catch (e) { }
        reject(new Error(`Analysis timeout after ${timeoutMs} ms`));
      }, timeoutMs);

      pythonProcess.on('close', (code) => {
        clearTimeout(timeoutId);
        console.log(`🏁 [MAIN] Python process exited with code: ${code}`);
        console.log(`📊 [MAIN] Result length: ${result.length}`);
        console.log(`📊 [MAIN] Error length: ${error.length}`);

        if (code === 0) {
          try {
            console.log(`📋 [MAIN] Parsing JSON result...`);
            console.log(`📄 [MAIN] Raw result preview: ${result.substring(0, 200)}...`);
            const analysis = JSON.parse(result);
            if (!analysis || analysis.error) {
              throw new Error(analysis?.message || 'Analyzer returned no data');
            }
            console.log(`✅ [MAIN] Analysis completed successfully`);
            resolve(analysis);
          } catch (parseError) {
            console.log(`❌ [MAIN] JSON parse error: ${parseError.message}`);
            console.log(`📄 [MAIN] Raw result: ${result}`);
            reject(new Error(`Failed to parse analysis result: ${parseError.message}`));
          }
        } else {
          console.log(`❌ [MAIN] Python process failed with code ${code}`);
          console.log(`📄 [MAIN] Error output: ${error}`);
          const hint = 'Ensure Python 3 with numpy/librosa/soundfile is installed or use the provided venv. You can run: venv/bin/pip install -r requirements.txt';
          reject(new Error(`Python process failed (code ${code}). ${error || ''} ${hint}`));
        }
      });

      pythonProcess.on('error', (err) => {
        console.log(`❌ [MAIN] Python process error: ${err.message}`);
        console.log(`❌ [MAIN] Error details:`, err);
        reject(new Error(`Failed to start Python process: ${err.message}`));
      });

      // timeout handled above
    });
  } catch (error) {
    console.log(`❌ [MAIN] Analysis failed: ${error.message}`);
    console.log(`❌ [MAIN] Error stack:`, error.stack);
    throw new Error(`Analysis failed: ${error.message}`);
  }
});

// Handle file selection
ipcMain.handle('select-audio-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aiff', 'm4a'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled) {
    return result.filePaths;
  }
  return [];
});

// Handle batch file analysis
ipcMain.handle('analyze-audio-files-batch', async (event, filePaths) => {
  console.log(`🔍 [MAIN] Starting batch analysis for ${filePaths.length} files`);
  
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('No file paths provided for batch analysis');
  }

  // Validate files exist
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
  }

  try {
    // Find Python interpreter (reuse logic from single file analysis)
    const envOverride = process.env.MIXEDIN_PYTHON && String(process.env.MIXEDIN_PYTHON).trim();
    const systemCandidates = process.platform === 'win32'
      ? ['python', 'python3']
      : ['/usr/bin/python3', 'python3', 'python'];
    const venvCandidates = process.platform === 'win32'
      ? [
        path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe'),
        path.join(__dirname, '..', 'venv', 'Scripts', 'python3.exe')
      ]
      : [
        path.join(__dirname, '..', 'venv', 'bin', 'python3'),
        path.join(__dirname, '..', 'venv', 'bin', 'python')
      ];

    const candidates = [envOverride, ...systemCandidates, ...venvCandidates].filter((p) => !!p);

    function preflightPython(p) {
      try {
        const script = 'import os; os.environ.setdefault("OPENBLAS_NUM_THREADS","1"); os.environ.setdefault("OMP_NUM_THREADS","1"); import numpy as _np; import soundfile as _sf; import librosa as _lb; print("ok")';
        const res = spawnSync(p, ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
        if (res && res.status === 0 && String(res.stdout || '').toString().includes('ok')) {
          return true;
        }
      } catch (e) {
        // ignore
      }
      return false;
    }

    let pythonPath = null;
    let venvBinPath = null;
    for (const candidate of candidates) {
      if (!candidate) continue;
      const exists = candidate.includes(path.sep) ? fs.existsSync(candidate) : true;
      if (!exists) continue;
      if (preflightPython(candidate)) {
        pythonPath = candidate;
        if (candidate.includes(`${path.sep}venv${path.sep}`)) {
          venvBinPath = path.dirname(candidate);
        }
        break;
      }
    }

    if (!pythonPath) {
      throw new Error('No working Python interpreter found');
    }

    // Find batch analyzer script
    let scriptPath = path.join(__dirname, 'backend', 'batch_analyzer.py');
    if (!fs.existsSync(scriptPath)) {
      const alt1 = path.join(process.resourcesPath || '', 'backend', 'batch_analyzer.py');
      if (fs.existsSync(alt1)) {
        scriptPath = alt1;
      } else {
        const alt2 = path.join(__dirname, '..', 'src', 'backend', 'batch_analyzer.py');
        if (fs.existsSync(alt2)) scriptPath = alt2;
      }
    }

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Batch analyzer script not found: ${scriptPath}`);
    }

    return new Promise((resolve, reject) => {
      console.log(`🚀 [MAIN] Spawning Python batch process with ${filePaths.length} files`);
      const envPath = venvBinPath ? `${venvBinPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}` : process.env.PATH;
      
      const pythonProcess = spawn(pythonPath, [scriptPath, ...filePaths], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: envPath,
          VIRTUAL_ENV: venvBinPath ? path.join(__dirname, '..', 'venv') : process.env.VIRTUAL_ENV,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          NUMBA_NUM_THREADS: '1',
          OMP_NUM_THREADS: '1',
          OPENBLAS_NUM_THREADS: '1',
          MKL_NUM_THREADS: '1',
          VECLIB_MAXIMUM_THREADS: '1',
          NUMEXPR_NUM_THREADS: '1',
          NUMBA_CACHE_DIR: path.join(app.getPath('userData') || __dirname, 'numba_cache')
        }
      });

      let result = '';
      let error = '';
      const progressUpdates = [];

      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`📤 [PYTHON STDOUT] ${output.trim()}`);
        result += output;
      });

      pythonProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        // Check if it's a progress update (JSON on stderr)
        try {
          const lines = errorOutput.split('\n').filter(l => l.trim());
          for (const line of lines) {
            if (line.trim().startsWith('{')) {
              const progress = JSON.parse(line.trim());
              if (progress.type === 'progress') {
                progressUpdates.push(progress);
                // Emit progress event to renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('batch-analysis-progress', progress);
                }
                continue;
              }
            }
          }
        } catch (e) {
          // Not JSON, treat as error
        }
        console.log(`❌ [PYTHON STDERR] ${errorOutput.trim()}`);
        error += errorOutput;
      });

      const timeoutMs = Number(process.env.BATCH_ANALYSIS_TIMEOUT_MS || 600000); // 10 minutes default
      const timeoutId = setTimeout(() => {
        console.log(`⏰ [MAIN] Batch analysis timeout after ${timeoutMs} ms`);
        try { pythonProcess.kill(); } catch (e) { }
        reject(new Error(`Batch analysis timeout after ${timeoutMs} ms`));
      }, timeoutMs);

      pythonProcess.on('close', (code, signal) => {
        clearTimeout(timeoutId);
        console.log(`🏁 [MAIN] Python batch process exited with code: ${code}, signal: ${signal}`);

        // Handle null exit code (process killed or crashed)
        if (code === null || code === undefined) {
          const errorMsg = signal 
            ? `Python batch process was killed by signal: ${signal}` 
            : `Python batch process crashed or was terminated unexpectedly`;
          console.log(`❌ [MAIN] ${errorMsg}`);
          console.log(`❌ [MAIN] Error output: ${error || '(no error output)'}`);
          console.log(`❌ [MAIN] Standard output: ${result || '(no output)'}`);
          
          // Try to parse any JSON output that might have been captured before crash
          if (result.trim()) {
            try {
              const partialResult = JSON.parse(result);
              if (partialResult.error) {
                reject(new Error(`${errorMsg}. ${partialResult.message || ''}`));
                return;
              }
            } catch (e) {
              // Not JSON, continue with generic error
            }
          }
          
          reject(new Error(`${errorMsg}. ${error ? `Error output: ${error}` : 'Check logs for details.'}`));
          return;
        }

        if (code === 0) {
          try {
            const analysis = JSON.parse(result);
            if (analysis.error) {
              throw new Error(analysis.message || 'Batch analysis failed');
            }
            console.log(`✅ [MAIN] Batch analysis completed: ${analysis.successful}/${analysis.total} successful`);
            resolve(analysis);
          } catch (parseError) {
            console.log(`❌ [MAIN] JSON parse error: ${parseError.message}`);
            console.log(`❌ [MAIN] Raw output: ${result}`);
            reject(new Error(`Failed to parse batch analysis result: ${parseError.message}`));
          }
        } else {
          console.log(`❌ [MAIN] Python batch process failed with code ${code}`);
          console.log(`❌ [MAIN] Error output: ${error || '(no error output)'}`);
          
          // Try to parse error output as JSON (Python script might have output JSON error before exit)
          if (result.trim()) {
            try {
              const errorResult = JSON.parse(result);
              if (errorResult.error) {
                reject(new Error(`Python batch process failed: ${errorResult.message || errorResult.error}. ${errorResult.traceback ? `\nTraceback:\n${errorResult.traceback}` : ''}`));
                return;
              }
            } catch (e) {
              // Not JSON, use generic error
            }
          }
          
          reject(new Error(`Python batch process failed (code ${code}). ${error || 'No error details available.'}`));
        }
      });

      pythonProcess.on('error', (err) => {
        console.log(`❌ [MAIN] Python batch process error: ${err.message}`);
        reject(new Error(`Failed to start Python batch process: ${err.message}`));
      });
    });
  } catch (error) {
    console.log(`❌ [MAIN] Batch analysis failed: ${error.message}`);
    throw new Error(`Batch analysis failed: ${error.message}`);
  }
});

// Handle export functionality
ipcMain.handle('export-analysis', async (event, { filePath, analysis, format }) => {
  try {
    const exportPath = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.basename(filePath, path.extname(filePath)) + '_analysis.json',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!exportPath.canceled) {
      const exportData = {
        originalFile: filePath,
        analysis,
        exportDate: new Date().toISOString(),
        format
      };

      fs.writeFileSync(exportPath.filePath, JSON.stringify(exportData, null, 2));
      return exportPath.filePath;
    }
    return null;
  } catch (error) {
    throw new Error(`Export failed: ${error.message}`);
  }
});

// Helper to run Python export script
const runExportScript = async (format, args) => {
  const scriptPath = path.join(__dirname, '..', 'src', 'backend', 'export_manager.py');

  // Find Python
  const systemCandidates = [
    process.env.PYTHON_PATH,
    'python3',
    'python',
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3'
  ];
  const venvCandidates = process.platform === 'win32'
    ? [path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe')]
    : [path.join(__dirname, '..', 'venv', 'bin', 'python3')];

  const candidates = [...venvCandidates, ...systemCandidates].filter(p => !!p);

  let pythonPath = 'python';
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
      pythonPath = candidate;
      break;
    } catch (e) { }
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, [scriptPath, format, ...args]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Export process failed: ${stderr}`));
      } else {
        try {
          // Parse last line as JSON
          const lines = stdout.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          resolve(JSON.parse(lastLine));
        } catch (e) {
          resolve({ status: 'success', output: stdout }); // Fallback
        }
      }
    });
  });
};

// Export to Serato
ipcMain.handle('export-serato', async (event, { filePath, analysis }) => {
  try {
    const jsonStr = JSON.stringify(analysis || {});
    const result = await runExportScript('serato', ['--file', filePath, '--json', jsonStr]);
    return result;
  } catch (err) {
    console.error("Serato export error:", err);
    throw err;
  }
});

// Export to Traktor
ipcMain.handle('export-traktor', async (event, { tracks, outputPath, playlistName, isPlaylist = false }) => {
  try {
    // Write tracks to temp json file to avoid cli length limits
    const tmpJson = path.join(app.getPath('temp'), `traktor_export_${Date.now()}.json`);
    fs.writeFileSync(tmpJson, JSON.stringify(tracks));

    const outPath = outputPath || path.join(app.getPath('documents'), isPlaylist ? 'playlist.nml' : 'collection.nml');

    const args = [
      '--json-file', tmpJson,
      '--output', outPath
    ];
    
    if (isPlaylist) {
      args.push('--playlist');
      if (playlistName) {
        args.push('--playlist-name', playlistName);
      }
    }

    const result = await runExportScript('traktor', args);

    fs.unlinkSync(tmpJson); // cleanup
    return result;
  } catch (err) {
    console.error("Traktor export error:", err);
    throw err;
  }
});

// Export set plan to Serato playlist
ipcMain.handle('export-set-plan-serato', async (event, { tracks, playlistName }) => {
  try {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      throw new Error('No tracks provided for Serato playlist export.');
    }

    const exportPath = await dialog.showSaveDialog(mainWindow, {
      defaultPath: (playlistName || 'mixedinai_set') + '.m3u8',
      filters: [
        { name: 'M3U8 Playlist Files', extensions: ['m3u8'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!exportPath.canceled) {
      // Write tracks to temp json file
      const tmpJson = path.join(app.getPath('temp'), `serato_playlist_${Date.now()}.json`);
      fs.writeFileSync(tmpJson, JSON.stringify(tracks));

      const result = await runExportScript('serato', [
        '--json-file', tmpJson,
        '--output', exportPath.filePath,
        '--playlist-name', playlistName || 'Mixed In AI Set',
        '--playlist'
      ]);

      fs.unlinkSync(tmpJson); // cleanup
      return result;
    }
    return null;
  } catch (error) {
    throw new Error(`Serato playlist export failed: ${error.message}`);
  }
});

// Export set plan to Traktor playlist
ipcMain.handle('export-set-plan-traktor', async (event, { tracks, playlistName }) => {
  try {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      throw new Error('No tracks provided for Traktor playlist export.');
    }

    const exportPath = await dialog.showSaveDialog(mainWindow, {
      defaultPath: (playlistName || 'mixedinai_set') + '.nml',
      filters: [
        { name: 'NML Files', extensions: ['nml'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!exportPath.canceled) {
      // Write tracks to temp json file
      const tmpJson = path.join(app.getPath('temp'), `traktor_playlist_${Date.now()}.json`);
      fs.writeFileSync(tmpJson, JSON.stringify(tracks));

      const result = await runExportScript('traktor', [
        '--json-file', tmpJson,
        '--output', exportPath.filePath,
        '--playlist-name', playlistName || 'Mixed In AI Set',
        '--playlist'
      ]);

      fs.unlinkSync(tmpJson); // cleanup
      return result;
    }
    return null;
  } catch (error) {
    throw new Error(`Traktor playlist export failed: ${error.message}`);
  }
});

// Stem Separation
ipcMain.handle('separate-stems', async (event, { filePath, model }) => {
  const scriptPath = path.join(__dirname, '..', 'src', 'backend', 'stems', 'separator.py');
  console.log(`[MAIN] Starting stem separation for ${filePath}`);

  // Find Python (reuse logic or copy)
  const systemCandidates = [
    process.env.PYTHON_PATH,
    'python3',
    'python',
    '/Users/rahulsharma/Downloads/MixedInKey/venv/bin/python'
  ];
  const venvCandidates = process.platform === 'win32'
    ? [path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe')]
    : [path.join(__dirname, '..', 'venv', 'bin', 'python3')];

  const candidates = [...venvCandidates, ...systemCandidates].filter(p => !!p);

  let pythonPath = 'python';
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
      pythonPath = candidate;
      break;
    } catch (e) { }
  }

  return new Promise((resolve, reject) => {
    // python separator.py <file>
    // but the script as written checks sys.argv[1].
    // I should invoke it directly.
    const proc = spawn(pythonPath, [scriptPath, filePath]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', code => {
      console.log(`[MAIN] Stem separation exited with code ${code}`);
      if (code !== 0) {
        console.error(`[MAIN] Stems stderr: ${stderr}`);
        reject(new Error(`Stem separation failed: ${stderr}`));
      } else {
        try {
          // Parse JSON output
          const result = JSON.parse(stdout.trim());
          if (result.error) reject(new Error(result.error));
          else resolve(result);
        } catch (e) {
          reject(new Error(`Invalid JSON from separator: ${stdout}`));
        }
      }
    });
  });
});

// Export Rekordbox XML playlist
ipcMain.handle('export-rekordbox-xml', async (event, { playlistName, tracks, includeCuePoints = false }) => {
  try {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      throw new Error('No tracks provided for Rekordbox export.');
    }

    const exportPath = await dialog.showSaveDialog(mainWindow, {
      defaultPath: (playlistName || 'mixedinai_set') + '.xml',
      filters: [
        { name: 'XML Files', extensions: ['xml'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!exportPath.canceled) {
      const xml = buildRekordboxXml({ tracks, playlistName, includeCuePoints });
      fs.writeFileSync(exportPath.filePath, xml, 'utf8');
      return exportPath.filePath;
    }
    return null;
  } catch (error) {
    throw new Error(`Rekordbox export failed: ${error.message}`);
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
} 