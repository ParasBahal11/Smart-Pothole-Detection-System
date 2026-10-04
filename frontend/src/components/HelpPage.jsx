import React from 'react';

const FAQ = [
  ['How do I report a pothole?', 'Log in as a citizen, open Report, add a clear photo (drag & drop or camera), capture your GPS location and press “Analyze & submit”. The AI checks the image and your complaint is created instantly.'],
  ['Why do I need an OTP to log in?', 'Every login and registration is protected with a 6-digit one-time code sent to your email (or SMS), so nobody can use your account with only a password. The code expires in 10 minutes.'],
  ['What emails will I receive about my complaint?', 'Three: one when your complaint is registered, one when work is under process, and one when it is resolved. The resolved email includes photos of the completed work.'],
  ['What does “Pending”, “In Progress” and “Repaired” mean?', 'Pending: registered and waiting. In Progress: the government desk or contractor has acknowledged it and work is under process. Repaired: work is done and photo proof has been uploaded.'],
  ['Who receives my complaint?', 'Confirmed potholes go separately to the government (municipal) desk and the city road contractor. If one desk does not respond within 24 hours, the complaint is escalated to the other.'],
  ['How do I rate a repair?', 'When a complaint is Repaired, open it from your dashboard. You will see the before and after photos, and you can give 1–5 stars and write feedback.'],
  ['The AI said “normal” but there is a pothole. What now?', 'The model is a simple classifier and can be wrong. Retake the photo from standing height in daylight with the damage centred, or add notes/landmark so the desk can check it manually.'],
  ['I did not receive the OTP / email.', 'Check the spam folder, wait one minute and request a new code. If it still does not arrive, use the Contact page and we will help you.'],
];

export default function HelpPage({ setPage }) {
  return (
    <main className="page static-page">
      <header className="page-head">
        <div>
          <h1>Help &amp; FAQ</h1>
          <p>Quick answers about reporting, notifications and ratings.</p>
        </div>
      </header>

      <div className="help-grid">
        <section className="panel">
          <div className="panel-head"><h2>How RoadGuard works</h2></div>
          <ol className="how-steps">
            <li><strong>Capture</strong><span>Take a photo of the damaged road and share your location.</span></li>
            <li><strong>Detect</strong><span>AI classifies the image and sets a severity.</span></li>
            <li><strong>Route</strong><span>The complaint goes to the government desk and the road contractor.</span></li>
            <li><strong>Track</strong><span>You get emails when it is registered, under process and resolved.</span></li>
            <li><strong>Rate</strong><span>See the work-done photos and rate the repair.</span></li>
          </ol>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Frequently asked questions</h2></div>
          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
          <p className="help-cta">
            Still stuck?{' '}
            <button type="button" className="linkish" onClick={() => setPage('contact')}>
              Contact us
            </button>
          </p>
        </section>
      </div>
    </main>
  );
}
