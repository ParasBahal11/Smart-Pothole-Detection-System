# Smart Pothole Detection System — RoadGuard (V2)

MERN stack + Python/TensorFlow AI for image upload, geolocation, centralized MongoDB reports, an authority dashboard, and repair status management — rebuilt with a stronger **RoadGuard** UI and richer workflows.

## What’s new in this rebuild
- Split-panel auth with full-bleed road hero branding
- Citizen report flow: drag-and-drop / camera capture, live preview, GPS, address & notes
- Dashboard filters (status, severity, search) and sorting
- Report detail modal with OpenStreetMap deep-link
- Live map with severity-colored pins and auto fit-bounds
- Admin status updates + delete (with image cleanup)
- Toast feedback and loading indicators
- Stats endpoint at `GET /api/reports/stats`

## Local run
1. Install Node.js and Python 3.11/3.12.
2. MongoDB Atlas: create a database user and allow your IP. Copy `backend/.env.example` to `backend/.env` and fill `MONGO_URI`.
3. Backend: `cd backend`, `npm install`, `npm run seed:admin`, `npm run dev`.
4. AI: `cd ai_model`, `python -m venv .venv`, activate it, `pip install -r requirements.txt`, then `python app.py`.
5. Frontend: `cd frontend`, `npm install`, create `.env` with `VITE_API_URL=http://localhost:5000/api`, then `npm run dev`.

## TensorFlow model
The AI server expects `ai_model/model/pothole_classifier.keras`. Train it using labeled pothole/normal images with `python training/train.py`. The classifier returns pothole/normal and confidence. Bounding boxes need a separate object-detection model.

## Auth (Cloudflare Turnstile)
Login and registration are protected with [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/). Dummy always-pass keys are set for local development:
- `VITE_TURNSTILE_SITE_KEY` in `frontend/.env`
- `TURNSTILE_SECRET_KEY` in `backend/.env`

Replace them with your site/secret pair from the Cloudflare dashboard for production.

After login or register, the signed-in name, email, and role appear in the navbar profile chip.

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
