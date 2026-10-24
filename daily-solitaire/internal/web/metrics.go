package web

import (
	"fmt"
	"io"
	"sort"
	"strconv"
	"sync"
)

// Metrics is a tiny Prometheus text-format registry: counters with at most
// one label, plus gauges supplied by callbacks at scrape time.
type Metrics struct {
	mu       sync.Mutex
	counters map[string]map[string]float64 // name -> label value -> count
	help     map[string]string
	labels   map[string]string
	gauges   []gauge
}

type gauge struct {
	name, help string
	fn         func() float64
}

// NewMetrics creates the registry with the app's counters declared.
func NewMetrics() *Metrics {
	m := &Metrics{counters: map[string]map[string]float64{}, help: map[string]string{}, labels: map[string]string{}}
	m.declare("dailysolitaire_http_requests_total", "code", "HTTP requests by status code.")
	m.declare("dailysolitaire_moves_total", "type", "Accepted game actions by type.")
	m.declare("dailysolitaire_games_started_total", "", "Games started.")
	m.declare("dailysolitaire_games_finished_total", "result", "Games finished by result.")
	m.declare("dailysolitaire_logins_total", "method", "Successful sign-ins by method.")
	m.declare("dailysolitaire_rejected_moves_total", "reason", "Rejected move requests by reason.")
	return m
}

func (m *Metrics) declare(name, label, help string) {
	m.counters[name] = map[string]float64{}
	m.help[name] = help
	m.labels[name] = label
}

// Inc adds one to a counter; value is the label value ("" for unlabelled counters).
func (m *Metrics) Inc(name, value string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if c, ok := m.counters[name]; ok {
		c[value]++
	}
}

// Request counts one HTTP response.
func (m *Metrics) Request(code int) { m.Inc("dailysolitaire_http_requests_total", strconv.Itoa(code)) }

// AddGauge registers a value computed at scrape time.
func (m *Metrics) AddGauge(name, help string, fn func() float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.gauges = append(m.gauges, gauge{name, help, fn})
}

// Write renders the registry in the Prometheus text exposition format.
func (m *Metrics) Write(w io.Writer) {
	m.mu.Lock()
	defer m.mu.Unlock()
	names := make([]string, 0, len(m.counters))
	for n := range m.counters {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n", n, m.help[n], n)
		vals := make([]string, 0, len(m.counters[n]))
		for v := range m.counters[n] {
			vals = append(vals, v)
		}
		sort.Strings(vals)
		if len(vals) == 0 && m.labels[n] == "" {
			fmt.Fprintf(w, "%s 0\n", n)
		}
		for _, v := range vals {
			if m.labels[n] == "" {
				fmt.Fprintf(w, "%s %g\n", n, m.counters[n][v])
			} else {
				fmt.Fprintf(w, "%s{%s=%q} %g\n", n, m.labels[n], v, m.counters[n][v])
			}
		}
	}
	for _, g := range m.gauges {
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s gauge\n%s %g\n", g.name, g.help, g.name, g.name, g.fn())
	}
}
