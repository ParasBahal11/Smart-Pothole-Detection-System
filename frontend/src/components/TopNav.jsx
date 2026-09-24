import React, { useState } from 'react';

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

export default function TopNav({ user, page, setPage, onLogout, authMode, setAuthMode }) {
  const [open, setOpen] = useState(false);

  const go = (p) => {
    setPage?.(p);
    setOpen(false);
  };

  return (
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
            </div>
            <button type="button" className="logout" onClick={onLogout}>
              Logout
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={authMode === 'login' ? 'active' : ''}
              onClick={() => {
                setAuthMode('login');
                setOpen(false);
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={authMode === 'register' ? 'active' : ''}
              onClick={() => {
                setAuthMode('register');
                setOpen(false);
              }}
            >
              Register
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
