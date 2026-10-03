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
import SiteFooter from './components/SiteFooter';

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
  const [theme, setTheme] = useState(() => localStorage.getItem('roadguard-theme') === 'dark' ? 'dark' : 'light');
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
  const [toasts, setToasts] = useState([]);
  const [authMode, setAuthMode] = useState('login');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('roadguard-theme', theme);
  }, [theme]);

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
        page={page}
        setPage={setPage}
        onLogout={logout}
        authMode={authMode}
        setAuthMode={setAuthMode}
        theme={theme}
        onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
      />

      {!token || !user ? (
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
                const complaintToast = report?.complaintRouting?.dispatched
                  ? 'Complaint registered and sent to Government and City Road Contractor'
                  : 'Complaint registered';
                if (report?.emailNotification?.sent === false) {
                  toast(`${complaintToast}, but the confirmation email could not be sent.`, 'err');
                } else {
                  toast(`${complaintToast}. Confirmation email sent.`);
                }
              }}
              onError={(m) => toast(m, 'err')}
            />
          ) : page === 'map' ? (
            <RoadMap reports={reports} onSelect={setSelected} />
          ) : (
            <Dashboard
              reports={reports}
              agency={agency}
              role={user.role}
              token={token}
              reload={loadReports}
              onSelect={setSelected}
              onToast={toast}
            />
          )}
        </main>
      )}

      {selected && (
        <ReportModal
          report={selected}
          agency={agency}
          role={user.role}
          token={token}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            loadReports();
            setSelected(null);
            toast('Report updated');
          }}
          onStatusUpdated={(result) => {
            loadReports();
            setSelected(null);
            toast(
              result?.emailNotification?.sent === false
                ? 'Status updated, but the email notification could not be sent.'
                : 'Report status and email notification updated',
              result?.emailNotification?.sent === false ? 'err' : 'ok'
            );
          }}
          onError={(m) => toast(m, 'err')}
        />
      )}
      <SiteFooter />
      <ToastHost toasts={toasts} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
