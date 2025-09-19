# Rock Paper Scissors Tracker

## Requirements
- Create a new minimal PHP application under `rps/` modeled after `fast-note/` with a single entry point (`index.php`).
- Present a barebones HTML page that captures the next Rock–Paper–Scissors match between two players.
- Persist all application data in SQLite, defaulting to `rps/data/rps.sqlite` with support for overriding the database location via an environment variable.
- Use a relational model with dedicated `players` and `venues` tables; every match must reference exactly two players and exactly one venue by foreign key.
- Allow players and venues to be created on the fly when entering a match result from the form.
- Expose a lightweight `/status` endpoint that verifies database connectivity.
- Ship a Dockerfile as part of the initial version so the app can be containerized easily.
- Document setup and usage details in this README.

## Implementation plan
1. **Project skeleton**
   - Add `index.php` and keep all runtime logic inside it for simplicity. Create a `data/` directory at runtime if needed and ensure the SQLite path can be overridden with an `RPS_DB` environment variable.
   - Route only `/` and `/status`, responding with 404 for other paths to mirror fast-note's minimalism.

2. **Database bootstrap**
   - When establishing the SQLite connection, create tables if they do not exist:
     - `players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE COLLATE NOCASE, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
     - `venues (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE COLLATE NOCASE, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
     - `matches (id INTEGER PRIMARY KEY AUTOINCREMENT, played_at TEXT DEFAULT CURRENT_TIMESTAMP, player_one_id INTEGER NOT NULL, player_two_id INTEGER NOT NULL, venue_id INTEGER NOT NULL, move_one TEXT NOT NULL, move_two TEXT NOT NULL, outcome TEXT NOT NULL, FOREIGN KEY references, CHECK(player_one_id <> player_two_id))`
   - Encapsulate connection and migration logic in helper functions so `/status` and the main handler share it.

3. **Form flow & validation**
   - Render a single HTML page with inputs for Player 1, Player 2, and Venue using `<input list>` elements backed by `<datalist>` options sourced from existing database rows to facilitate reuse.
   - Include dropdowns for each player's move (`rock`, `paper`, `scissors`). On form submission, trim inputs, ensure moves are valid, confirm both player names are present and not identical (case-insensitive), and require a venue name.
   - For each submitted name, attempt a case-insensitive lookup; insert the row when it does not exist, and reuse the ID if it does. Compute the outcome (`player_one`, `player_two`, or `draw`) server-side and insert the match referencing the resolved IDs.
   - Show success or validation messages and preserve form inputs on errors. After a successful save, display the most recent 10 matches in a simple table joined to player and venue names.

4. **Status endpoint**
   - Implement `/status` to run a trivial query (e.g., `SELECT 1`) and return `ok` or a 500 response if the query fails, enabling operational checks.

5. **Docker support**
   - Create `rps/Dockerfile` based on the fast-note image: use Apache with PHP + SQLite extension, copy the app, set permissions, expose port 8080, and set `ENV RPS_DB=/var/www/html/data/rps.sqlite`.
   - Document Docker build/run commands in the README alongside instructions for running with PHP's built-in server.

## Usage

### Run with PHP's built-in server
```bash
cd rps
php -S localhost:8000
```

Then open <http://localhost:8000> in a browser to log matches. The application stores data in `data/rps.sqlite` by default and will create the directory/file automatically.

### Status endpoint
A lightweight health check is available at `/status`. When the database can be reached it responds with plain text `ok`.

### Configuration
Override the database location by setting the `RPS_DB` environment variable before starting PHP:

```bash
RPS_DB="file:memdb1?mode=memory&cache=shared" php -S localhost:8000
```

This is useful for ephemeral or test environments.

### Run with Docker
```bash
cd rps
# Build image
docker build -t rps-tracker .

# Run container with persistent storage
mkdir -p data
docker run -p 8080:8080 -v "$(pwd)/data:/var/www/html/data" --name rps-tracker rps-tracker
```

The Docker image exposes the service on port 8080 and persists the SQLite database via the mounted volume.
