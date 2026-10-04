import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { api, authHeaders } from './api';
import AuthScreen from './components/AuthScreen';
import TopNav from './components/TopNav';
import Dashboard from './components/Dashboard';
import ReportForm from './components/ReportForm';
import RoadMap from './components/RoadMap';
import ReportModal from './components/ReportModal';
import ToastHost from './components/ToastHost';
import Footer from './components/Footer';
import HelpPage from './components/HelpPage';
import ContactPage from './components/ContactPage';
import TrackPage from './components/TrackPage';
import Analytics from './components/Analytics';

function headingFor(user) {
  if (user.role === 'admin') {
    return {
      title: 'Government command center',
      sub: 'Complaints land here and with the city contractor. If one desk is silent, the other is escalated.',
    };
  }
  if (user.role === 'contractor') {
    return {
      title: 'City contractor desk',
      sub: 'Pothole complaints assigned to the road contractor. Acknowledge yours or pick up government no-response escalations.',
    };
  }
  return {
    title: 'Your road reports',
    sub: `Hi ${user.name} — capture damage, let AI assess it, and track both government and contractor response.`,
  };
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });
  const [page, setPage] = useState('dashboard');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editingReport, setEditingReport] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [authMode, setAuthMode] = useState('login');
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');

  const toggleTheme = () =>
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* ignore */
      }
      return next;
    });

  const toast = useCallback((text, type = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const persistSession = (data) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setReports([]);
    setPage('dashboard');
    setAuthMode('login');
  };

  const loadReports = useCallback(async () => {
    if (!token || !user) return;
    setLoading(true);
    try {
      const path = user.role === 'user' ? '/reports/mine' : '/reports';
      const data = await api(path, { headers: authHeaders(token, false) });
      setReports(Array.isArray(data) ? data : []);
    } catch (e) {
      toast(e.message, 'err');
      if (/auth|token|expired/i.test(e.message)) logout();
    } finally {
      setLoading(false);
    }
  }, [token, user, toast]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!token) return;
    api('/auth/me', { headers: authHeaders(token, false) })
      .then((data) => {
        if (data.user) {
          localStorage.setItem('user', JSON.stringify(data.user));
          setUser(data.user);
        }
      })
      .catch(() => {});
  }, [token]);

  const agency = user?.role === 'admin' || user?.role === 'contractor';
  const copy = user ? headingFor(user) : null;

  return (
    <div className="app-shell">
      <TopNav
        user={user}
        token={token}
        page={page}
        setPage={setPage}
        onLogout={logout}
        authMode={authMode}
        setAuthMode={setAuthMode}
        theme={theme}
        toggleTheme={toggleTheme}
        onUserUpdated={persistSession}
        onToast={toast}
      />

      {page === 'track' ? (
        <TrackPage />
      ) : page === 'help' ? (
        <HelpPage setPage={setPage} />
      ) : page === 'contact' ? (
        <ContactPage user={user} onToast={toast} />
      ) : !token || !user ? (
        <AuthScreen
          mode={authMode}
          setMode={setAuthMode}
          onSuccess={(data) => {
            persistSession(data);
            toast(`Welcome, ${data.user.name}`);
          }}
        />
      ) : (
        <main className="page">
          {loading && <div className="loading-bar" aria-hidden />}
          <header className="page-head">
            <div>
              <h1>{copy.title}</h1>
              <p>{copy.sub}</p>
            </div>
            <div className="role-chip">{user.role === 'admin' ? 'government' : user.role}</div>
          </header>

          {page === 'report' && user.role === 'user' ? (
            <ReportForm
              token={token}
              onDone={(report) => {
                setPage('dashboard');
                loadReports();
                if (report?.supported) {
                  toast('Thanks! Your confirmation was added to the existing complaint');
                } else if (report?.complaintRouting?.dispatched) {
                  toast('Pothole complaint sent to Government and City Road Contractor');
                } else {
                  toast('Report submitted');
                }
              }}
              onError={(m) => toast(m, 'err')}
            />
          ) : page === 'map' ? (
            <RoadMap reports={reports} onSelect={setSelected} />
          ) : page === 'analytics' ? (
            <Analytics token={token} role={user.role} />
          ) : (
            <Dashboard
              reports={reports}
              agency={agency}
              role={user.role}
              token={token}
              reload={loadReports}
              onSelect={setSelected}
              onEdit={(report) => {
                setSelected(report);
                setEditingReport(true);
              }}
              onToast={toast}
            />
          )}
        </main>
      )}

      {selected && user && (
        <ReportModal
          report={selected}
          startEditing={editingReport}
          agency={agency}
          role={user.role}
          token={token}
          onClose={() => {
            setSelected(null);
            setEditingReport(false);
          }}
          onUpdated={() => {
            loadReports();
            setSelected(null);
            setEditingReport(false);
            toast('Report updated');
          }}
          onError={(m) => toast(m, 'err')}
        />
      )}
      <Footer setPage={setPage} />
      <ToastHost toasts={toasts} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
