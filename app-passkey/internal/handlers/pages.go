package handlers

import (
	"net/http"

	"app-passkey/internal/auth"
)

type basePage struct {
	Authenticated bool
}

func (h *Handler) handleIndex(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := h.Auth.Authenticate(r); ok {
		http.Redirect(w, r, "/home", http.StatusFound)
		return
	}
	renderPage(w, http.StatusOK, "index.html", basePage{})
}

func (h *Handler) handleSignupPage(w http.ResponseWriter, r *http.Request) {
	renderPage(w, http.StatusOK, "signup.html", basePage{})
}

func (h *Handler) handleLoginPage(w http.ResponseWriter, r *http.Request) {
	renderPage(w, http.StatusOK, "login.html", basePage{})
}

func (h *Handler) handleRecoveryPage(w http.ResponseWriter, r *http.Request) {
	renderPage(w, http.StatusOK, "recovery.html", basePage{})
}

type homePageData struct {
	basePage
	Username string
}

// handleHomePage is the design doc's protected "You are logged in" page.
func (h *Handler) handleHomePage(w http.ResponseWriter, r *http.Request) {
	renderPage(w, http.StatusOK, "home.html", homePageData{
		basePage: basePage{Authenticated: true},
		Username: auth.Username(r),
	})
}

type keysPageData struct {
	basePage
	Username string
}

func (h *Handler) handleKeysPage(w http.ResponseWriter, r *http.Request) {
	renderPage(w, http.StatusOK, "keys.html", keysPageData{
		basePage: basePage{Authenticated: true},
		Username: auth.Username(r),
	})
}

type adminUserRow struct {
	Username        string
	CredentialCount int
	CreatedAt       string
}

type adminPageData struct {
	basePage
	Users []adminUserRow
}

// handleAdminPage is the design doc's protected admin view of all users,
// their registered key counts, and account creation dates.
func (h *Handler) handleAdminPage(w http.ResponseWriter, r *http.Request) {
	summaries, err := h.Auth.ListUsersForAdmin(r.Context())
	if err != nil {
		h.Logger.Error("list users for admin", "error", err)
		http.Error(w, "could not load users", http.StatusInternalServerError)
		return
	}
	rows := make([]adminUserRow, 0, len(summaries))
	for _, s := range summaries {
		rows = append(rows, adminUserRow{
			Username:        s.Username,
			CredentialCount: s.CredentialCount,
			CreatedAt:       s.CreatedAt.Format("2006-01-02 15:04 MST"),
		})
	}
	renderPage(w, http.StatusOK, "admin.html", adminPageData{
		basePage: basePage{Authenticated: true},
		Users:    rows,
	})
}
