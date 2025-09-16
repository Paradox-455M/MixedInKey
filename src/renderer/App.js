import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
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
  const [analysis, setAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [waveform, setWaveform] = useState(null);
  const waveformRef = useRef(null);
  const wavesurferRef = useRef(null);
  const regionsRef = useRef(null);
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Initialize WaveSurfer
  useEffect(() => {
    if (waveformRef.current && currentFile) {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }

      const wavesurfer = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#8b5cf6',
        progressColor: '#a855f7',
        cursorColor: '#ffffff',
        barWidth: 2,
        barRadius: 3,
        cursorWidth: 1,
        height: 120,
        barGap: 3,
        responsive: true,
      });
      // Register regions plugin (used for vertical cue markers)
      try {
        const regions = wavesurfer.registerPlugin(RegionsPlugin.create());
        regionsRef.current = regions;
      } catch (e) {
        console.warn('[FRONTEND] Failed to register regions plugin:', e);
      }
      wavesurfer.load(currentFile.path);
      wavesurferRef.current = wavesurfer;
      setWaveform(wavesurfer);

      return () => {
        if (wavesurferRef.current) {
          wavesurferRef.current.destroy();
        }
      };
    }
  }, [currentFile]);

  // Handle file drop
  const onDrop = useCallback(async (acceptedFiles) => {
    console.log('[FRONTEND] Files dropped:', acceptedFiles);
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    console.log('[FRONTEND] Processing file:', file);
    console.log('[FRONTEND] File path:', file.path);
    console.log('[FRONTEND] File name:', file.name);
    console.log('[FRONTEND] File size:', file.size);
    console.log('[FRONTEND] File type:', file.type);
    
    setCurrentFile(file);
    setAnalysis(null);
    setError(null);
    setIsAnalyzing(true);

    try {
      console.log('[FRONTEND] Calling analyzeAudioFile with path:', file.path);
      console.log('[FRONTEND] window.electronAPI exists:', !!window.electronAPI);
      console.log('[FRONTEND] analyzeAudioFile function exists:', !!window.electronAPI.analyzeAudioFile);
      
      const result = await window.electronAPI.analyzeAudioFile(file.path);
      console.log('[FRONTEND] Analysis result received:', result);
      setAnalysis(result);
      
      // Add cue point markers to waveform
      if (regionsRef.current && result.cue_points) {
        try {
          // Clear existing regions if supported
          if (typeof regionsRef.current.clearRegions === 'function') {
            regionsRef.current.clearRegions();
          }
          result.cue_points.forEach((cue) => {
            const t = Math.max(0, cue.time || 0);
            regionsRef.current.addRegion({
              start: t,
              end: t + 0.01,
              content: cue.name || '',
              color: 'rgba(139, 92, 246, 0.7)',
              drag: false,
              resize: false
            });
          });
        } catch (e) {
          console.warn('[FRONTEND] Unable to add markers:', e);
        }
      }
    } catch (err) {
      console.error('[FRONTEND] Analysis error:', err);
      console.error('[FRONTEND] Error message:', err.message);
      console.error('[FRONTEND] Error stack:', err.stack);
      setError(err.message);
    } finally {
      console.log('[FRONTEND] Analysis finished, setting isAnalyzing to false');
      setIsAnalyzing(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.flac', '.aiff', '.m4a']
    },
    multiple: false
  });

  // Handle file selection via button
  const handleFileSelect = async () => {
    console.log('[FRONTEND] File select button clicked');
    try {
      console.log('[FRONTEND] Calling selectAudioFiles...');
      const filePaths = await window.electronAPI.selectAudioFiles();
      console.log('[FRONTEND] Selected file paths:', filePaths);
      if (filePaths.length > 0) {
        const file = { path: filePaths[0], name: filePaths[0].split('/').pop() };
        console.log('[FRONTEND] Processing selected file:', file);
        console.log('[FRONTEND] File path:', file.path);
        console.log('[FRONTEND] File name:', file.name);
        
        setCurrentFile(file);
        setAnalysis(null);
        setError(null);
        setIsAnalyzing(true);

        console.log('[FRONTEND] Calling analyzeAudioFile with selected file path:', file.path);
        const result = await window.electronAPI.analyzeAudioFile(file.path);
        console.log('[FRONTEND] Analysis result from file selection:', result);
        setAnalysis(result);
      }
    } catch (err) {
      console.error('[FRONTEND] File selection error:', err);
      console.error('[FRONTEND] File selection error message:', err.message);
      console.error('[FRONTEND] File selection error stack:', err.stack);
      setError(err.message);
    } finally {
      console.log('[FRONTEND] File selection finished, setting isAnalyzing to false');
      setIsAnalyzing(false);
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

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get key display name
  const getKeyDisplay = (key) => {
    const keyMap = {
      '8A': 'A♭ Major', '8B': 'A♭ Minor',
      '9A': 'A Major', '9B': 'A Minor',
      '10A': 'B♭ Major', '10B': 'B♭ Minor',
      '11A': 'B Major', '11B': 'B Minor',
      '12A': 'C Major', '12B': 'C Minor',
      '1A': 'C♯ Major', '1B': 'C♯ Minor',
      '2A': 'D Major', '2B': 'D Minor',
      '3A': 'E♭ Major', '3B': 'E♭ Minor',
      '4A': 'E Major', '4B': 'E Minor',
      '5A': 'F Major', '5B': 'F Minor',
      '6A': 'F♯ Major', '6B': 'F♯ Minor',
      '7A': 'G Major', '7B': 'G Minor'
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
      'verse': 'Vocal verse section with supporting elements.'
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
      'verse': '#06b6d4'   // Cyan - verse
    };
    return colors[cue.type] || '#8b5cf6';
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
        {!currentFile ? (
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
                  setCurrentFile(null);
                  setAnalysis(null);
                }}>
                  Analyze Another
                </button>
              </div>

              {isAnalyzing ? (
                <div className="loading">
                  <Loader className="spinner" size={20} />
                  Analyzing audio file...
                </div>
              ) : error ? (
                <div className="error">
                  <AlertCircle size={16} />
                  {error}
                </div>
              ) : analysis ? (
                <>
                  {/* Basic Info Cards */}
                  <div className="info-cards">
                    <div className="info-card">
                      <div className="card-icon">
                        <Clock size={20} />
                      </div>
                      <div className="card-content">
                        <div className="card-label">BPM</div>
                        <div className="card-value">{analysis.bpm}</div>
                      </div>
                    </div>

                    <div className="info-card">
                      <div className="card-icon">
                        <Target size={20} />
                      </div>
                      <div className="card-content">
                        <div className="card-label">Key</div>
                        <div className="card-value">{getKeyDisplay(analysis.key)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Waveform */}
                  <div className="waveform-section">
                    <h3 className="section-title">
                      <Volume2 size={20} />
                      Interactive Waveform
                    </h3>
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
                      
                      <div className="waveform-display" onClick={handleWaveformClick} ref={waveformRef}>
                        {analysis.waveform_data && (
                          <WaveformVisualization 
                            waveformData={analysis.waveform_data}
                            cuePoints={analysis.cue_points}
                            currentTime={currentTime}
                            duration={analysis.duration}
                            onCueClick={handleCuePointClick}
                            getCueColor={getCueColor}
                          />
                        )}
                      </div>
                    </div>
                    
                    {/* Audio Element */}
                    <audio
                      ref={audioRef}
                      src={`file://${analysis.file_path}`}
                      preload="metadata"
                    />
                  </div>

                  {/* Cue Points */}
                  <div className="cue-points-section">
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
                        {analysis.energy_analysis.energy_profile && analysis.energy_analysis.energy_profile.length > 0 && (
                          <div className="energy-profile-chart">
                            <h4 className="chart-title">Energy Profile</h4>
                            <div className="energy-bars-container" style={{ display: 'flex', alignItems: 'end', gap: '0.5rem' }}>
                              {analysis.energy_analysis.energy_profile.map((segment, index) => {
                                const segDuration = Math.max(0.25, (segment.end_time - segment.start_time));
                                const totalDuration = Math.max(1, analysis.duration || segment.end_time);
                                const widthPct = Math.min(25, (segDuration / totalDuration) * 100); // cap width per bar
                                const heightPct = Math.max(5, Math.min(100, (segment.energy / 10) * 100));
                                return (
                                  <div key={index} className="energy-bar-wrapper" style={{ flex: '0 0 auto', width: `${widthPct}%` }}>
                                    <div className="energy-bar-container">
                                      <div
                                        className="energy-bar-fill"
                                        style={{ height: `${heightPct}%`, backgroundColor: getEnergyColor(segment.energy) }}
                                      ></div>
                                    </div>
                                    <div className="energy-bar-label">{segment.name}</div>
                                    <div className="energy-bar-time">({formatTime(segment.start_time)})</div>
                                  </div>
                                );
                              })}
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
              ) : null}
            </div>

            {/* Waveform Panel */}
            <div className="waveform-container">
              <div className="panel-title">
                <Play size={20} />
                Waveform
              </div>
              <div ref={waveformRef} className="waveform" onClick={handleWaveformClick} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App; 