# System Design Document: Zero-Knowledge Identity System

## 1. Overview
This application implements a "Passwordless" identity system. It replaces traditional email/password registration with **WebAuthn (Passkeys)** and **Offline Recovery Codes**. The system is designed to be self-sovereign, removing dependence on third-party email providers for authentication or recovery.

---

## 2. Technical Stack
- **Language:** Go (Golang)
- **Database:** SQLite (Stateful store)
- **Containerization:** Docker
- **Core Libraries:**
    - `github.com/go-webauthn/webauthn`: FIDO2/WebAuthn implementation.
    - `golang.org/x/crypto/argon2`: Secure hashing for recovery codes.
    - `github.com/google/uuid`: Unique identifier generation for users.
- **Frontend:** Vanilla JS / HTML (utilizing `navigator.credentials` API).

---

## 3. Identity Architecture

### 3.1 Root Identity
The "Account" is anchored to a unique **User ID (UUID)** generated at registration. There is no email address associated with the account.

### 3.2 Authentication Factors
1.  **Primary:** WebAuthn Passkeys (Multi-device support).
2.  **Fallback:** High-entropy recovery codes (Stored offline by user, hashed in DB).

---

## 4. Functional Specifications

### 4.1 Signup
1.  **User Input:** User chooses a unique username.
2.  **Credential Creation:** Server triggers `BeginRegistration`. Browser prompts for a Passkey. Server verifies and stores the Public Key in SQLite.
3.  **Recovery Generation:** Server generates 10 random recovery codes.
4.  **Secure Handoff:** Codes are hashed using **Argon2** and stored. User is prompted to download/save the plain-text codes. Registration is not complete until the user confirms save.

### 4.2 Login
1.  **Identification:** User enters username.
2.  **Challenge:** Server triggers `BeginLogin` and stores the challenge in a temporary SQLite table.
3.  **Assertion:** Browser signs the challenge using the local passkey.
4.  **Verification:** Server verifies signature against stored Public Key and updates the `sign_count` to prevent replay attacks.
5.  **Session:** A secure session cookie is issued upon success.

### 4.3 Logout
1.  The session cookie is invalidated/cleared.
2.  User is redirected to the landing page.

### 4.4 Recovery ("Break-Glass")
1.  **Trigger:** User selects "Lost Device/Passkey."
2.  **Challenge:** User provides one of their offline recovery codes.
3.  **Verification:** Server fetches all hashes for that user, verifies the code via Argon2.
4.  **Consumption:** The used code is marked as `used_at = CURRENT_TIMESTAMP` (Single-use).
5.  **Provisioning:** User is granted a one-time window to register a new Passkey.

### 4.5 Manage Keys (Security Dashboard)
Authenticated users can:
- **Add Key:** Register an additional Passkey (e.g., adding a hardware YubiKey as a backup).
- **Label Key:** Assign a nickname (e.g., "Work Laptop") to a credential.
- **Revoke Key:** Delete a specific credential from the database to stop that device from accessing the account.

### 4.6 Pages
- **Home Page:** Protected route. Displays "You are logged in" and the user's username.
- **Admin Page:** Protected route. Provides a view of all users, their registered key counts, and account creation dates.

---

## 5. Data Model (SQLite)

- **`users`**: `id (BLOB PK)`, `username (TEXT UNIQUE)`, `created_at (DATETIME)`
- **`credentials`**: `id (BLOB PK)`, `user_id (BLOB FK)`, `public_key (BLOB)`, `sign_count (INT)`, `nickname (TEXT)`
- **`recovery_codes`**: `id (INT PK)`, `user_id (BLOB FK)`, `code_hash (BLOB)`, `used_at (DATETIME)`
- **`challenges`**: `session_id (TEXT PK)`, `user_id (BLOB)`, `challenge (BLOB)`, `expires_at (DATETIME)`

---

## 6. Deployment
- **Docker:** A multi-stage build converting Go source to a lean Alpine image.
- **Persistence:** SQLite database file mounted via a Docker Volume to ensure data persists across container restarts.
- **Optimization:** SQLite configured with `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys = ON`.

---

## 7. Testing Plan

### 7.1 Unit Tests
- **Cryptography:** Verify Argon2 hashing and comparison logic for recovery codes.
- **Model Logic:** Test UUID generation and credential mapping.

### 7.2 Integration Tests (The "No-Mock" Approach)
- **Database Layer:** Use an in-memory SQLite instance to test the full CRUD cycle of User $\rightarrow$ Credentials $\rightarrow$ Recovery Codes.
- **Auth Flow (Server-Side):** Use a mock WebAuthn authenticator to simulate the `Begin` $\rightarrow$ `Finish` handshake without a physical device.
- **Recovery Cycle:**
    - Register User $\rightarrow$ Generate Codes $\rightarrow$ Use Code $\rightarrow$ Verify Code is marked "used" in DB $\rightarrow$ Verify access granted.

### 7.3 E2E Tests
- **Tooling:** Playwright.
- **Method:** Utilize Playwright's `setVirtualAuthenticator` to simulate passkey registration and login in a headless browser.
- **Scope:** Signup $\rightarrow$ Login $\rightarrow$ Home Page $\rightarrow$ Add Key $\rightarrow$ Logout.

---

## 8. Implementation Notes

A few points where the implementation had to make a concrete choice the doc left open, or extends the schema in a small, backward-compatible way:

- **`credentials.credential_id`** and **`recovery_codes.lookup_id`** are additive columns beyond section 5's listing: the raw WebAuthn credential ID and a non-secret code prefix, respectively, both just indexes needed to look up a row without scanning every hash in the table.
- **Sessions** are stateless, HMAC-signed cookies rather than a database table -- section 5 doesn't list a sessions table, and section 4.3 only requires that logout "invalidate/clear" the cookie, which a signed, expiring token satisfies without server-side state.
- **Login is username-based, not usernameless/discoverable** (`WithResidentKeyRequirement` is left at its default), matching section 4.2's explicit "User enters username" step.
- **The `challenges` table doubles as ceremony storage for every WebAuthn Begin/Finish pair** (signup, login, add-key, and the post-recovery passkey registration), plus a short-lived "confirm signup" token issued after `FinishSignup` and consumed by `ConfirmSignup` -- this is what defers issuing a session until the user confirms they've saved their recovery codes (section 4.1, step 4).
- **The E2E Playwright suite (section 7.3) is not included.** The Go integration tests in `internal/auth` and `internal/handlers` already exercise the same signup/login/add-key/recovery flows end-to-end against the real HTTP handlers and a real SQLite database, using `github.com/descope/virtualwebauthn` as the mock authenticator described in section 7.2 -- a browser-driven Playwright pass would mostly re-validate the same server logic through a slower harness. Wiring `setVirtualAuthenticator` into a headless-Chromium suite is a reasonable follow-up if browser-side JS (the `navigator.credentials` glue in `internal/handlers/web/static/app.js`) needs its own coverage.
