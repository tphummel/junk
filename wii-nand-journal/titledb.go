package main

// Resolve 4-character Wii game/channel codes to human-readable names using
// GameTDB's plaintext title database (the same source the riiwind project
// itself uses for name resolution).
//
// Source: https://www.gametdb.com/wiitdb.txt?LANG=EN&WIIWARE=1
// (the &WIIWARE=1 flag is required, otherwise system channels like the
// Mii Channel / Wii Shop Channel are omitted from the dump)

import (
	"bufio"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	titleDBURL  = "https://www.gametdb.com/wiitdb.txt?LANG=EN&WIIWARE=1"
	cacheMaxAge = 30 * 24 * time.Hour
)

var titleLineRE = regexp.MustCompile(`^([0-9A-Za-z]{4,6})\s*=\s*(.+?)\r?$`)

type titleVariant struct {
	id   string
	name string
}

type TitleDB struct {
	byID     map[string]string
	byPrefix map[string][]titleVariant
}

func loadTitleDB(path string) (*TitleDB, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	db := &TitleDB{
		byID:     map[string]string{},
		byPrefix: map[string][]titleVariant{},
	}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		m := titleLineRE.FindStringSubmatch(scanner.Text())
		if m == nil {
			continue
		}
		fullID, name := m[1], strings.TrimSpace(m[2])
		db.byID[fullID] = name
		prefix := fullID
		if len(prefix) > 4 {
			prefix = prefix[:4]
		}
		db.byPrefix[prefix] = append(db.byPrefix[prefix], titleVariant{id: fullID, name: name})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return db, nil
}

// Resolve returns (name, confidence, variantCount) for a 4-char game code.
func (db *TitleDB) Resolve(code4 string) (string, string, int) {
	if name, ok := db.byID[code4]; ok {
		return name, "exact_channel_match", 1
	}
	opts := db.byPrefix[code4]
	if len(opts) == 0 {
		return "", "not_found", 0
	}
	var retail []titleVariant
	for _, o := range opts {
		if o.id == code4+"01" {
			retail = append(retail, o)
		}
	}
	if len(retail) > 0 {
		confidence := "retail_01"
		if len(opts) > 1 {
			confidence = "retail_01_ambiguous"
		}
		return retail[0].name, confidence, len(opts)
	}
	// no clean "01" retail id; fall back to the first known variant (often a
	// region-suffixed id like "8P" for PAL) -- flagged as lower confidence
	return opts[0].name, "fallback_variant", len(opts)
}

func defaultCachePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".cache", "wii-nand-journal", "wiitdb.txt")
}

// EnsureTitleDB returns the path to a local wiitdb.txt, downloading/refreshing
// the cache as needed. Pass offline=true to skip entirely (returns "", nil).
func EnsureTitleDB(cachePath string, refresh, offline bool) (string, error) {
	if offline {
		return "", nil
	}
	if cachePath == "" {
		cachePath = defaultCachePath()
	}

	stale := true
	info, statErr := os.Stat(cachePath)
	exists := statErr == nil
	if exists && !refresh {
		stale = time.Since(info.ModTime()) > cacheMaxAge
	}

	if !exists || refresh || stale {
		if err := downloadTitleDB(cachePath); err != nil {
			if exists {
				// network unavailable but we still have a (possibly stale) cache
				return cachePath, nil
			}
			return "", err
		}
	}
	return cachePath, nil
}

func downloadTitleDB(cachePath string) error {
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(titleDBURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &httpStatusError{code: resp.StatusCode}
	}
	tmp := cachePath + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	out.Close()
	return os.Rename(tmp, cachePath)
}

type httpStatusError struct{ code int }

func (e *httpStatusError) Error() string {
	return "unexpected HTTP status downloading wiitdb.txt: " + http.StatusText(e.code)
}
