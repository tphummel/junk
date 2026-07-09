// wii-journal extracts the Wii Message Board play-history journal
// (game sessions + board messages/milestones) from a raw NAND dump.
// Fully offline: every value comes from data embedded in the NAND
// itself by the console, the same source the Wii's own Message Board
// UI reads from -- no external title database involved.
//
//	wii-journal nand.bin -o journal.csv
//	wii-journal nand.bin -o journal.json --format json
package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
)

const defaultCDBPath = "/title/00000001/00000002/data/cdb.vff"

var csvColumns = []string{
	"type", "date", "game_code", "title_id", "game_name",
	"duration_seconds", "duration_hms", "title", "body",
	"edit_count", "console_id", "vff_path", "block_offset",
}

type row struct {
	Type            string `json:"type"`
	Date            string `json:"date"`
	GameCode        string `json:"game_code,omitempty"`
	TitleID         string `json:"title_id,omitempty"`
	GameName        string `json:"game_name,omitempty"`
	DurationSeconds *int   `json:"duration_seconds,omitempty"`
	DurationHMS     string `json:"duration_hms,omitempty"`
	Title           string `json:"title,omitempty"`
	Body            string `json:"body,omitempty"`
	EditCount       *int   `json:"edit_count,omitempty"`
	ConsoleID       string `json:"console_id,omitempty"`
	VFFPath         string `json:"vff_path,omitempty"`
	BlockOffset     string `json:"block_offset,omitempty"`
}

func fmtHMS(seconds int) string {
	h := seconds / 3600
	m := (seconds % 3600) / 60
	s := seconds % 60
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}

func intPtr(i int) *int { return &i }

type cliArgs struct {
	nandPath string
	output   string
	format   string
	cdbPath  string
	dumpVFF  string
	help     bool
}

func parseArgs(argv []string) (*cliArgs, error) {
	a := &cliArgs{cdbPath: defaultCDBPath}
	var positional []string

	i := 0
	next := func(flagName string) (string, error) {
		i++
		if i >= len(argv) {
			return "", fmt.Errorf("flag %s requires a value", flagName)
		}
		return argv[i], nil
	}

	for ; i < len(argv); i++ {
		arg := argv[i]
		switch arg {
		case "-h", "--help":
			a.help = true
		case "-o", "--output":
			v, err := next(arg)
			if err != nil {
				return nil, err
			}
			a.output = v
		case "-f", "--format":
			v, err := next(arg)
			if err != nil {
				return nil, err
			}
			a.format = v
		case "--cdb-path":
			v, err := next(arg)
			if err != nil {
				return nil, err
			}
			a.cdbPath = v
		case "--dump-vff":
			v, err := next(arg)
			if err != nil {
				return nil, err
			}
			a.dumpVFF = v
		default:
			if strings.HasPrefix(arg, "-") {
				return nil, fmt.Errorf("unknown flag %s", arg)
			}
			positional = append(positional, arg)
		}
	}

	if a.help {
		return a, nil
	}
	if len(positional) != 1 {
		return nil, fmt.Errorf("expected exactly one positional argument (nand.bin), got %d", len(positional))
	}
	a.nandPath = positional[0]

	if a.format == "" {
		if a.output != "" {
			ext := strings.ToLower(a.output)
			if i := strings.LastIndex(ext, "."); i >= 0 {
				ext = ext[i+1:]
			}
			switch ext {
			case "csv", "tsv", "json":
				a.format = ext
			default:
				a.format = "csv"
			}
		} else {
			a.format = "csv"
		}
	}
	if a.format != "csv" && a.format != "tsv" && a.format != "json" {
		return nil, fmt.Errorf("invalid --format %q (want csv, tsv, or json)", a.format)
	}

	return a, nil
}

func printHelp() {
	fmt.Print(`usage: wii-journal [-h] [-o OUTPUT] [-f {csv,tsv,json}] [--cdb-path PATH]
                    [--dump-vff PATH]
                    nand.bin

Extract the Wii Message Board play-history journal from a raw NAND dump.
Fully offline -- game names, title IDs, and console ID all come from
data the console itself embedded in the NAND.

positional arguments:
  nand.bin              path to a raw nand.bin dump (old-BootMii format, 553649152 bytes)

options:
  -h, --help            show this help message and exit
  -o, --output PATH     output file path (default: stdout)
  -f, --format FMT      output format: csv, tsv, or json (default: inferred from --output extension, else csv)
  --cdb-path PATH       VFF path inside the NAND to read (default: ` + defaultCDBPath + `)
  --dump-vff PATH       also write the raw decrypted cdb.vff to PATH, for debugging
`)
}

func loadCDBVFF(nandPath, cdbPath string) ([]byte, error) {
	nand, err := OpenWiiNand(nandPath)
	if err != nil {
		return nil, err
	}
	defer nand.Close()

	fst, err := nand.Find(cdbPath)
	if err != nil {
		return nil, err
	}
	if fst == nil {
		return nil, fmt.Errorf("%s not found in this NAND dump", cdbPath)
	}
	if !fst.isFile() {
		return nil, fmt.Errorf("%s is not a file", cdbPath)
	}
	return nand.GetFileData(fst)
}

func buildRows(v *VFFVolume) []row {
	var rows []row

	for _, e := range parsePlaytimeLogs(v) {
		rows = append(rows, row{
			Type:            "session",
			Date:            e.date.Format("2006-01-02T15:04:05Z"),
			GameCode:        e.gameCode,
			TitleID:         e.titleID,
			GameName:        e.gameName,
			DurationSeconds: intPtr(e.durationSeconds),
			DurationHMS:     fmtHMS(e.durationSeconds),
			ConsoleID:       e.consoleID,
			VFFPath:         e.vffPath,
			BlockOffset:     fmt.Sprintf("0x%x", e.blockOffset),
		})
	}

	for _, r := range extractCDBRecords(v) {
		if r.description != "ripl_board_record" {
			continue
		}
		if r.messageTitle == "" && r.bodyExcerpt == "" {
			continue
		}
		editCount := int(r.editCount)
		rows = append(rows, row{
			Type:      "message",
			Date:      r.date.Format("2006-01-02T15:04:05Z"),
			Title:     r.messageTitle,
			Body:      r.bodyExcerpt,
			EditCount: &editCount,
			ConsoleID: r.consoleID,
			VFFPath:   r.path,
		})
	}

	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Date < rows[j].Date })
	return rows
}

func writeOutput(rows []row, format string, w io.Writer) error {
	if format == "json" {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		enc.SetEscapeHTML(false)
		return enc.Encode(rows)
	}

	delimiter := ','
	if format == "tsv" {
		delimiter = '\t'
	}
	cw := csv.NewWriter(w)
	cw.Comma = delimiter
	if err := cw.Write(csvColumns); err != nil {
		return err
	}
	for _, r := range rows {
		record := []string{
			r.Type, r.Date, r.GameCode, r.TitleID, r.GameName,
			ptrToStr(r.DurationSeconds), r.DurationHMS, r.Title, r.Body,
			ptrToStr(r.EditCount), r.ConsoleID, r.VFFPath, r.BlockOffset,
		}
		if err := cw.Write(record); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

func ptrToStr(p *int) string {
	if p == nil {
		return ""
	}
	return strconv.Itoa(*p)
}

func run(argv []string) int {
	args, err := parseArgs(argv)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	if args.help {
		printHelp()
		return 0
	}

	vffBytes, err := loadCDBVFF(args.nandPath, args.cdbPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error reading NAND dump:", err)
		return 1
	}

	if args.dumpVFF != "" {
		if err := os.WriteFile(args.dumpVFF, vffBytes, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "error writing --dump-vff:", err)
			return 1
		}
	}

	vol, err := ParseVFFVolume(vffBytes)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error parsing cdb.vff:", err)
		return 1
	}

	rows := buildRows(vol)

	if args.output != "" {
		f, err := os.Create(args.output)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error creating output file:", err)
			return 1
		}
		defer f.Close()
		if err := writeOutput(rows, args.format, f); err != nil {
			fmt.Fprintln(os.Stderr, "error writing output:", err)
			return 1
		}
		fmt.Fprintf(os.Stderr, "wrote %d rows to %s\n", len(rows), args.output)
	} else {
		if err := writeOutput(rows, args.format, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, "error writing output:", err)
			return 1
		}
	}

	return 0
}

func main() {
	os.Exit(run(os.Args[1:]))
}
