import React, { useState } from 'react';
import { Moon, Pencil, Sun } from 'lucide-react';
import { api, authHeaders } from '../api';

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';
}

function roleLabel(role) {
  if (role === 'admin') return 'Government';
  if (role === 'contractor') return 'Contractor';
  return 'Citizen';
}

export default function TopNav({
  user,
  token,
  page,
  setPage,
  onLogout,
  authMode,
  setAuthMode,
  theme,
  toggleTheme,
  onUserUpdated,
  onToast,
}) {
  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [savingName, setSavingName] = useState(false);

  const go = (p) => {
    setPage?.(p);
    setOpen(false);
  };

  const saveName = async (event) => {
    event.preventDefault();
    setSavingName(true);
    try {
      const data = await api('/auth/me', {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ name }),
      });
      onUserUpdated?.(data);
      setEditingName(false);
      onToast?.('Name updated');
    } catch (error) {
      onToast?.(error.message, 'err');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <>
    <nav className="topnav">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        Road<span>Guard</span>
      </div>

      <button
        type="button"
        className="menu-toggle ghost"
        aria-label="Menu"
        onClick={() => setOpen((o) => !o)}
      >
        Menu
      </button>

      <div className={`nav-actions ${open ? 'open' : ''}`}>
        {user ? (
          <>
            <button type="button" className={page === 'dashboard' ? 'active' : ''} onClick={() => go('dashboard')}>
              Dashboard
            </button>
            {user.role === 'user' && (
              <button type="button" className={page === 'report' ? 'active' : ''} onClick={() => go('report')}>
                Report
              </button>
            )}
            <button type="button" className={page === 'map' ? 'active' : ''} onClick={() => go('map')}>
              Live map
            </button>
            <button type="button" className={page === 'analytics' ? 'active' : ''} onClick={() => go('analytics')}>
              Analytics
            </button>
            <button type="button" className={page === 'track' ? 'active' : ''} onClick={() => go('track')}>
              Track
            </button>
            <button type="button" className={page === 'help' ? 'active' : ''} onClick={() => go('help')}>
              Help
            </button>
            <button type="button" className={page === 'contact' ? 'active' : ''} onClick={() => go('contact')}>
              Contact
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="nav-profile" title={user.email}>
              <div className="nav-avatar" aria-hidden>
                {initials(user.name)}
              </div>
              <div className="nav-profile-text">
                <strong>{user.name}</strong>
                <small>
                  {user.email} · {roleLabel(user.role)}
                </small>
              </div>
              <button
                type="button"
                className="profile-edit-btn"
                aria-label="Change your name"
                title="Change name"
                onClick={() => {
                  setName(user.name || '');
                  setEditingName(true);
                  setOpen(false);
                }}
              >
                <Pencil size={14} />
              </button>
            </div>
            <button type="button" className="logout" onClick={onLogout}>
              Logout
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={page === 'dashboard' && authMode === 'login' ? 'active' : ''}
              onClick={() => {
                setPage?.('dashboard');
                setAuthMode('login');
                setOpen(false);
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={page === 'dashboard' && authMode === 'register' ? 'active' : ''}
              onClick={() => {
                setPage?.('dashboard');
                setAuthMode('register');
                setOpen(false);
              }}
            >
              Register
            </button>
            <button type="button" className={page === 'track' ? 'active' : ''} onClick={() => go('track')}>
              Track
            </button>
            <button type="button" className={page === 'help' ? 'active' : ''} onClick={() => go('help')}>
              Help
            </button>
            <button type="button" className={page === 'contact' ? 'active' : ''} onClick={() => go('contact')}>
              Contact
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </>
        )}
      </div>
    </nav>
    {editingName && (
      <div className="modal-backdrop profile-edit-backdrop" onClick={() => setEditingName(false)} role="presentation">
        <section
          className="profile-edit-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-name-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h2 id="profile-name-title">Change your name</h2>
          <p>Update the name shown on your profile. No OTP is needed.</p>
          <form onSubmit={saveName}>
            <label htmlFor="profile-name">Name</label>
            <input
              id="profile-name"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              required
            />
            <div className="profile-edit-actions">
              <button type="button" className="secondary" disabled={savingName} onClick={() => setEditingName(false)}>
                Cancel
              </button>
              <button type="submit" className="accent" disabled={savingName || !name.trim()}>
                {savingName ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </form>
        </section>
      </div>
    )}
    </>
  );
}
