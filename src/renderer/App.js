import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  Music, 
  Clock, 
  Target, 
  Play, 
  Download,
  AlertCircle,
  CheckCircle,
  Loader,
  FileAudio,
  BarChart3,
  Zap,
  Pause,
  Volume2
} from 'lucide-react';
import clsx from 'clsx';
import './styles.css';
import HotCueCard from './HotCueCard';
import { buildSetPlan } from './setPlanner';

// Waveform Visualization Component
const WaveformVisualization = ({ waveformData, cuePoints, currentTime, duration, onCueClick, getCueColor }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData.length) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw waveform
    const barWidth = width / waveformData.length;
    const maxBarHeight = height * 0.8;
    
    ctx.fillStyle = '#8b5cf6';
    waveformData.forEach((amplitude, index) => {
      const barHeight = amplitude * maxBarHeight;
      const x = index * barWidth;
      const y = (height - barHeight) / 2;
      
      ctx.fillRect(x, y, Math.max(barWidth - 1, 1), barHeight);
    });
    
    // Draw progress
    if (duration > 0) {
      const progressRatio = currentTime / duration;
      const progressX = progressRatio * width;
      
      // Progress overlay
      ctx.fillStyle = 'rgba(168, 85, 247, 0.7)';
      ctx.fillRect(0, 0, progressX, height);
      
      // Progress line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(progressX, 0);
      ctx.lineTo(progressX, height);
      ctx.stroke();
    }
    
    // Draw cue points
    if (cuePoints && duration > 0) {
      cuePoints.forEach((cue) => {
        const cueX = (cue.time / duration) * width;
        const cueColor = getCueColor(cue);
        
        // Cue point line
        ctx.strokeStyle = cueColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cueX, 0);
        ctx.lineTo(cueX, height);
        ctx.stroke();
        
        // Cue point dot
        ctx.fillStyle = cueColor;
        ctx.beginPath();
        ctx.arc(cueX, height / 2, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        // Cue point border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cueX, height / 2, 6, 0, 2 * Math.PI);
        ctx.stroke();
      });
    }
  }, [waveformData, currentTime, duration, cuePoints, getCueColor]);

  const handleClick = (event) => {
    if (!duration || !cuePoints) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickTime = (clickX / canvas.width) * duration;
    
    // Check if click is near a cue point (within 10 pixels)
    const cueClickThreshold = 10;
    for (const cue of cuePoints) {
      const cueX = (cue.time / duration) * canvas.width;
      if (Math.abs(clickX - cueX) <= cueClickThreshold) {
        onCueClick(cue);
        return;
      }
    }
  };

  return (
    <div className="waveform-canvas-container">
      <canvas
        ref={canvasRef}
        width={800}
        height={120}
        className="waveform-canvas"
        onClick={handleClick}
      />
      {cuePoints && duration > 0 && (
        <div className="cue-labels">
          {cuePoints.map((cue, index) => (
            <div
              key={index}
              className="cue-label"
              style={{
                left: `${(cue.time / duration) * 100}%`,
                color: getCueColor(cue)
              }}
              onClick={() => onCueClick(cue)}
            >
              {cue.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const App = () => {
  const [currentFile, setCurrentFile] = useState(null);
  const [currentFiles, setCurrentFiles] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [analysisSet, setAnalysisSet] = useState(null);
  const [setPlan, setSetPlan] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(null);
  const [error, setError] = useState(null);
  const waveformRef = useRef(null); // retained for click-to-seek support removal
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Removed WaveSurfer initialization (no external waveform component)

  const resetAnalysis = () => {
    setCurrentFile(null);
    setCurrentFiles([]);
    setAnalysis(null);
    setAnalysisSet(null);
    setSetPlan(null);
    setError(null);
    setAnalysisProgress(null);
  };

  const analyzeFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;

    setCurrentFiles(files);
    setCurrentFile(files.length === 1 ? files[0] : null);
    setAnalysis(null);
    setAnalysisSet(null);
    setSetPlan(null);
    setError(null);
    setIsAnalyzing(true);
    setAnalysisProgress({ current: 0, total: files.length, name: '' });

    try {
      const results = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setAnalysisProgress({ current: i + 1, total: files.length, name: file.name || file.path });
        const result = await window.electronAPI.analyzeAudioFile(file.path);
        results.push({ file, analysis: result });
      }

      if (files.length === 1) {
        setAnalysis(results[0].analysis);
      } else {
        setAnalysisSet(results);
        const plan = buildSetPlan(results, { energyCurve: 'warmup-peak-reset' });
        setSetPlan(plan);
      }
    } catch (err) {
      console.error('[FRONTEND] Analysis error:', err);
      setError(err.message);
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  }, []);

  // Handle file drop
  const onDrop = useCallback((acceptedFiles) => {
    if (!acceptedFiles.length) return;
    analyzeFiles(acceptedFiles);
  }, [analyzeFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.flac', '.aiff', '.m4a']
    },
    multiple: true
  });

  // Handle file selection via button
  const handleFileSelect = async () => {
    console.log('[FRONTEND] File select button clicked');
    try {
      console.log('[FRONTEND] Calling selectAudioFiles...');
      const filePaths = await window.electronAPI.selectAudioFiles();
      console.log('[FRONTEND] Selected file paths:', filePaths);
      if (filePaths.length > 0) {
        const files = filePaths.map((filePath) => ({
          path: filePath,
          name: filePath.split('/').pop()
        }));
        console.log('[FRONTEND] Processing selected files:', files);
        await analyzeFiles(files);
      }
    } catch (err) {
      console.error('[FRONTEND] File selection error:', err);
      console.error('[FRONTEND] File selection error message:', err.message);
      console.error('[FRONTEND] File selection error stack:', err.stack);
      setError(err.message);
    } finally {
      console.log('[FRONTEND] File selection finished');
    }
  };

  // Handle export
  const handleExport = async () => {
    if (!analysis || !currentFile) return;

    try {
      const exportPath = await window.electronAPI.exportAnalysis({
        filePath: currentFile.path,
        analysis,
        format: 'json'
      });
      
      if (exportPath) {
        console.log('Analysis exported to:', exportPath);
      }
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  };

  // Audio control functions
  const playAudio = () => {
    if (audioRef.current) {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const pauseAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const seekToTime = (time) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [analysis]);

  // Waveform click handler
  const handleWaveformClick = (event) => {
    if (!analysis || !waveformRef.current) return;

    const rect = waveformRef.current.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickRatio = clickX / rect.width;
    const clickTime = clickRatio * analysis.duration;

    seekToTime(clickTime);
  };

  // Cue point click handler
  const handleCuePointClick = (cuePoint) => {
    console.log(`[FRONTEND] Jumping to cue point: ${cuePoint.name} at ${cuePoint.time}s`);
    seekToTime(cuePoint.time);
    if (!isPlaying) {
      playAudio();
    }
  };

  const handleHotCuePlay = (cue) => {
    if (!cue) return;
    seekToTime(cue.time || 0);
    if (!isPlaying) {
      playAudio();
    }
  };

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTimeSafe = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return 'N/A';
    return formatTime(seconds);
  };

  // Get key display name
  const getKeyDisplay = (key) => {
    const keyMap = {
      // A = minor, B = major
      '1A': 'A♭ Minor', '2A': 'E♭ Minor', '3A': 'B♭ Minor', '4A': 'F Minor',
      '5A': 'C Minor', '6A': 'G Minor', '7A': 'D Minor', '8A': 'A Minor',
      '9A': 'E Minor', '10A': 'B Minor', '11A': 'F♯ Minor', '12A': 'C♯ Minor',
      '1B': 'B Major', '2B': 'F♯ Major', '3B': 'D♭ Major', '4B': 'A♭ Major',
      '5B': 'E♭ Major', '6B': 'B♭ Major', '7B': 'F Major', '8B': 'C Major',
      '9B': 'G Major', '10B': 'D Major', '11B': 'A Major', '12B': 'E Major'
    };
    return keyMap[key] || key;
  };

  // Get energy color based on level
  const getEnergyColor = (energy) => {
    if (energy <= 2) return '#4338ca'; // Low energy - blue
    if (energy <= 4) return '#7c3aed'; // Medium-low - purple
    if (energy <= 6) return '#8b5cf6'; // Medium - light purple
    if (energy <= 8) return '#a855f7'; // High - pink-purple
    return '#c084fc'; // Very high - light pink
  };

  const formatScore = (score) => {
    if (score === null || score === undefined) return 'N/A';
    return Math.round(score);
  };

  const getScoreColor = (status) => {
    if (status === 'good') return '#10b981';
    if (status === 'ok') return '#f59e0b';
    if (status === 'poor') return '#ef4444';
    return '#94a3b8';
  };

  const getScoreStatus = (score) => {
    if (score === null || score === undefined) return 'unknown';
    if (score >= 85) return 'good';
    if (score >= 70) return 'ok';
    return 'poor';
  };

  // Generate energy profile data
  const getEnergyProfile = () => {
    if (!analysis || !analysis.cue_points) return [];
    
    return analysis.cue_points.map((cue, index) => ({
      name: cue.name,
      time: formatTime(cue.time),
      energy: Math.floor(Math.random() * 10) + 1, // Mock energy level
      description: getCueDescription(cue)
    }));
  };

  const getCueDescription = (cue) => {
    const descriptions = {
      'intro': 'Perfect point to start mixing in - clean intro with rhythm foundation.',
      'drop': 'Main energy peak - ideal for dramatic transitions and peak moments.',
      'breakdown': 'Lower energy section - perfect for smooth mixing and blending.',
      'outro': 'Optimal mix-out point - track energy decreases, perfect for transitions.',
      'vocal': 'Main vocal section - great for harmonic mixing and key matching.',
      'chorus': 'High-energy chorus section with full arrangement.',
      'verse': 'Vocal verse section with supporting elements.',
      // normalized backend synonyms
      'vocal_entry': 'Main vocal section - great for harmonic mixing and key matching.',
      'breakdown_start': 'Lower energy section - perfect for smooth mixing and blending.',
      'build_up_start': 'Energy rising into a peak - prepare transition.',
      'chorus_start': 'High-energy chorus section with full arrangement.',
      'chorus_end': 'Chorus resolution - good transition window.',
      'outro_start': 'Optimal mix-out point - track energy decreases, perfect for transitions.'
    };
    return descriptions[cue.type] || 'Key mixing point in the track.';
  };

  const getCueColor = (cue) => {
    const colors = {
      'intro': '#10b981', // Green - start
      'drop': '#ef4444',  // Red - energy peak
      'breakdown': '#f59e0b', // Orange - mixing point
      'outro': '#6366f1',  // Blue - end
      'vocal': '#8b5cf6',  // Purple - vocal
      'chorus': '#ec4899', // Pink - chorus
      'verse': '#06b6d4',  // Cyan - verse
      // synonyms from backend
      'vocal_entry': '#8b5cf6',
      'breakdown_start': '#f59e0b',
      'build_up_start': '#f97316',
      'chorus_start': '#ec4899',
      'chorus_end': '#a78bfa',
      'outro_start': '#6366f1'
    };
    return colors[cue.type] || '#8b5cf6';
  };

  // Choose the best available energy curve; fallback to waveform or segment profile
  const getEnergyCurve = () => {
    const curve = analysis?.energy_analysis?.energy_curve;
    if (curve && curve.length > 1) return curve;
    // Fallback 1: build from waveform_data (normalized 0..1 -> 1..10)
    if (analysis?.waveform_data?.length && analysis?.duration) {
      const data = analysis.waveform_data;
      const maxVal = Math.max(...data, 1e-6);
      const maxPoints = 400;
      const step = Math.max(1, Math.floor(data.length / maxPoints));
      const result = [];
      for (let i = 0; i < data.length; i += step) {
        const energy01 = Math.min(1, data[i] / maxVal);
        const energy = 1 + energy01 * 9;
        const time = (i / data.length) * analysis.duration;
        result.push({ time, energy: Number(energy.toFixed(2)) });
      }
      return result;
    }
    // Fallback 2: interpolate from energy_profile segments
    const profile = analysis?.energy_analysis?.energy_profile;
    if (profile && profile.length > 0 && analysis?.duration) {
      const result = [];
      const total = analysis.duration;
      const maxPoints = 200;
      for (let i = 0; i < profile.length; i++) {
        const seg = profile[i];
        const mid = Math.max(0, Math.min(total, (seg.start_time + seg.end_time) / 2));
        result.push({ time: mid, energy: Number((seg.energy || 5).toFixed(2)) });
      }
      // sort and optionally densify
      result.sort((a, b) => a.time - b.time);
      if (result.length > maxPoints) {
        const step = Math.ceil(result.length / maxPoints);
        return result.filter((_, idx) => idx % step === 0);
      }
      return result;
    }
    return [];
  };

  const isSetPlan = Array.isArray(analysisSet) && analysisSet.length > 1;
  const totalSetDuration = isSetPlan
    ? analysisSet.reduce((sum, item) => sum + (item.analysis?.duration || 0), 0)
    : 0;
  const analysisProgressText = analysisProgress
    ? `Analyzing ${analysisProgress.current}/${analysisProgress.total} • ${analysisProgress.name}`
    : 'Analyzing audio file...';

  const handleExportRekordbox = async () => {
    if (!setPlan || setPlan.error) return;
    const playlistName = `Mixed In AI Set ${new Date().toISOString().slice(0, 10)}`;
    const tracks = setPlan.tracks.map((track) => ({
      path: track.filePath,
      name: track.fileName,
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      key: track.key,
      bpm: track.bpm,
    }));

    try {
      const exportPath = await window.electronAPI.exportRekordboxXml({
        playlistName,
        tracks,
      });
      if (exportPath) {
        console.log('Rekordbox XML exported to:', exportPath);
      }
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">
            <Music size={20} />
          </div>
          Mixed In AI
        </div>
        <div className="version">
          v{window.electronAPI?.appVersion || '1.0.0'}
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {currentFiles.length === 0 ? (
          // Upload Area
          <div
            {...getRootProps()}
            className={clsx('upload-area', { 'drag-over': isDragActive })}
          >
            <input {...getInputProps()} />
            <Upload className="upload-icon" size={64} />
            <div className="upload-text">
              {isDragActive ? 'Drop your audio file here' : 'Drop audio files here'}
            </div>
            <div className="upload-subtext">
              Supports MP3, WAV, FLAC, AIFF, M4A
            </div>
            <button className="upload-button" onClick={(e) => {
              e.stopPropagation();
              handleFileSelect();
            }}>
              Choose File
            </button>
          </div>
        ) : (
          // Analysis Results
          <div className="analysis-container">
            {/* Results Panel */}
            <div className="results-panel">
              <div className="panel-header">
                <button className="analyze-another-btn" onClick={() => {
                  resetAnalysis();
                }}>
                  Analyze Another
                </button>
              </div>

              {isAnalyzing ? (
                <div className="loading">
                  <Loader className="spinner" size={20} />
                  {analysisProgressText}
                </div>
              ) : error ? (
                <div className="error">
                  <AlertCircle size={16} />
                  {error}
                </div>
              ) : (analysis || analysisSet) ? (
                <>
                  {isSetPlan ? (
                    <>
                      <div className="summary-table">
                        <div className="summary-row summary-header">
                          <div className="summary-col">Playlist</div>
                          <div className="summary-col">Tracks</div>
                          <div className="summary-col">Duration</div>
                          <div className="summary-col">Curve</div>
                        </div>
                        <div className="summary-row">
                          <div className="summary-col">Warm-up → Peak → Reset</div>
                          <div className="summary-col">{analysisSet.length}</div>
                          <div className="summary-col">{formatTime(totalSetDuration)}</div>
                          <div className="summary-col">Energy Arc</div>
                        </div>
                      </div>

                      <div className="set-plan-section">
                        <h3 className="section-title">Set Planner</h3>
                        {setPlan?.error ? (
                          <div className="error">
                            <AlertCircle size={16} />
                            {setPlan.error} Missing keys: {setPlan.missingKeys?.join(', ')}
                          </div>
                        ) : (
                          <>
                            <div className="set-plan-actions">
                              <button className="export-button" onClick={handleExportRekordbox}>
                                Export Rekordbox XML
                              </button>
                            </div>

                            <div className="set-plan-list">
                              {setPlan?.tracks?.map((track, index) => (
                                <div key={track.id} className="set-plan-track-card">
                                  <div className="set-plan-track-index">{index + 1}</div>
                                  <div className="set-plan-track-info">
                                    <div className="set-plan-track-title">{track.fileName}</div>
                                    <div className="set-plan-track-meta">
                                      Key {track.key} • {track.bpm || 'N/A'} BPM • Energy {track.energy.toFixed(1)}
                                    </div>
                                  </div>
                                  <div className="set-plan-track-mix">
                                    <div>Mix in: {formatTimeSafe(track.mixInTime)}</div>
                                    <div>Mix out: {formatTimeSafe(track.mixOutTime)}</div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="set-plan-transitions">
                              <h4 className="subsection-title">Transitions</h4>
                              <div className="set-plan-transition-grid">
                                {setPlan?.transitions?.map((transition, index) => {
                                  const fromTrack = setPlan.tracks[index];
                                  const toTrack = setPlan.tracks[index + 1];
                                  return (
                                    <div key={`transition-${index}`} className="set-plan-transition-card">
                                      <div className="set-plan-transition-title">
                                        {fromTrack?.fileName} → {toTrack?.fileName}
                                      </div>
                                      <div className="set-plan-transition-score">
                                        Transition score: {transition.score}
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
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Summary Table */}
                      <div className="summary-table">
                        <div className="summary-row summary-header">
                          <div className="summary-col">Title</div>
                          <div className="summary-col">BPM</div>
                          <div className="summary-col">Key</div>
                          <div className="summary-col">Camelot</div>
                        </div>
                        <div className="summary-row">
                          <div className="summary-col">{currentFile?.name || analysis.file_path?.split('/').pop()}</div>
                          <div className="summary-col">{analysis.bpm}</div>
                          <div className="summary-col">{getKeyDisplay(analysis.key)}</div>
                          <div className="summary-col">{analysis.key}</div>
                        </div>
                      </div>

                      {/* Mix Quality Scorecard */}
                      {analysis.mix_scorecard && !analysis.mix_scorecard.error ? (
                        <div className="mix-scorecard-section">
                          <h3 className="section-title">Mix Quality Scorecard</h3>
                          <div className="scorecard-overview">
                            <div className="scorecard-main">
                              <div
                                className="scorecard-score"
                                style={{ borderColor: getScoreColor(getScoreStatus(analysis.mix_scorecard.overall_score)) }}
                              >
                                <div className="scorecard-score-value">
                                  {formatScore(analysis.mix_scorecard.overall_score)}
                                </div>
                                <div className="scorecard-score-label">Overall Score</div>
                              </div>
                              <div className="scorecard-grade">
                                <div className="scorecard-grade-label">Grade</div>
                                <div className="scorecard-grade-value">{analysis.mix_scorecard.grade}</div>
                              </div>
                            </div>

                            <div className="scorecard-categories">
                              {analysis.mix_scorecard.categories && analysis.mix_scorecard.categories.map((cat) => (
                                <div key={cat.id} className="scorecard-category-card">
                                  <div className="scorecard-category-header">
                                    <div className="scorecard-category-title">{cat.label}</div>
                                    <div
                                      className="scorecard-category-score"
                                      style={{ color: getScoreColor(cat.status) }}
                                    >
                                      {formatScore(cat.score)}
                                    </div>
                                  </div>
                                  <div className="scorecard-category-status" style={{ color: getScoreColor(cat.status) }}>
                                    {cat.status}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {analysis.mix_scorecard.issues && analysis.mix_scorecard.issues.length > 0 && (
                            <div className="scorecard-issues">
                              <h4 className="subsection-title">Top Issues</h4>
                              <div className="scorecard-issues-grid">
                                {analysis.mix_scorecard.issues.slice(0, 3).map((issue, index) => (
                                  <div key={`issue-${index}`} className="scorecard-issue-card">
                                    <div className="scorecard-issue-title">{issue.message}</div>
                                    <div className="scorecard-issue-summary">{issue.summary}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {analysis.mix_scorecard.suggestions && analysis.mix_scorecard.suggestions.length > 0 && (
                            <div className="scorecard-suggestions">
                              <h4 className="subsection-title">Suggestions</h4>
                              <div className="scorecard-suggestions-grid">
                                {analysis.mix_scorecard.suggestions.slice(0, 3).map((suggestion, index) => (
                                  <div key={`suggestion-${index}`} className="scorecard-suggestion-card">
                                    {suggestion.message}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : analysis.mix_scorecard?.error ? (
                        <div className="error">
                          <AlertCircle size={16} />
                          Mix scorecard unavailable: {analysis.mix_scorecard.error}
                        </div>
                      ) : null}

                      {/* Audio Controls */}
                      <div className="waveform-section">
                        <div className="waveform-container">
                          <div className="waveform-controls">
                            <button 
                              className="play-button"
                              onClick={isPlaying ? pauseAudio : playAudio}
                            >
                              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                              {isPlaying ? 'Pause' : 'Play'}
                            </button>
                            <div className="time-display">
                              {formatTime(currentTime)} / {formatTime(duration)}
                            </div>
                          </div>
                        </div>
                        <audio
                          ref={audioRef}
                          src={`file://${analysis.file_path}`}
                          preload="metadata"
                        />
                      </div>

                      {/* Cue Columns: DJ Cues (left) + Hot Cues (right) */}
                      <div className="cue-columns">
                        {/* LEFT: DJ Cues */}
                        <div>
                          <h3 className="section-title">DJ Cue Points</h3>
                          <div className="cue-points">
                            {analysis.cue_points && analysis.cue_points.map((cue, index) => (
                              <div 
                                key={index} 
                                className="cue-point-card clickable" 
                                style={{ borderLeftColor: getCueColor(cue) }}
                                onClick={() => handleCuePointClick(cue)}
                              >
                                <div className="cue-header">
                                  <div className="cue-icon" style={{ backgroundColor: getCueColor(cue) }}>
                                    <FileAudio size={16} />
                                  </div>
                                  <div className="cue-info">
                                    <div className="cue-name">{cue.name}</div>
                                    <div className="cue-time">
                                      <Clock size={12} />
                                      {formatTime(cue.time)}
                                    </div>
                                  </div>
                                  <div className="cue-type-badge" style={{ backgroundColor: getCueColor(cue) }}>
                                    {cue.type.toUpperCase()}
                                  </div>
                                  <div className="play-cue-button">
                                    <Play size={12} />
                                  </div>
                                </div>
                                <div className="cue-description">
                                  {getCueDescription(cue)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* RIGHT: Hot Cues */}
                        <div>
                          <h3 className="section-title">Hot Cues</h3>
                          <div className="cue-points">
                            {Array.isArray(analysis.hotcues) && analysis.hotcues.map((h, index) => (
                              <HotCueCard key={index} slot={h.slot} cue={h.cue} onPlay={handleHotCuePlay} />
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Energy Analysis */}
                      <div className="energy-analysis-section">
                        <h3 className="section-title">Energy Analysis</h3>
                        {analysis.energy_analysis && (
                          <div className="energy-analysis-content">
                            <div className="energy-overview">
                              <div className="energy-level-display">
                                <div className="energy-level-number">{analysis.energy_analysis.energy_level}</div>
                                <div className="energy-level-name">{analysis.energy_analysis.energy_level_name}</div>
                                <div className="energy-description">{analysis.energy_analysis.energy_description}</div>
                              </div>
                            </div>
                            
                            {/* Energy Profile Chart */}
                            {(() => {
                              const curve = getEnergyCurve();
                              return curve && curve.length > 1;
                            })() && (
                              <div className="energy-profile-chart">
                                <h4 className="chart-title">Energy Profile</h4>
                                <div className="energy-line-container">
                                  {/* Y grid lines */}
                                  {[2,4,6,8,10].map((tick) => (
                                    <div key={`grid-${tick}`} className="energy-grid-line" style={{ bottom: `${(tick/10)*100}%` }}>
                                      <div className="energy-grid-label">{tick}</div>
                                    </div>
                                  ))}
                                  {/* Polyline path over normalized coordinates */}
                                  <svg className="energy-line-svg" preserveAspectRatio="none" viewBox="0 0 1000 100">
                                    <defs>
                                      <linearGradient id="energy-gradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#a855f7" stopOpacity="0.35" />
                                        <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
                                      </linearGradient>
                                    </defs>
                                    {(() => {
                                      const curve = getEnergyCurve();
                                      const normPoints = curve.map(pt => {
                                        const x = Math.max(0, Math.min(1, (pt.time || 0) / (analysis.duration || 1)));
                                        const y = Math.max(0, Math.min(1, (pt.energy || 1) / 10));
                                        return { x: x * 1000, y: (1 - y) * 100 };
                                      });
                                      if (normPoints.length === 0) return null;
                                      const polyPoints = normPoints.map(p => `${p.x},${p.y}`).join(' ');
                                      const areaPoints = `0,100 ${polyPoints} 1000,100`;
                                      return (
                                        <>
                                          <polygon className="energy-area" points={areaPoints} fill="url(#energy-gradient)" />
                                          <polyline className="energy-polyline" points={polyPoints} />
                                          {/* Cue markers */}
                                          <g className="energy-markers">
                                            {analysis.cue_points && analysis.cue_points.map((cue, idx) => {
                                              const t = Math.max(0, Math.min(analysis.duration || 1, cue.time || 0));
                                              const xn = (t / (analysis.duration || 1));
                                              // nearest energy value
                                              const curveData = getEnergyCurve();
                                              let nearest = curveData[0];
                                              let minDiff = Math.abs((nearest?.time || 0) - t);
                                              for (let i = 1; i < curveData.length; i++) {
                                                const d = Math.abs((curveData[i].time || 0) - t);
                                                if (d < minDiff) { nearest = curveData[i]; minDiff = d; }
                                              }
                                              const yn = Math.max(0, Math.min(1, ((nearest?.energy || 1) / 10)));
                                              const cx = xn * 1000;
                                              const cy = (1 - yn) * 100;
                                              const color = getCueColor(cue);
                                              return (
                                                <g key={idx}>
                                                  <circle className="energy-marker" cx={cx} cy={cy} r={2.8} fill={color} />
                                                  <circle className="energy-marker-outline" cx={cx} cy={cy} r={3.6} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="0.8" />
                                                  <title>{`${cue.name} • ${cue.type.toUpperCase()} • ${formatTime(t)} • Energy ${nearest?.energy?.toFixed?.(2) || ''}`}</title>
                                                </g>
                                              );
                                            })}
                                          </g>
                                        </>
                                      );
                                    })()}
                                  </svg>
                                </div>
                                {/* Timeline ticks */}
                                <div className="energy-timeline">
                                  {(() => {
                                    const ticks = [];
                                    const step = (analysis.duration || 0) > 600 ? 60 : 30;
                                    const count = Math.floor((analysis.duration || 0) / step) + 1;
                                    for (let i = 0; i < count; i++) {
                                      const t = i * step;
                                      ticks.push(
                                        <div key={`tick-${i}`} className="energy-tick" style={{ left: `${(t / (analysis.duration || 1)) * 100}%` }}>
                                          <div className="energy-tick-label">{formatTime(t)}</div>
                                        </div>
                                      );
                                    }
                                    return ticks;
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Harmonic Mixing */}
                      <div className="harmonic-mixing-section">
                        <h3 className="section-title">Harmonic Mixing</h3>
                        {analysis.harmonic_mixing && (
                          <div className="harmonic-mixing-content">
                            <div className="current-key-info">
                              <div className="key-display">
                                <div className="key-label">Current Key</div>
                                <div className="key-value">{getKeyDisplay(analysis.harmonic_mixing.current_key)}</div>
                              </div>
                            </div>
                            
                            <div className="compatible-keys">
                              <h4 className="subsection-title">Compatible Keys</h4>
                              <div className="compatible-keys-grid">
                                {analysis.harmonic_mixing.compatible_keys.slice(0, 6).map((key, index) => (
                                  <div key={index} className="compatible-key-card">
                                    <div className="compatible-key-name">{getKeyDisplay(key.key)}</div>
                                    <div className="compatibility-score">{Math.round(key.compatibility * 100)}%</div>
                                    <div className="technique-name">{key.technique.replace('_', ' ')}</div>
                                    <div className="technique-description">{key.description}</div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="energy-suggestions">
                              <h4 className="subsection-title">Energy Mixing Suggestions</h4>
                              <div className="suggestions-grid">
                                {analysis.harmonic_mixing.energy_build_suggestions.map((suggestion, index) => (
                                  <div key={index} className="suggestion-card">
                                    <div className="suggestion-type">Energy Build</div>
                                    <div className="suggestion-key">{getKeyDisplay(suggestion.key)}</div>
                                    <div className="suggestion-description">{suggestion.description}</div>
                                    <div className="energy-boost">{suggestion.energy_boost}</div>
                                  </div>
                                ))}
                                {analysis.harmonic_mixing.energy_release_suggestions.map((suggestion, index) => (
                                  <div key={index} className="suggestion-card">
                                    <div className="suggestion-type">Energy Release</div>
                                    <div className="suggestion-key">{getKeyDisplay(suggestion.key)}</div>
                                    <div className="suggestion-description">{suggestion.description}</div>
                                    <div className="energy-reduction">{suggestion.energy_reduction}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Advanced Mixing Techniques */}
                      <div className="advanced-mixing-section">
                        <h3 className="section-title">Advanced Mixing Techniques</h3>
                        {analysis.advanced_mixing && (
                          <div className="advanced-mixing-content">
                            <div className="technique-cards">
                              <div className="technique-card">
                                <div className="technique-title">Power Block Mixing</div>
                                <div className="technique-description">
                                  Rapid transitions between tracks in the same key with energy variation
                                </div>
                                <div className="technique-strategy">
                                  Use tracks in the same key but with varying energy levels for rapid transitions
                                </div>
                              </div>
                              
                              <div className="technique-card">
                                <div className="technique-title">Energy Boost Mixing</div>
                                <div className="technique-description">
                                  Sudden energy increases using high-energy tracks
                                </div>
                                <div className="technique-strategy">
                                  Use high-energy tracks for dramatic energy increases
                                </div>
                              </div>
                              
                              <div className="technique-card">
                                <div className="technique-title">Beat Jumping</div>
                                <div className="technique-description">
                                  Jumping between specific beat-aligned sections using cue points
                                </div>
                                <div className="technique-strategy">
                                  Use cue points for creative transitions and energy control
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </div>

            {/* Removed right-side waveform panel to simplify UI */}
          </div>
        )}
      </main>
    </div>
  );
};

export default App; 