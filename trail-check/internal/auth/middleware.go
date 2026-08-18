package auth

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

const userIDContextKey = "trailcheck.userID"

// SetSessionCookie writes the signed session JWT cookie. Secure is
// deliberately left off: per the design doc, TLS is terminated externally
// (Caddy or another reverse proxy) and this service only ever sees plain
// HTTP, so marking the cookie Secure would make it un-settable.
func SetSessionCookie(c *gin.Context, token string, ttl time.Duration) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(SessionCookieName, token, int(ttl.Seconds()), "/", "", false, true)
}

// ClearSessionCookie removes the session cookie (logout).
func ClearSessionCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(SessionCookieName, "", -1, "/", "", false, true)
}

// SetChallengeCookie stashes the opaque token for an in-flight WebAuthn
// ceremony. It's cleared as soon as the ceremony finishes (see the finish
// handlers), and expires on its own after challengeTTL regardless.
func SetChallengeCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(challengeCookieName, token, int(challengeTTL.Seconds()), "/", "", false, true)
}

// ChallengeCookie reads and clears the ceremony token cookie.
func ChallengeCookie(c *gin.Context) (string, bool) {
	token, err := c.Cookie(challengeCookieName)
	if err != nil || token == "" {
		return "", false
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(challengeCookieName, "", -1, "/", "", false, true)
	return token, true
}

// RequireAuth verifies the session cookie's JWT signature, then checks the
// backing session row hasn't been revoked or expired, and stashes the
// authenticated user ID in the request context.
func (s *Service) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString, err := c.Cookie(SessionCookieName)
		if err != nil || tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
			return
		}

		claims, err := s.jwt.verify(tokenString)
		if err != nil {
			ClearSessionCookie(c)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
			return
		}

		sess, err := s.db.GetSession(c.Request.Context(), claims.SessionID)
		if err != nil {
			ClearSessionCookie(c)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session not found"})
			return
		}
		if sess.RevokedAt != nil || time.Now().After(sess.ExpiresAt) || sess.UserID != claims.Subject {
			ClearSessionCookie(c)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session expired"})
			return
		}

		_ = s.db.TouchSession(c.Request.Context(), sess.ID)

		c.Set(userIDContextKey, claims.Subject)
		c.Next()
	}
}

// UserID returns the authenticated user's ID from the request context.
// Only valid inside a handler chain behind RequireAuth.
func UserID(c *gin.Context) string {
	v, _ := c.Get(userIDContextKey)
	id, _ := v.(string)
	return id
}
