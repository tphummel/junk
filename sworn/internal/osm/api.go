package osm

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ErrNotConfigured is returned when no OSM_API_KEY is set.
var ErrNotConfigured = errors.New("OSM_API_KEY is not configured")

// Writer pushes changes through OSM API 0.6 using a single app-level key.
// Calls are serialised and spaced at least MinGap apart.
type Writer struct {
	Base      string
	Token     string // never logged
	Hostname  string
	MinGap    time.Duration
	UserAgent string
	HTTP      *http.Client

	mu   sync.Mutex
	last time.Time
}

// NewWriter builds a Writer.
func NewWriter(base, token, hostname, userAgent string, gap time.Duration) *Writer {
	return &Writer{Base: base, Token: token, Hostname: hostname, MinGap: gap, UserAgent: userAgent,
		HTTP: &http.Client{Timeout: 30 * time.Second}}
}

// Configured reports whether writes are possible.
func (w *Writer) Configured() bool { return w != nil && w.Token != "" }

type xTag struct {
	K string `xml:"k,attr"`
	V string `xml:"v,attr"`
}
type xNd struct {
	Ref int64 `xml:"ref,attr"`
}
type xMember struct {
	Type string `xml:"type,attr"`
	Ref  int64  `xml:"ref,attr"`
	Role string `xml:"role,attr"`
}
type xElem struct {
	ID        int64     `xml:"id,attr,omitempty"`
	Version   int64     `xml:"version,attr,omitempty"`
	Changeset int64     `xml:"changeset,attr,omitempty"`
	Lat       *float64  `xml:"lat,attr"`
	Lon       *float64  `xml:"lon,attr"`
	Tags      []xTag    `xml:"tag"`
	Nds       []xNd     `xml:"nd"`
	Members   []xMember `xml:"member"`
}
type xOSM struct {
	XMLName   xml.Name `xml:"osm"`
	Version   string   `xml:"version,attr,omitempty"`
	Generator string   `xml:"generator,attr,omitempty"`
	Nodes     []xElem  `xml:"node"`
	Ways      []xElem  `xml:"way"`
	Relations []xElem  `xml:"relation"`
	Changeset *struct {
		Tags []xTag `xml:"tag"`
	} `xml:"changeset"`
}

// do sends one request honouring the min gap and retrying 429s with exponential backoff.
func (w *Writer) do(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	if !w.Configured() {
		return nil, ErrNotConfigured
	}
	backoff := w.MinGap
	if backoff <= 0 {
		backoff = 10 * time.Millisecond
	}
	for attempt := 0; ; attempt++ {
		w.mu.Lock()
		if wait := w.MinGap - time.Since(w.last); wait > 0 {
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				w.mu.Unlock()
				return nil, ctx.Err()
			}
		}
		req, err := http.NewRequestWithContext(ctx, method, w.Base+path, bytes.NewReader(body))
		if err != nil {
			w.mu.Unlock()
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+w.Token)
		req.Header.Set("User-Agent", w.UserAgent)
		if body != nil {
			req.Header.Set("Content-Type", "text/xml")
		}
		resp, err := w.HTTP.Do(req)
		w.last = time.Now()
		w.mu.Unlock()
		if err != nil {
			return nil, err
		}
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		switch {
		case resp.StatusCode == http.StatusTooManyRequests && attempt < 4:
			select {
			case <-time.After(backoff << attempt):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			return data, nil
		default:
			return nil, fmt.Errorf("osm api %s %s: status %d: %s", method, path, resp.StatusCode, truncate(string(data), 200))
		}
	}
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (w *Writer) openChangeset(ctx context.Context, extra string) (int64, error) {
	comment := fmt.Sprintf("Sworn (%s)", w.Hostname)
	if extra != "" {
		comment += ": " + extra
	}
	x := xOSM{Changeset: &struct {
		Tags []xTag `xml:"tag"`
	}{Tags: []xTag{{"created_by", "Sworn"}, {"comment", comment}}}}
	b, _ := xml.Marshal(x)
	data, err := w.do(ctx, http.MethodPut, "/changeset/create", b)
	if err != nil {
		return 0, err
	}
	id, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("osm api: bad changeset id %q", truncate(string(data), 40))
	}
	return id, nil
}

func (w *Writer) closeChangeset(ctx context.Context, id int64) {
	// Best effort; OSM auto-closes idle changesets.
	_, _ = w.do(ctx, http.MethodPut, fmt.Sprintf("/changeset/%d/close", id), nil)
}

func sortedTags(m map[string]string) []xTag {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	// stable output makes requests testable
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	out := make([]xTag, 0, len(keys))
	for _, k := range keys {
		out = append(out, xTag{k, m[k]})
	}
	return out
}

// CreateNode uploads a new node and returns its id and version (1).
func (w *Writer) CreateNode(ctx context.Context, lat, lon float64, tags map[string]string) (int64, error) {
	cs, err := w.openChangeset(ctx, "add venue")
	if err != nil {
		return 0, err
	}
	defer w.closeChangeset(context.WithoutCancel(ctx), cs)
	x := xOSM{Nodes: []xElem{{Changeset: cs, Lat: &lat, Lon: &lon, Tags: sortedTags(tags)}}}
	b, _ := xml.Marshal(x)
	data, err := w.do(ctx, http.MethodPut, "/node/create", b)
	if err != nil {
		return 0, err
	}
	id, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("osm api: bad node id %q", truncate(string(data), 40))
	}
	return id, nil
}

// UpdateElement applies a Change to the live element and returns the new version.
// The live element is fetched first so concurrent upstream edits to other tags are preserved.
func (w *Writer) UpdateElement(ctx context.Context, typ string, id int64, ch Change) (int64, error) {
	if typ != "node" && typ != "way" && typ != "relation" {
		return 0, fmt.Errorf("bad osm type %q", typ)
	}
	raw, err := w.do(ctx, http.MethodGet, fmt.Sprintf("/%s/%d", typ, id), nil)
	if err != nil {
		return 0, err
	}
	var doc xOSM
	if err := xml.Unmarshal(raw, &doc); err != nil {
		return 0, fmt.Errorf("osm api: bad element xml: %w", err)
	}
	var cur *xElem
	switch typ {
	case "node":
		if len(doc.Nodes) > 0 {
			cur = &doc.Nodes[0]
		}
	case "way":
		if len(doc.Ways) > 0 {
			cur = &doc.Ways[0]
		}
	default:
		if len(doc.Relations) > 0 {
			cur = &doc.Relations[0]
		}
	}
	if cur == nil {
		return 0, ErrNoElement
	}
	tags := map[string]string{}
	for _, t := range cur.Tags {
		tags[t.K] = t.V
	}
	for k, v := range ch.Tags {
		tags[k] = v
	}
	cs, err := w.openChangeset(ctx, "update venue")
	if err != nil {
		return 0, err
	}
	defer w.closeChangeset(context.WithoutCancel(ctx), cs)
	cur.Changeset = cs
	cur.Tags = sortedTags(tags)
	if ch.Moved && typ == "node" {
		lat, lon := ch.Lat, ch.Lon
		cur.Lat, cur.Lon = &lat, &lon
	}
	out := xOSM{}
	switch typ {
	case "node":
		out.Nodes = []xElem{*cur}
	case "way":
		out.Ways = []xElem{*cur}
	default:
		out.Relations = []xElem{*cur}
	}
	b, _ := xml.Marshal(out)
	data, err := w.do(ctx, http.MethodPut, fmt.Sprintf("/%s/%d", typ, id), b)
	if err != nil {
		return 0, err
	}
	v, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("osm api: bad version %q", truncate(string(data), 40))
	}
	return v, nil
}
