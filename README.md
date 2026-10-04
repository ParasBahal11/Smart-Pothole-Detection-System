# Smart Pothole Detection System — RoadGuard (V2)

MERN stack + Python/TensorFlow AI for image upload, geolocation, centralized MongoDB reports, an authority dashboard, and repair status management — rebuilt with a stronger **RoadGuard** UI and richer workflows.

## What’s new in this rebuild
- Split-panel auth with full-bleed road hero branding
- Citizen report flow: drag-and-drop / camera capture, live preview, GPS, address & notes
- Dashboard filters (status, severity, search) and sorting
- Report detail modal with OpenStreetMap deep-link
- Live map with severity-colored pins and auto fit-bounds
- Admin status updates + delete (with image cleanup); citizens can edit pending report details and delete their own reports
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

## New features (v2.1)
- **Dark / light mode** — toggle in the navbar; choice is remembered (follows system theme on first visit).
- **Help & Contact** — navbar pages: FAQ with "how it works", and a contact form (stored in MongoDB and emailed to `SUPPORT_EMAIL`). Works without login.
- **Footer** — quick links and contact details on every page (`SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_HOURS` in `backend/.env`).
- **Duplicate complaint detection** - when a citizen submits a pothole, open complaints within `DUPLICATE_RADIUS_METERS` (default 30 m) are shown. The citizen can *support* the existing complaint (no duplicate is created) or confirm it is a different pothole. Each confirmation raises the severity score.
- **Severity score (0-100)** - explainable rule: AI pothole confidence x 70 + 6 points per citizen confirmation (max 5). 60+ High, 42+ Medium, otherwise Low. High severity routes the complaint to the government desk first. This is a rule-based priority, not a separately trained damage model.
- **Tracking ID and status timeline** - every complaint gets an ID like `RG-AB12CD34` (sent in the confirmation email). The **Track** page shows its progress without logging in; the complaint window shows the full timeline (submitted, dispatched, desk updates, escalations, status changes, work photos, rating).
- **Analytics** - status chart, severity bars, 6-month reported vs resolved, resolution rate, average repair time and rating. Citizens see their own complaints, government/contractor see all.
- **Forgot password** — "Forgot password?" on the sign-in screen emails a 6-digit code (valid 10 min, 5 attempts, 1-minute resend); entering it lets the user set a new password. With `OTP_DEV_LOG=true` the code is printed in the backend terminal.
- **Email updates to the citizen** — (1) "complaint registered" when the report is submitted, (2) "under process" when status becomes *In Progress*, (3) "resolved successfully" when it becomes *Repaired* (work-done photos attached). Each email is sent once per complaint. Uses the same SMTP settings as OTP; with `OTP_DEV_LOG=true` the emails are printed in the backend terminal if SMTP is not configured.
- **Work-done photos + rating** — government/contractor must upload at least one photo of the completed work before marking a complaint *Repaired* (open the report -> "Work done"). The citizen then sees Before/After photos and can rate 1-5 stars with feedback; recent reviews on the dashboard show the work photo.

New API routes: `POST /api/reports/:id/work-images` (agency), `GET /api/contact/info`, `POST /api/contact`.

## When is OTP used?
* **Sign in:** email + password only. **No OTP** (10 wrong attempts per email/IP are blocked for 15 minutes).
* **Register (new user):** OTP is sent to the email the user typed; the account is created only after the code is verified.
* **Forgot password:** OTP is sent to the account's email; after the code is verified the user sets a new password.

## Making OTP email reach every user
* **Recommended - Brevo (free, 300 emails/day):** create an account at brevo.com, add and verify a sender email (Senders & IP), create an API key (SMTP & API -> API keys), then set `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` in `backend/.env` **and in the Render environment**. It uses HTTPS, so it works on Render's free tier, which **blocks SMTP ports 25/465/587**.
* **Gmail SMTP** (`SMTP_HOST/PORT/USER/PASS`, with a 16-character App Password) works on your own computer but not on Render's free tier.
* **Test any address:** `cd backend && npm run test:mail -- friend@example.com` - prints the exact error if sending fails. Also check Brevo -> Transactional -> Logs (delivered / blocked / bounced) and the recipient's Spam folder.
* **Demo fallback:** `OTP_DEV_LOG=true` prints the code in the backend terminal and shows the real failure reason on the screen. Never set it on Render (ignored when `NODE_ENV=production`).
* **SMS:** off by default (`SMS_OTP_ENABLED=false`), the option is hidden. Twilio needs a Twilio-issued sender number, trial accounts only text verified numbers, and SMS to India needs extra approval. Phone is optional when registering with email OTP.
* **Admin / contractor** sign in with password only. Their forgot-password code goes to `ADMIN_OTP_EMAIL` / `CONTRACTOR_OTP_EMAIL`. Seeded logins: `ADMIN_EMAIL` / `ADMIN_PASSWORD` and `CONTRACTOR_EMAIL` / `CONTRACTOR_PASSWORD` in `backend/.env`.

## TensorFlow model
The AI server expects `ai_model/model/pothole_classifier.keras` (already included). To retrain, create `dataset/train`, `dataset/val` **and `dataset/test`** (each with `normal/` and `pothole/`, no duplicate images across splits) and run `python training/train.py`. The binary classifier returns pothole/normal and confidence; report submission is accepted only when it positively detects a pothole at 75% confidence or higher, and fails closed if AI is unavailable. Bounding boxes need a separate object-detection model.

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

After login or register, the signed-in name, email, and role appear in the navbar profile chip. Users can change their name from the profile without another OTP.

## Dual complaint routing
Only images positively classified as potholes are accepted for a report; if the AI service is unavailable or no pothole is detected, the image is rejected and no complaint is created. Accepted pothole complaints are dispatched **separately** to:
1. Government / municipal desk (`admin` role)
2. City road contractor desk (`contractor` role)

If one desk does not acknowledge within `ESCALATION_HOURS` (default 24), that lane is marked `no_response` and the complaint is escalated to the other desk.

## Admin & contractor
Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` and `CONTRACTOR_EMAIL` / `CONTRACTOR_PASSWORD` in `backend/.env`, then run `npm run seed:admin`.

## Maps
The dashboard uses Leaflet/OpenStreetMap (no paid Google Maps key). Severity pins: red = High, amber = Medium, green = Low.

## Cloudinary
Local uploads are used for easy development; Cloudinary variables remain available for production.
