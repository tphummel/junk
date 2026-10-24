// Command admin is the operator's tool. It works directly on the SQLite file,
// so run it on the host (or `docker exec`) with the same DATABASE_PATH.
//
//	admin list-users
//	admin create-user <username> [display name]   (prints a one-time sign-in link)
//	admin recovery-link <username>                (prints a one-time recovery link)
//	admin disable-user <username>
//	admin enable-user <username>
//	admin load-seeds <seeds.jsonl>                (load the offline solver's output)
//	admin pool                                    (seed pool size)
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"daily-solitaire/internal/config"
	"daily-solitaire/internal/klondike"
	"daily-solitaire/internal/store"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cfg := config.Load()
	st, err := store.Open(cfg.DatabasePath)
	if err != nil {
		fatal(err)
	}
	defer st.Close()
	if err := run(context.Background(), st, cfg, os.Args[1], os.Args[2:]); err != nil {
		fatal(err)
	}
}

func run(ctx context.Context, st *store.Store, cfg *config.Config, cmd string, args []string) error {
	switch cmd {
	case "list-users":
		users, err := st.ListUsers(ctx)
		if err != nil {
			return err
		}
		for _, u := range users {
			status := "active"
			if u.Disabled() {
				status = "disabled"
			}
			creds, _ := st.CredentialsForUser(ctx, u.ID)
			fmt.Printf("%-24s %-9s passkeys=%d created=%s\n", u.Username, status, len(creds), u.CreatedAt.Format("2006-01-02"))
		}
		return nil

	case "create-user":
		if len(args) < 1 {
			usage()
		}
		name := strings.ToLower(args[0])
		display := name
		if len(args) > 1 {
			display = strings.Join(args[1:], " ")
		}
		u, err := st.CreateUser(ctx, name, display)
		if err != nil {
			return err
		}
		st.Audit(ctx, u.ID, "signup", "account created by admin")
		return printLink(ctx, st, cfg, u, 7*24*time.Hour)

	case "recovery-link":
		u, err := userArg(ctx, st, args)
		if err != nil {
			return err
		}
		st.Audit(ctx, u.ID, "recovery", "admin issued a recovery link")
		return printLink(ctx, st, cfg, u, time.Hour)

	case "disable-user", "enable-user":
		u, err := userArg(ctx, st, args)
		if err != nil {
			return err
		}
		if err := st.SetDisabled(ctx, u.ID, cmd == "disable-user"); err != nil {
			return err
		}
		fmt.Printf("%s: %s\n", u.Username, strings.TrimSuffix(cmd, "-user")+"d")
		return nil

	case "load-seeds":
		if len(args) < 1 {
			usage()
		}
		return loadSeeds(ctx, st, args[0])

	case "pool":
		total, unused, err := st.SeedPoolStats(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("seed pool: %d total, %d unused\n", total, unused)
		return nil
	}
	usage()
	return nil
}

func userArg(ctx context.Context, st *store.Store, args []string) (*store.User, error) {
	if len(args) < 1 {
		usage()
	}
	u, err := st.UserByUsername(ctx, strings.ToLower(args[0]))
	if errors.Is(err, store.ErrNotFound) {
		return nil, fmt.Errorf("no such user %q", args[0])
	}
	return u, err
}

func printLink(ctx context.Context, st *store.Store, cfg *config.Config, u *store.User, ttl time.Duration) error {
	token, err := st.NewRecoveryLink(ctx, u.ID, ttl)
	if err != nil {
		return err
	}
	fmt.Printf("%s\n  single-use link, valid for %s:\n  %s/recover/link?token=%s\n", u.Username, ttl, cfg.BaseURL, token)
	return nil
}

// loadSeeds reads the solver's JSONL output, re-verifies every solution with
// the engine, and adds the seeds to the pool.
func loadSeeds(ctx context.Context, st *store.Store, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	seeds := map[uint64]string{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	line := 0
	for sc.Scan() {
		line++
		if strings.TrimSpace(sc.Text()) == "" {
			continue
		}
		var rec struct {
			Seed  string `json:"seed"`
			Moves string `json:"moves"`
		}
		if err := json.Unmarshal(sc.Bytes(), &rec); err != nil {
			return fmt.Errorf("line %d: %w", line, err)
		}
		seed, err := klondike.ParseSeed(rec.Seed)
		if err != nil {
			return fmt.Errorf("line %d: %w", line, err)
		}
		moves, err := klondike.ParseMoves(rec.Moves)
		if err != nil {
			return fmt.Errorf("line %d: %w", line, err)
		}
		state, err := klondike.Replay(seed, klondike.DefaultRuleset(), moves)
		if err != nil || !state.Won() {
			return fmt.Errorf("line %d: seed %s: solution does not win (%v)", line, rec.Seed, err)
		}
		seeds[seed] = rec.Moves
	}
	if err := sc.Err(); err != nil {
		return err
	}
	added, err := st.LoadSeeds(ctx, seeds)
	if err != nil {
		return err
	}
	fmt.Printf("verified %d solutions, added %d new seeds\n", len(seeds), added)
	return nil
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: admin <list-users | create-user <name> [display] | recovery-link <name> | disable-user <name> | enable-user <name> | load-seeds <file> | pool>")
	os.Exit(2)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}
