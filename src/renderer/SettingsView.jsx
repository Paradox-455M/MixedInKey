import React, { useState, useMemo, memo } from 'react';
import {
    Settings,
    Trash2,
    Download,
    HardDrive,
    Music,
    Clock,
    Zap,
    AlertTriangle,
    CheckCircle,
    Database,
    FileJson,
    Sun,
    Moon,
    Palette
} from 'lucide-react';
import './settings.css';

const SettingsView = ({ analyzedTracks, onClearLibrary, analysisQuality, onSetAnalysisQuality, theme, onSetTheme }) => {
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [exportStatus, setExportStatus] = useState(null);

    // Calculate library statistics
    const stats = useMemo(() => {
        if (!analyzedTracks || analyzedTracks.length === 0) {
            return {
                totalTracks: 0,
                totalDuration: 0,
                avgBpm: 0,
                keyDistribution: {},
                energyDistribution: { low: 0, medium: 0, high: 0 },
                storageSize: 0
            };
        }

        let totalDuration = 0;
        let totalBpm = 0;
        let bpmCount = 0;
        const keyDist = {};
        const energyDist = { low: 0, medium: 0, high: 0 };

        analyzedTracks.forEach(track => {
            // Duration
            const dur = track.analysis?.duration || track.duration || 0;
            totalDuration += dur;

            // BPM
            if (track.analysis?.bpm) {
                totalBpm += track.analysis.bpm;
                bpmCount++;
            }

            // Key distribution
            const key = track.analysis?.key;
            if (key) {
                keyDist[key] = (keyDist[key] || 0) + 1;
            }

            // Energy distribution
            const energy = track.analysis?.energy_analysis?.energy_level || 5;
            if (energy <= 3) energyDist.low++;
            else if (energy <= 6) energyDist.medium++;
            else energyDist.high++;
        });

        // Estimate storage size (rough approximation of JSON size)
        const storageSize = new Blob([JSON.stringify(analyzedTracks)]).size;

        return {
            totalTracks: analyzedTracks.length,
            totalDuration,
            avgBpm: bpmCount > 0 ? Math.round(totalBpm / bpmCount) : 0,
            keyDistribution: keyDist,
            energyDistribution: energyDist,
            storageSize
        };
    }, [analyzedTracks]);

    // Format duration as hours:minutes
    const formatDuration = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    };

    // Format bytes to human readable
    const formatBytes = (bytes) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Get top keys
    const topKeys = useMemo(() => {
        return Object.entries(stats.keyDistribution)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
    }, [stats.keyDistribution]);

    // Handle clear library
    const handleClearLibrary = () => {
        if (onClearLibrary) {
            onClearLibrary();
        }
        setShowClearConfirm(false);
    };

    // Handle export library
    const handleExportLibrary = async () => {
        try {
            setExportStatus('exporting');

            const exportData = {
                exportedAt: new Date().toISOString(),
                version: '1.0',
                trackCount: analyzedTracks.length,
                tracks: analyzedTracks.map(track => ({
                    name: track.file?.name,
                    path: track.file?.path,
                    bpm: track.analysis?.bpm,
                    key: track.analysis?.key,
                    duration: track.analysis?.duration || track.duration,
                    energy: track.analysis?.energy_analysis?.energy_level,
                    lufs: track.analysis?.audio_stats?.lufs,
                    cuePoints: track.analysis?.cue_points,
                    addedAt: track.addedAt
                }))
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mixed-in-ai-library-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setExportStatus('success');
            setTimeout(() => setExportStatus(null), 3000);
        } catch (err) {
            console.error('Export failed:', err);
            setExportStatus('error');
            setTimeout(() => setExportStatus(null), 3000);
        }
    };

    return (
        <div className="settings-view">
            <div className="settings-header">
                <Settings size={24} />
                <h2>Settings</h2>
            </div>

            {/* Library Statistics */}
            <section className="settings-section">
                <h3 className="section-title">
                    <Database size={18} />
                    Library Statistics
                </h3>

                <div className="stats-grid">
                    <div className="stat-card">
                        <div className="stat-icon">
                            <Music size={20} />
                        </div>
                        <div className="stat-content">
                            <div className="stat-value">{stats.totalTracks}</div>
                            <div className="stat-label">Total Tracks</div>
                        </div>
                    </div>

                    <div className="stat-card">
                        <div className="stat-icon">
                            <Clock size={20} />
                        </div>
                        <div className="stat-content">
                            <div className="stat-value">{formatDuration(stats.totalDuration)}</div>
                            <div className="stat-label">Total Duration</div>
                        </div>
                    </div>

                    <div className="stat-card">
                        <div className="stat-icon">
                            <Zap size={20} />
                        </div>
                        <div className="stat-content">
                            <div className="stat-value">{stats.avgBpm || '-'}</div>
                            <div className="stat-label">Average BPM</div>
                        </div>
                    </div>

                    <div className="stat-card">
                        <div className="stat-icon">
                            <HardDrive size={20} />
                        </div>
                        <div className="stat-content">
                            <div className="stat-value">{formatBytes(stats.storageSize)}</div>
                            <div className="stat-label">Cache Size</div>
                        </div>
                    </div>
                </div>

                {/* Key Distribution */}
                {topKeys.length > 0 && (
                    <div className="key-distribution">
                        <h4>Top Keys</h4>
                        <div className="key-bars">
                            {topKeys.map(([key, count]) => (
                                <div key={key} className="key-bar-item">
                                    <span className="key-label">{key}</span>
                                    <div className="key-bar">
                                        <div
                                            className="key-bar-fill"
                                            style={{
                                                width: `${(count / stats.totalTracks) * 100}%`
                                            }}
                                        />
                                    </div>
                                    <span className="key-count">{count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Energy Distribution */}
                {stats.totalTracks > 0 && (
                    <div className="energy-distribution">
                        <h4>Energy Distribution</h4>
                        <div className="energy-segments">
                            <div className="energy-segment low">
                                <span className="energy-label">Low (1-3)</span>
                                <span className="energy-count">{stats.energyDistribution.low}</span>
                            </div>
                            <div className="energy-segment medium">
                                <span className="energy-label">Medium (4-6)</span>
                                <span className="energy-count">{stats.energyDistribution.medium}</span>
                            </div>
                            <div className="energy-segment high">
                                <span className="energy-label">High (7-10)</span>
                                <span className="energy-count">{stats.energyDistribution.high}</span>
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {/* Appearance Settings */}
            <section className="settings-section">
                <h3 className="section-title">
                    <Palette size={18} />
                    Appearance
                </h3>

                <div className="setting-item">
                    <div className="setting-info">
                        <div className="setting-name">Theme</div>
                        <div className="setting-description">
                            Choose between dark and light mode for the interface.
                        </div>
                    </div>
                    <div className="setting-control">
                        <div className="toggle-group theme-toggle-group">
                            <button
                                className={`toggle-btn ${theme === 'dark' ? 'active' : ''}`}
                                onClick={() => onSetTheme?.('dark')}
                            >
                                <Moon size={14} />
                                Dark
                            </button>
                            <button
                                className={`toggle-btn ${theme === 'light' ? 'active' : ''}`}
                                onClick={() => onSetTheme?.('light')}
                            >
                                <Sun size={14} />
                                Light
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* Analysis Settings */}
            <section className="settings-section">
                <h3 className="section-title">
                    <Zap size={18} />
                    Analysis Settings
                </h3>

                <div className="setting-item">
                    <div className="setting-info">
                        <div className="setting-name">Analysis Quality</div>
                        <div className="setting-description">
                            Quick mode is faster but less accurate. Full mode provides detailed analysis.
                        </div>
                    </div>
                    <div className="setting-control">
                        <div className="toggle-group">
                            <button
                                className={`toggle-btn ${analysisQuality === 'quick' ? 'active' : ''}`}
                                onClick={() => onSetAnalysisQuality?.('quick')}
                            >
                                Quick
                            </button>
                            <button
                                className={`toggle-btn ${analysisQuality === 'full' ? 'active' : ''}`}
                                onClick={() => onSetAnalysisQuality?.('full')}
                            >
                                Full
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* Data Management */}
            <section className="settings-section">
                <h3 className="section-title">
                    <FileJson size={18} />
                    Data Management
                </h3>

                <div className="action-buttons">
                    <button
                        className="action-btn export-btn"
                        onClick={handleExportLibrary}
                        disabled={stats.totalTracks === 0 || exportStatus === 'exporting'}
                    >
                        {exportStatus === 'exporting' ? (
                            <>
                                <span className="spinner-small" />
                                Exporting...
                            </>
                        ) : exportStatus === 'success' ? (
                            <>
                                <CheckCircle size={18} />
                                Exported!
                            </>
                        ) : (
                            <>
                                <Download size={18} />
                                Export Library Data
                            </>
                        )}
                    </button>

                    <button
                        className="action-btn clear-btn"
                        onClick={() => setShowClearConfirm(true)}
                        disabled={stats.totalTracks === 0}
                    >
                        <Trash2 size={18} />
                        Clear Library Cache
                    </button>
                </div>

                {/* Clear Confirmation Dialog */}
                {showClearConfirm && (
                    <div className="confirm-dialog">
                        <div className="confirm-content">
                            <AlertTriangle size={24} className="warning-icon" />
                            <h4>Clear Library Cache?</h4>
                            <p>
                                This will remove all {stats.totalTracks} analyzed tracks from your library.
                                This action cannot be undone.
                            </p>
                            <div className="confirm-actions">
                                <button
                                    className="cancel-btn"
                                    onClick={() => setShowClearConfirm(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="confirm-delete-btn"
                                    onClick={handleClearLibrary}
                                >
                                    Clear Library
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {/* About */}
            <section className="settings-section about-section">
                <h3 className="section-title">About</h3>
                <div className="about-content">
                    <div className="about-name">Mixed In AI</div>
                    <div className="about-version">Version {window.electronAPI?.appVersion || '1.0.0'}</div>
                    <div className="about-description">
                        AI-powered audio analysis for DJs
                    </div>
                </div>
            </section>
        </div>
    );
};

export default memo(SettingsView);
