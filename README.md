# Smart Pothole Detection System — RoadGuard (V2)

MERN stack + Python/TensorFlow AI for image upload, geolocation, centralized MongoDB reports, an authority dashboard, and repair status management — rebuilt with a stronger **RoadGuard** UI and richer workflows.

## What’s new in this rebuild
- Split-panel auth with full-bleed road hero branding
- Citizen report flow: drag-and-drop / camera capture, live preview, GPS, address & notes
- Dashboard filters (status, severity, search) and sorting
- Report detail modal with OpenStreetMap deep-link
- Dark / light theme, Help and Contact links, and a site footer
- Complaint registration and repair status email notifications (SMTP)
- Repair completion photos with citizen ratings and community feedback
- Live map with severity-colored pins and auto fit-bounds
- Admin status updates + delete (with image cleanup)
- Toast feedback and loading indicators
- Stats endpoint at `GET /api/reports/stats`

## Local run (quick start)
Requirements: Node.js 18+ (20 recommended), Python 3.11 or 3.12 (TensorFlow does not support 3.13 yet), a MongoDB database (Atlas free tier or local MongoDB).

1. **Backend**
   ```
   cd backend
   cp .env.example .env        # Windows: copy .env.example .env  -> then fill MONGO_URI, JWT_SECRET
   npm install
   npm run seed:admin          # creates admin + contractor accounts
   npm run dev                 # http://localhost:5000
   ```
2. **AI service** (new terminal)
   ```
   cd ai_model
   python -m venv .venv
   .venv\Scripts\activate      # Linux/macOS: source .venv/bin/activate
   pip install -r requirements.txt
   python app.py               # http://localhost:8000
   ```
3. **Frontend** (new terminal)
   ```
   cd frontend
   npm install
   npm run dev                 # http://localhost:5173
   ```
   `frontend/.env.development` already proxies `/api` to `http://localhost:5000`.

Check: `http://localhost:5000/api/health` (backend + DB) and `http://localhost:8000/health` (AI model loaded).

## OTP login — how to make it work
Every login/registration needs a 6-digit OTP, sent by email (SMTP) or SMS (Twilio).

* **Easiest for demo / viva:** keep `OTP_DEV_LOG=true` in `backend/.env`. The code is printed in the backend terminal (`[OTP DEV] ...`) even if email/SMS is not configured. It is ignored automatically when `NODE_ENV=production`.
* **Email (Gmail):** turn on 2-Step Verification, create a 16-character *App Password* (Google Account -> Security -> App passwords) and set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM=RoadGuard <you@gmail.com>`.
* **SMS (Twilio):** `TWILIO_PHONE_NUMBER` must be a number issued by Twilio, not your own mobile number. Trial accounts can only text numbers verified in the Twilio console, and SMS to India needs extra Twilio geo-permission / DLT registration, so email OTP is recommended.
* **Admin / contractor** use fake login emails (`admin@pothole.local`). Set `ADMIN_OTP_EMAIL` / `CONTRACTOR_OTP_EMAIL` to a real inbox and run `npm run seed:admin` again so their codes arrive there.
* Default seeded logins: values of `ADMIN_EMAIL` / `ADMIN_PASSWORD` and `CONTRACTOR_EMAIL` / `CONTRACTOR_PASSWORD` in `backend/.env`.

## TensorFlow model
The AI server expects `ai_model/model/pothole_classifier.keras` (already included). To retrain, create `dataset/train`, `dataset/val` **and `dataset/test`** (each with `normal/` and `pothole/`, no duplicate images across splits) and run `python training/train.py`. The classifier returns pothole/normal and confidence. Bounding boxes need a separate object-detection model.

## Auth (Cloudflare Turnstile)
Login and registration are protected with [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/). Dummy always-pass keys are set for local development:
- `VITE_TURNSTILE_SITE_KEY` in `frontend/.env`
- `TURNSTILE_SECRET_KEY` in `backend/.env`

Replace them with your site/secret pair from the Cloudflare dashboard for production.

Login and registration also require a six-digit one-time password (OTP). Users can choose email or SMS; registration collects an international-format phone number so either delivery option is available. OTP codes expire after 10 minutes and are limited to five attempts, with a one-minute resend delay.

Configure one or both delivery providers in `backend/.env`:
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` (optional if the SMTP username is a valid sender). Set `SMTP_SECURE=true` when required; port 465 is secure by default.
- SMS: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER`.

The selected provider must be configured and able to deliver messages before users can complete that OTP method.

After login or register, the signed-in name, email, and role appear in the navbar profile chip.

Complaint confirmation and status-update emails use the same SMTP settings. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `SMTP_FROM` in `backend/.env`. Reports are saved even if delivery fails; the app displays an email-delivery warning. Agencies can attach a repair photo when marking a report as repaired, and citizens can then review the repair with a star rating and feedback.

To show a real support email in the footer, set `VITE_SUPPORT_EMAIL` in the frontend build environment. The theme preference is saved in the browser.

## Dual complaint routing
When a pothole is detected (or AI is offline so the report is treated as a civic complaint), the ticket is dispatched **separately** to:
1. Government / municipal desk (`admin` role)
2. City road contractor desk (`contractor` role)

If one desk does not acknowledge within `ESCALATION_HOURS` (default 24), that lane is marked `no_response` and the complaint is escalated to the other desk.

## Admin & contractor
Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` and `CONTRACTOR_EMAIL` / `CONTRACTOR_PASSWORD` in `backend/.env`, then run `npm run seed:admin`.

## Maps
The dashboard uses Leaflet/OpenStreetMap (no paid Google Maps key). Severity pins: red = High, amber = Medium, green = Low.

## Cloudinary
Local uploads are used for easy development; Cloudinary variables remain available for production.
