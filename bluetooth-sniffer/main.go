// bluetooth-sniffer passively logs BLE advertisements seen by a BlueZ adapter
// into SQLite.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/godbus/dbus/v5"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	if len(os.Args) > 1 && os.Args[1] == "purge" {
		if err := purgeCmd(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if err := runCmd(os.Args[1:]); err != nil {
		log.Fatal(err)
	}
}

func runCmd(args []string) error {
	fs := flag.NewFlagSet("bluetooth-sniffer", flag.ExitOnError)
	adapter := fs.String("adapter", "/org/bluez/hci0", "BlueZ adapter D-Bus path")
	dbPath := fs.String("db", "/opt/bluetooth-sniffer/sniffer.db", "SQLite database path")
	flushMS := fs.Int("flush-ms", 1000, "flush interval in milliseconds")
	flushRows := fs.Int("flush-rows", 500, "flush once this many rows are buffered")
	minInterval := fs.Duration("min-interval", 10*time.Second, "record RSSI/data-only updates for a device at most this often (0 = every update)")
	rawAD := fs.Bool("raw-ad", false, "store raw AdvertisingData (requires bluetoothd --experimental)")
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "usage: bluetooth-sniffer [flags]\n       bluetooth-sniffer purge [flags]\n\n")
		fs.PrintDefaults()
	}
	fs.Parse(args)

	st, err := openStore(*dbPath)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	sightings := make(chan sighting, 4096)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runWriter(ctx, st, sightings, time.Duration(*flushMS)*time.Millisecond, *flushRows)
	}()

	err = scan(ctx, dbus.ObjectPath(*adapter), *rawAD, *minInterval, sightings)
	<-done // scan closed the channel; writer has done its final flush
	return err
}

func purgeCmd(args []string) error {
	fs := flag.NewFlagSet("purge", flag.ExitOnError)
	dbPath := fs.String("db", "/opt/bluetooth-sniffer/sniffer.db", "SQLite database path")
	keep := fs.Int("keep-days", 14, "delete events older than this many days")
	vacuum := fs.Bool("vacuum", false, "run VACUUM after deleting")
	fs.Parse(args)

	st, err := openStore(*dbPath)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer st.Close()
	n, err := st.Purge(time.Now(), *keep, *vacuum)
	if err != nil {
		return err
	}
	log.Printf("purged %d events older than %d days (vacuum=%v)", n, *keep, *vacuum)
	return nil
}
