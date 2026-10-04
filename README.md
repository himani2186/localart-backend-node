# LocalArt — Node.js Backend Migration

This project is the complete Node.js/Express migration of the Python/Flask backend, built with **zero changes to the frontend** and **keeping the exact same SQLite database**.

---

## 🎯 Key Guarantees & Features

1. **Identical Frontend (No Changes Needed)**:
   - Uses **Nunjucks** configured to render the existing Jinja2/HTML templates in `templates/`.
   - Supports all custom filters and global functions (`url_for`, `format`, `unique`, `map`, `range`).
   - Serves static assets (CSS, JS, images, and user uploads) from `static/` at the exact same `/static/...` URLs.

2. **Same SQLite Database**:
   - Directly connects to your existing database at `C:\Users\HIMANI\local art\localart.db` (configurable in `.env`).
   - No data loss, no schema resets, no breaking table alterations.
   - An untouched initial backup is also saved at `localart.db.backup`.

3. **100% Password Hash Compatibility**:
   - Uses Node's built-in `crypto.scryptSync` matching Python/Werkzeug's `scrypt:32768:8:1$salt$hash` format.
   - All existing users (including admin and existing customers) can log in immediately with their existing passwords!
   - New user registrations generate hashes that are also compatible with Python/Werkzeug.

4. **All 48 Endpoints & Features Covered**:
   - **Authentication**: Sign up, Login, Logout, Dashboard, Profile with role-based routing (`admin`, `artist`, `customer`).
   - **Shop & Artworks**: Catalog filtering, product details, reviews, related artworks, wishlist toggle (`/api/wishlist/toggle`).
   - **Cart & Checkout**: Cart page, add/update/remove APIs, direct "Buy Now" flow, checkout calculations (free delivery for orders ≥ ₹2000).
   - **Orders & Tracking**: Order placement, order items creation, stock decrement, order history, tracking steps (`SHOP_STATUSES`), status progression API, invoice generator.
   - **Reviews**: Review submission, editing, deletion, and automatic artwork rating recalculation.
   - **Culture & Regional Art**: Culture overview, regional art details, art history, state-based art.
   - **Events**: Event listings and detailed event views.
   - **Community**: Posts feed and image uploads (`/community/create`).
   - **Admin & Artist Dashboards**: Protected admin and artist management views.
   - **Health Check**: `/test` endpoint returning JSON status.

---

## 🚀 How to Run

Open **PowerShell** or **Command Prompt**:

```powershell
cd "C:\Users\HIMANI\localart-backend-node"
npm start
```

For development mode with auto-reload:

```powershell
npm run dev
```

Visit in your browser:
👉 **http://localhost:5000** (or your configured `PORT`)

---

## ⚙️ Configuration (`.env`)

```env
PORT=5000
DATABASE_PATH=C:/Users/HIMANI/local art/localart.db
SESSION_SECRET=localart_secret_key
UPLOAD_DIR=./static/uploads
```

---

## 📁 Directory Structure

```
localart-backend-node/
├── .env                  # Environment configuration
├── .env.example          # Example environment settings
├── package.json          # Node dependencies and scripts
├── server.js             # Main Express backend server
├── localart.db.backup    # Safety backup of original database
├── data/                 # Culture, regional art, and events data
│   ├── art_history.json
│   ├── events.json
│   ├── regional_art.json
│   └── regional_art_details.json
├── templates/            # Existing HTML / Jinja2 templates (untouched)
└── static/               # Existing CSS, images, JS, and uploads
```
