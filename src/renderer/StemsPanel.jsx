import React, { useState } from 'react';
import { Layers, Loader, Play, Pause, AlertCircle } from 'lucide-react';
import './library.css';

const StemsPanel = ({ track, onSeparate }) => {
    const [isSeparating, setIsSeparating] = useState(false);
    const [stems, setStems] = useState(null);
    const [error, setError] = useState(null);
    const [playingStem, setPlayingStem] = useState(null);
    const [audioElements, setAudioElements] = useState({});

    const handleSeparate = async () => {
        setIsSeparating(true);
        setError(null);
        try {
            const result = await window.electronAPI.separateStems(track.file.path);
            if (result.status === 'success') {
                setStems(result.stems);
            } else {
                setError(result.error || 'Separation failed');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSeparating(false);
        }
    };

    const toggleStem = (name, path) => {
        if (playingStem === name) {
            // Pause
            audioElements[name]?.pause();
            setPlayingStem(null);
        } else {
            // Stop others
            if (playingStem && audioElements[playingStem]) {
                audioElements[playingStem].pause();
            }

            // Play new
            if (!audioElements[name]) {
                const audio = new Audio(`file://${path}`);
                audio.onended = () => setPlayingStem(null);
                setAudioElements(prev => ({ ...prev, [name]: audio }));
                audio.play();
            } else {
                audioElements[name].play();
            }
            setPlayingStem(name);
        }
    };

    return (
        <div className="stems-panel">
            <div className="stems-header">
                <Layers size={18} className="stems-icon" />
                <h3>Stem Separation</h3>
                <span className="pro-badge">PRO</span>
            </div>

            {!stems && !isSeparating && (
                <div className="stems-intro">
                    <p>Separate this track into vocals, drums, bass, and other instruments using AI.</p>
                    <button className="separate-btn" onClick={handleSeparate}>
                        <Layers size={16} />
                        Separate Stems (Demucs)
                    </button>
                </div>
            )}

            {isSeparating && (
                <div className="stems-loading">
                    <Loader size={24} className="spinner" />
                    <p>Separating stems... this may take a few minutes (GPU recommended).</p>
                </div>
            )}

            {error && (
                <div className="stems-error">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}

            {stems && (
                <div className="stems-grid">
                    {Object.entries(stems).map(([name, path]) => (
                        <div key={name} className={`stem-card ${playingStem === name ? 'playing' : ''}`}>
                            <div className="stem-name">{name}</div>
                            <button
                                className="stem-play-btn"
                                onClick={() => toggleStem(name, path)}
                            >
                                {playingStem === name ? <Pause size={16} /> : <Play size={16} />}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default StemsPanel;
