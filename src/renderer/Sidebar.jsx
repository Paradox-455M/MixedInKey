import React from 'react';
import { Music, ListMusic, Sparkles, FileAudio, Disc } from 'lucide-react';
import './sidebar.css';

const Sidebar = ({ currentView, onViewChange }) => {
  const navItems = [
    {
      id: 'analyze',
      label: 'Analyze Track',
      icon: FileAudio,
      description: 'Analyze single audio file'
    },
    {
      id: 'set-planner',
      label: 'Set Planner',
      icon: ListMusic,
      description: 'Build DJ set plans'
    },
    {
      id: 'dj-mix',
      label: 'DJ Mix',
      icon: Disc,
      description: 'Practice mix with 2 decks'
    },
    {
      id: 'library',
      label: 'Library',
      icon: Sparkles,
      description: 'Browse analyzed tracks'
    }
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Music size={24} />
          </div>
          <div className="sidebar-logo-text">
            <div className="sidebar-logo-title">Mixed In AI</div>
            <div className="sidebar-logo-subtitle">Audio Analysis</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          
          return (
            <button
              key={item.id}
              className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onViewChange(item.id)}
              title={item.description}
            >
              <Icon size={20} className="sidebar-nav-icon" />
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-version">
          v{window.electronAPI?.appVersion || '1.0.0'}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
