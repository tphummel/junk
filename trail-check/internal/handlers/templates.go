package handlers

import (
	"embed"
	"html/template"
	"io/fs"
	"net/http"

	"github.com/gin-gonic/gin"
)

//go:embed all:web/templates
var templatesFS embed.FS

//go:embed all:web/static
var staticFSEmbed embed.FS

type templates struct {
	pages map[string]*template.Template
}

// loadTemplates parses each top-level page template together with the
// shared layout and partials, so {{define "content"}} in a page fills the
// layout's {{template "content" .}} slot.
func loadTemplates() *templates {
	pages := []string{
		"index.html",
		"register.html",
		"login.html",
		"dashboard.html",
		"catalog_list.html",
		"passkeys.html",
	}

	t := &templates{pages: make(map[string]*template.Template)}
	for _, page := range pages {
		tmpl := template.Must(template.New(page).Funcs(templateFuncs).ParseFS(templatesFS,
			"web/templates/layout.html",
			"web/templates/partials/*.html",
			"web/templates/"+page,
		))
		t.pages[page] = tmpl
	}
	return t
}

var templateFuncs = template.FuncMap{
	"divf": func(a, b float64) float64 {
		if b == 0 {
			return 0
		}
		return a / b
	},
}

func (t *templates) render(c *gin.Context, status int, page string, data any) {
	tmpl, ok := t.pages[page]
	if !ok {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	c.Status(status)
	c.Header("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.ExecuteTemplate(c.Writer, "layout", data); err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
	}
}

// renderPartial renders a single named partial template directly (used for
// Turbo Frame / Turbo Stream fragment responses, which must not include the
// full page layout).
func (t *templates) renderPartial(c *gin.Context, status int, name string, data any) {
	tmpl := template.Must(template.New(name).Funcs(templateFuncs).ParseFS(templatesFS, "web/templates/partials/*.html"))
	c.Status(status)
	c.Header("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.ExecuteTemplate(c.Writer, name, data); err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
	}
}

// renderStream renders a named partial as a Turbo Stream response.
func (t *templates) renderStream(c *gin.Context, name string, data any) {
	tmpl := template.Must(template.New(name).Funcs(templateFuncs).ParseFS(templatesFS, "web/templates/partials/*.html"))
	c.Status(http.StatusOK)
	c.Header("Content-Type", "text/vnd.turbo-stream.html; charset=utf-8")
	if err := tmpl.ExecuteTemplate(c.Writer, name, data); err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
	}
}

func staticFS() http.FileSystem {
	sub, err := fs.Sub(staticFSEmbed, "web/static")
	if err != nil {
		panic(err)
	}
	return http.FS(sub)
}
