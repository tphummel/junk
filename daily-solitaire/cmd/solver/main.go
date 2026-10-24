// Command solver proves Klondike deals winnable, offline. It searches a range
// of seeds in parallel and writes one JSON line per winnable seed:
//
//	{"seed":"0000000000000001","moves":"D mt3>t5:7H ..."}
//
// The output is the seed pool (load it with `admin load-seeds`) and, for a
// handful of seeds, the golden replay fixtures under internal/klondike/testdata.
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"

	"daily-solitaire/internal/klondike"
)

// Line is one solved seed.
type Line struct {
	Seed  string `json:"seed"`
	Moves string `json:"moves"`
	// Key is the sha256 of the final position's canonical key; only written
	// with -fixtures.
	Key string `json:"key,omitempty"`
}

func main() {
	var (
		from     = flag.Uint64("from", 1, "first seed to try")
		count    = flag.Int("count", 100, "number of consecutive seeds to try")
		random   = flag.Bool("random", false, "try random seeds instead of a consecutive range (use for the production pool)")
		want     = flag.Int("want", 0, "stop after this many winnable seeds (0 = try all)")
		nodes    = flag.Int("nodes", 300000, "search budget per seed, in positions")
		workers  = flag.Int("workers", runtime.NumCPU(), "parallel workers")
		out      = flag.String("out", "-", "output file (- for stdout)")
		fixtures = flag.Bool("fixtures", false, "include the final-position key for golden fixtures")
	)
	flag.Parse()

	w := os.Stdout
	if *out != "-" {
		f, err := os.Create(*out)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		defer f.Close()
		w = f
	}
	bw := bufio.NewWriter(w)
	defer bw.Flush()
	enc := json.NewEncoder(bw)
	enc.SetEscapeHTML(false)

	seeds := make(chan uint64)
	go func() {
		defer close(seeds)
		if *random {
			for {
				seeds <- randomSeed()
			}
		}
		for i := 0; i < *count; i++ {
			seeds <- *from + uint64(i)
		}
	}()

	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		tried   int
		solved  int
		started = time.Now()
		done    = make(chan struct{})
		once    sync.Once
	)
	for i := 0; i < *workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for seed := range seeds {
				select {
				case <-done:
					return
				default:
				}
				rules := klondike.DefaultRuleset()
				moves, ok := klondike.Solve(seed, rules, *nodes)
				var line *Line
				if ok {
					st, err := klondike.Replay(seed, rules, moves)
					if err != nil || !st.Won() {
						fmt.Fprintf(os.Stderr, "seed %x: solver produced an invalid solution: %v\n", seed, err)
						ok = false
					} else {
						line = &Line{Seed: klondike.FormatSeed(seed), Moves: klondike.FormatMoves(moves)}
						if *fixtures {
							line.Key = KeyHash(st)
						}
					}
				}
				mu.Lock()
				tried++
				if ok {
					solved++
					_ = enc.Encode(line)
					if *want > 0 && solved >= *want {
						once.Do(func() { close(done) })
					}
				}
				if tried%25 == 0 {
					fmt.Fprintf(os.Stderr, "tried %d, winnable %d (%.0f%%), %s\n", tried, solved, 100*float64(solved)/float64(tried), time.Since(started).Round(time.Second))
				}
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	fmt.Fprintf(os.Stderr, "done: tried %d, winnable %d\n", tried, solved)
}

// KeyHash fingerprints a final position.
func KeyHash(s *klondike.State) string {
	sum := sha256.Sum256([]byte(s.Key()))
	return hex.EncodeToString(sum[:8])
}
