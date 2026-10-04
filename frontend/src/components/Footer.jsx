import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function Footer({ setPage }) {
  const [info, setInfo] = useState({ email: '', phone: '', hours: '' });

  useEffect(() => {
    api('/contact/info').then(setInfo).catch(() => {});
  }, []);

  const go = (p) => (e) => {
    e.preventDefault();
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            Road<span>Guard</span>
          </div>
          <p>
            AI-assisted pothole reporting with dual complaint routing to government and city road
            contractors, live maps and repair tracking.
          </p>
        </div>

        <div>
          <h4>Quick links</h4>
          <ul>
            <li><a href="#dashboard" onClick={go('dashboard')}>Dashboard</a></li>
            <li><a href="#map" onClick={go('map')}>Live map</a></li>
            <li><a href="#help" onClick={go('help')}>Help &amp; FAQ</a></li>
            <li><a href="#contact" onClick={go('contact')}>Contact us</a></li>
          </ul>
        </div>

        <div>
          <h4>Contact</h4>
          <ul>
            {info.email && <li><a href={`mailto:${info.email}`}>{info.email}</a></li>}
            {info.phone && <li><a href={`tel:${info.phone}`}>{info.phone}</a></li>}
            {info.hours && <li>{info.hours}</li>}
            {!info.email && !info.phone && <li><a href="#contact" onClick={go('contact')}>Send us a message</a></li>}
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} RoadGuard · Smart Pothole Detection System</span>
        <span>Built with MERN + TensorFlow · Maps © OpenStreetMap contributors</span>
      </div>
    </footer>
  );
}
