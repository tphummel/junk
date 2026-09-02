package handlers

import (
	"embed"
	"html/template"
	"io/fs"
	"net/http"
)

//go:embed web/templates
var templatesFS embed.FS

//go:embed web/static
var staticFilesFS embed.FS

var pageNames = []string{
	"index.html",
	"signup.html",
	"login.html",
	"recovery.html",
	"home.html",
	"keys.html",
	"admin.html",
}

// pages parses each top-level page template together with the shared
// layout, so a page's {{define "content"}} fills the layout's
// {{template "content" .}} slot.
var pages = loadTemplates()

func loadTemplates() map[string]*template.Template {
	out := make(map[string]*template.Template, len(pageNames))
	for _, name := range pageNames {
		out[name] = template.Must(template.New(name).ParseFS(templatesFS,
			"web/templates/layout.html",
			"web/templates/"+name,
		))
	}
	return out
}

func renderPage(w http.ResponseWriter, status int, name string, data any) {
	tmpl, ok := pages[name]
	if !ok {
		http.Error(w, "template not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := tmpl.ExecuteTemplate(w, "layout", data); err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
	}
}

func staticFS() fs.FS {
	sub, err := fs.Sub(staticFilesFS, "web/static")
	if err != nil {
		panic(err)
	}
	return sub
}
