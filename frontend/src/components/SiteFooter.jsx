import React from 'react';

const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL;

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <section id="help" className="footer-section">
          <h2>Help</h2>
          <p>Upload a clear road photo, capture your GPS location, and submit your complaint. Track progress from your dashboard.</p>
          <p>When a repair is complete, open the report to see its completion photo and leave a rating.</p>
        </section>
        <section id="contact" className="footer-section">
          <h2>Contact</h2>
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          ) : (
            <p>For assistance, contact your RoadGuard project administrator.</p>
          )}
        </section>
        <div className="footer-bottom">
          <span>RoadGuard · Safer roads, together</span>
          <span>Complaint updates are sent to your registered email.</span>
        </div>
      </div>
    </footer>
  );
}
