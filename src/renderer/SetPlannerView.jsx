import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  Download,
  AlertCircle,
  Loader,
  ListMusic,
  X,
  ArrowUp,
  ArrowDown,
  CheckCircle
} from 'lucide-react';
import clsx from 'clsx';
import SetPlannerTable from './SetPlannerTable';
import TransitionVisualizer from './TransitionVisualizer';
import { buildSetPlan } from './setPlanner';
import './setPlannerView.css';

const SetPlannerView = ({ 
  analyzedTracks = [], 
  onAddToLibrary,
  onExportRekordbox,
  onExportSerato,
  onExportTraktor 
}) => {
  const [mode, setMode] = useState('drop'); // 'drop' | 'library'
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedLibraryTracks, setSelectedLibraryTracks] = useState([]);
  const [analysisSet, setAnalysisSet] = useState(null);
  const [setPlan, setSetPlan] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(null);
  const [error, setError] = useState(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(null);

  const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTimeSafe = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return 'N/A';
    return formatTime(seconds);
  };

  // Handle file drop
  const onDrop = useCallback((acceptedFiles) => {
    if (!acceptedFiles.length) return;
    setSelectedFiles(prev => [...prev, ...acceptedFiles]);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.flac', '.aiff', '.m4a']
    },
    multiple: true
  });

  // Handle file selection via button
  const handleFileSelect = async () => {
    try {
      const filePaths = await window.electronAPI.selectAudioFiles();
      if (filePaths.length > 0) {
        const files = filePaths.map((filePath) => ({
          path: filePath,
          name: filePath.split('/').pop()
        }));
        setSelectedFiles(prev => [...prev, ...files]);
        setError(null);
      }
    } catch (err) {
      setError(`File selection failed: ${err.message}`);
    }
  };

  // Remove file from selection
  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Analyze dropped files
  const handleAnalyzeFiles = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setIsAnalyzing(true);
    setError(null);
    setAnalysisProgress({ current: 0, total: selectedFiles.length, name: '' });

    try {
      const filePaths = selectedFiles.map(f => f.path);
      
      // Set up progress listener
      const progressHandler = (progress) => {
        setAnalysisProgress({
          current: progress.current,
          total: progress.total,
          name: progress.file
        });
      };
      
      window.electronAPI.onBatchAnalysisProgress(progressHandler);
      
      try {
        const batchResult = await window.electronAPI.analyzeAudioFilesBatch(filePaths);
        
        // Map batch results back to file objects
        const results = [];
        const fileMap = new Map(selectedFiles.map(f => [f.path, f]));
        
        for (const result of batchResult.results || []) {
          const file = fileMap.get(result.file_path);
          if (file && result.analysis) {
            results.push({ file, analysis: result.analysis });
            // Add to library
            if (onAddToLibrary) {
              onAddToLibrary(file, result.analysis);
            }
          } else if (file && result.error) {
            console.error(`[SET PLANNER] Analysis failed for ${file.name}: ${result.error}`);
            results.push({ file, analysis: null, error: result.error });
          }
        }
        
        if (results.length > 0) {
          setAnalysisSet(results);
          const plan = buildSetPlan(results, { energyCurve: 'warmup-peak-reset' });
          setSetPlan(plan);
          // Clear selected files after analysis
          setSelectedFiles([]);
        } else {
          throw new Error('No files were successfully analyzed');
        }
      } finally {
        window.electronAPI.removeBatchAnalysisProgressListener();
      }
    } catch (err) {
      console.error('[SET PLANNER] Analysis error:', err);
      setError(err.message);
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  }, [selectedFiles, onAddToLibrary]);

  // Handle library track selection
  const toggleLibraryTrack = (track) => {
    setSelectedLibraryTracks(prev => {
      const exists = prev.find(t => t.id === track.id);
      if (exists) {
        return prev.filter(t => t.id !== track.id);
      } else {
        return [...prev, track];
      }
    });
  };

  // Build set plan from library tracks
  const handleBuildFromLibrary = useCallback(() => {
    if (selectedLibraryTracks.length < 2) {
      setError('Please select at least 2 tracks to build a set plan');
      return;
    }

    try {
      const results = selectedLibraryTracks.map(track => ({
        file: track.file,
        analysis: track.analysis
      }));

      const plan = buildSetPlan(results, { energyCurve: 'warmup-peak-reset' });
      setSetPlan(plan);
      setAnalysisSet(results);
      setError(null);
    } catch (err) {
      setError(`Failed to build set plan: ${err.message}`);
    }
  }, [selectedLibraryTracks]);

  // Export handlers
  const handleExportRekordbox = async () => {
    if (!setPlan || setPlan.error || !onExportRekordbox) return;
    const playlistName = `Mixed In AI Set ${new Date().toISOString().slice(0, 10)}`;
    const tracks = setPlan.tracks.map((track) => {
      const analysisData = analysisSet?.find(item => item.file?.path === track.filePath)?.analysis;
      return {
        path: track.filePath,
        name: track.fileName,
        artist: analysisData?.artist || 'Unknown Artist',
        album: analysisData?.album || 'Unknown Album',
        key: track.key,
        bpm: track.bpm,
        mixInTime: track.mixInTime,
        mixOutTime: track.mixOutTime,
        analysis: analysisData,
      };
    });

    try {
      await onExportRekordbox({ playlistName, tracks, includeCuePoints: true });
      setError(null);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  };

  const handleExportSerato = async () => {
    if (!setPlan || setPlan.error || !onExportSerato) return;
    const playlistName = `Mixed In AI Set ${new Date().toISOString().slice(0, 10)}`;
    const tracks = setPlan.tracks.map((track) => {
      const analysisData = analysisSet?.find(item => item.file?.path === track.filePath)?.analysis;
      return {
        path: track.filePath,
        file_path: track.filePath,
        name: track.fileName,
        artist: analysisData?.artist || 'Unknown Artist',
        duration: analysisData?.duration || -1,
      };
    });

    try {
      await onExportSerato({ tracks, playlistName });
      setError(null);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  };

  const handleExportTraktor = async () => {
    if (!setPlan || setPlan.error || !onExportTraktor) return;
    const playlistName = `Mixed In AI Set ${new Date().toISOString().slice(0, 10)}`;
    const tracks = setPlan.tracks.map((track) => {
      const analysisData = analysisSet?.find(item => item.file?.path === track.filePath)?.analysis;
      return {
        file_path: track.filePath,
        path: track.filePath,
        title: track.fileName,
        name: track.fileName,
        artist: analysisData?.artist || 'Unknown Artist',
        bpm: track.bpm,
        key: track.key,
        cue_points: analysisData?.cue_points || [],
      };
    });

    try {
      await onExportTraktor({ tracks, playlistName });
      setError(null);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  };

  // Clear set plan
  const clearSetPlan = () => {
    setSetPlan(null);
    setAnalysisSet(null);
    setSelectedFiles([]);
    setSelectedLibraryTracks([]);
    setError(null);
  };

  const analysisProgressText = analysisProgress
    ? `Analyzing ${analysisProgress.current}/${analysisProgress.total} • ${analysisProgress.name}`
    : 'Analyzing audio files...';

  return (
    <div className="set-planner-view">
      <h2 className="view-title">Set Planner</h2>
      <p className="view-subtitle">Build DJ set plans with harmonic mixing and energy curves</p>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!setPlan ? (
        <>
          {/* Mode Toggle */}
          <div className="mode-toggle">
            <button
              className={clsx('mode-button', { active: mode === 'drop' })}
              onClick={() => setMode('drop')}
            >
              <Upload size={18} />
              Drop Files
            </button>
            <button
              className={clsx('mode-button', { active: mode === 'library' })}
              onClick={() => setMode('library')}
            >
              <ListMusic size={18} />
              Select from Library
            </button>
          </div>

          {mode === 'drop' ? (
            <>
              {/* File Drop Zone */}
              <div
                {...getRootProps()}
                className={clsx('set-planner-dropzone', { 'drag-over': isDragActive })}
              >
                <input {...getInputProps()} />
                <Upload className="dropzone-icon" size={64} />
                <div className="dropzone-text">
                  {isDragActive ? 'Drop your audio files here' : 'Drop multiple audio files here'}
                </div>
                <div className="dropzone-subtext">
                  Supports MP3, WAV, FLAC, AIFF, M4A
                </div>
                <button className="dropzone-button" onClick={(e) => {
                  e.stopPropagation();
                  handleFileSelect();
                }}>
                  Choose Files
                </button>
              </div>

              {/* Selected Files List */}
              {selectedFiles.length > 0 && (
                <div className="selected-files">
                  <h3 className="section-title">Selected Files ({selectedFiles.length})</h3>
                  <div className="files-list">
                    {selectedFiles.map((file, index) => (
                      <div key={index} className="file-item">
                        <span className="file-name">{file.name}</span>
                        <button 
                          className="file-remove"
                          onClick={() => removeFile(index)}
                          title="Remove file"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button 
                    className="analyze-button"
                    onClick={handleAnalyzeFiles}
                    disabled={isAnalyzing || selectedFiles.length < 2}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader className="spinner" size={16} />
                        {analysisProgressText}
                      </>
                    ) : (
                      <>
                        Analyze & Build Set Plan
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Library Selection Mode */}
              <div className="library-selection">
                <h3 className="section-title">Select Tracks from Library</h3>
                {analyzedTracks.length === 0 ? (
                  <div className="empty-state">
                    <ListMusic size={48} className="empty-icon" />
                    <p>No tracks in library. Analyze some tracks first.</p>
                  </div>
                ) : (
                  <>
                    <div className="library-tracks-grid">
                      {analyzedTracks.map((track) => {
                        const isSelected = selectedLibraryTracks.some(t => t.id === track.id);
                        return (
                          <div
                            key={track.id}
                            className={clsx('library-track-card', { selected: isSelected })}
                            onClick={() => toggleLibraryTrack(track)}
                          >
                            <div className="track-card-checkbox">
                              {isSelected && <CheckCircle size={20} />}
                            </div>
                            <div className="track-card-info">
                              <div className="track-card-name">{track.file.name}</div>
                              <div className="track-card-meta">
                                {track.analysis?.key || 'N/A'} • {track.analysis?.bpm ? Math.round(track.analysis.bpm) : 'N/A'} BPM
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="library-actions">
                      <div className="selected-count">
                        {selectedLibraryTracks.length} track(s) selected
                      </div>
                      <button
                        className="build-plan-button"
                        onClick={handleBuildFromLibrary}
                        disabled={selectedLibraryTracks.length < 2}
                      >
                        Build Set Plan
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {/* Set Plan Display */}
          <div className="set-plan-header">
            <div className="set-plan-info">
              <h3 className="section-title">Set Plan</h3>
              <p className="set-plan-meta">
                {setPlan.tracks.length} tracks • {formatTime(setPlan.tracks.reduce((sum, t) => sum + (t.duration || 0), 0))} total
              </p>
            </div>
            <button className="clear-plan-button" onClick={clearSetPlan}>
              Clear Plan
            </button>
          </div>

          {setPlan.error ? (
            <div className="error-banner">
              <AlertCircle size={16} />
              {setPlan.error} Missing keys: {setPlan.missingKeys?.join(', ')}
            </div>
          ) : (
            <>
              <div className="set-plan-actions">
                <button className="export-button" onClick={handleExportRekordbox}>
                  <Download size={16} />
                  Export Rekordbox XML
                </button>
                <button className="export-button" onClick={handleExportSerato}>
                  <Download size={16} />
                  Export Serato Playlist
                </button>
                <button className="export-button" onClick={handleExportTraktor}>
                  <Download size={16} />
                  Export Traktor Playlist
                </button>
              </div>

              <SetPlannerTable
                tracks={(setPlan.tracks || []).map(t => ({
                    ...t,
                    analysis: analysisSet?.find(a => a.file?.path === t.filePath)?.analysis
                }))}
                transitions={setPlan.transitions || []}
                onTrackClick={(track, index) => {
                  setCurrentTrackIndex(index);
                }}
                currentTrackIndex={currentTrackIndex}
              />

              <div className="set-plan-transitions">
                <h4 className="subsection-title">Transition Details</h4>
                <div className="set-plan-transition-grid">
                  {setPlan.transitions?.map((transition, index) => {
                    const fromTrackRaw = setPlan.tracks[index];
                    const toTrackRaw = setPlan.tracks[index + 1];
                    
                    // Hydrate tracks with analysis data for the visualizer
                    const fromAnalysis = analysisSet?.find(item => item.file?.path === fromTrackRaw.filePath)?.analysis;
                    const toAnalysis = analysisSet?.find(item => item.file?.path === toTrackRaw.filePath)?.analysis;
                    
                    const fromTrack = { ...fromTrackRaw, analysis: fromAnalysis };
                    const toTrack = { ...toTrackRaw, analysis: toAnalysis };

                    return (
                      <div key={`transition-${index}`} className="set-plan-transition-card">
                        <div className="set-plan-transition-title">
                          {fromTrack?.fileName} → {toTrack?.fileName}
                        </div>
                        
                        <TransitionVisualizer 
                            fromTrack={fromTrack}
                            toTrack={toTrack}
                            transition={transition}
                        />

                        <div className="set-plan-transition-score">
                          Transition score: {transition.score}%
                        </div>
                        <div className="set-plan-transition-meta">
                          Mix out {formatTimeSafe(transition.mixOutTime)} • Mix in {formatTimeSafe(transition.mixInTime)} • {transition.overlapBars} bars
                        </div>
                        <ul className="set-plan-transition-reasons">
                          {transition.reasons.map((reason, reasonIndex) => (
                            <li key={`reason-${index}-${reasonIndex}`}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default SetPlannerView;
