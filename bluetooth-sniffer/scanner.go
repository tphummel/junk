package main

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	bluezService = "org.bluez"
	adapterIface = "org.bluez.Adapter1"
	deviceIface  = "org.bluez.Device1"
	propsIface   = "org.freedesktop.DBus.Properties"
	omIface      = "org.freedesktop.DBus.ObjectManager"
)

// scan runs discovery on adapter and sends a sighting for every Device1
// update until ctx is cancelled. out is closed on return.
func scan(ctx context.Context, adapter dbus.ObjectPath, rawAD bool, out chan<- sighting) error {
	defer close(out)

	conn, err := dbus.SystemBus()
	if err != nil {
		return fmt.Errorf("connect system bus: %w", err)
	}
	ad := conn.Object(bluezService, adapter)

	var addr string
	var powered, discovering bool
	for name, dst := range map[string]any{"Address": &addr, "Powered": &powered, "Discovering": &discovering} {
		v, err := ad.GetProperty(adapterIface + "." + name)
		if err != nil {
			return fmt.Errorf("get adapter %s: %w", name, err)
		}
		if err := v.Store(dst); err != nil {
			return fmt.Errorf("decode adapter %s: %w", name, err)
		}
	}
	log.Printf("adapter %s address=%s powered=%v discovering=%v", adapter, addr, powered, discovering)

	if !powered {
		if err := ad.Call(propsIface+".Set", 0, adapterIface, "Powered", dbus.MakeVariant(true)).Err; err != nil {
			return fmt.Errorf("power on adapter: %w", err)
		}
	}

	// ObjectManager signals come from "/" rather than the adapter path, so
	// match on interface and filter by object path in Go.
	sigs := make(chan *dbus.Signal, 4096)
	conn.Signal(sigs)
	defer conn.RemoveSignal(sigs)
	for _, opts := range [][]dbus.MatchOption{
		{dbus.WithMatchSender(bluezService), dbus.WithMatchInterface(omIface), dbus.WithMatchMember("InterfacesAdded")},
		{dbus.WithMatchSender(bluezService), dbus.WithMatchInterface(omIface), dbus.WithMatchMember("InterfacesRemoved")},
		{dbus.WithMatchSender(bluezService), dbus.WithMatchInterface(propsIface), dbus.WithMatchMember("PropertiesChanged"), dbus.WithMatchPathNamespace(adapter)},
	} {
		if err := conn.AddMatchSignal(opts...); err != nil {
			return fmt.Errorf("add match: %w", err)
		}
	}

	filter := map[string]dbus.Variant{
		"Transport":     dbus.MakeVariant("le"),
		"DuplicateData": dbus.MakeVariant(true),
	}
	if err := ad.Call(adapterIface+".SetDiscoveryFilter", 0, filter).Err; err != nil {
		log.Printf("set discovery filter (continuing): %v", err)
	}
	if err := ad.Call(adapterIface+".StartDiscovery", 0).Err; err != nil {
		return fmt.Errorf("start discovery: %w", err)
	}
	log.Printf("discovery started")
	defer func() {
		if err := ad.Call(adapterIface+".StopDiscovery", 0).Err; err != nil {
			log.Printf("stop discovery: %v", err)
		}
	}()

	prefix := string(adapter) + "/"
	cache := map[dbus.ObjectPath]map[string]dbus.Variant{}

	emit := func(path dbus.ObjectPath, changed string) {
		s, ok := parseSighting(float64(time.Now().UnixNano())/1e9, cache[path])
		if !ok {
			return
		}
		s.Sensor = addr
		s.Changed = changed
		if !rawAD {
			s.RawAD = ""
		}
		select {
		case out <- s:
		case <-ctx.Done():
		}
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case sig := <-sigs:
			if sig == nil {
				return fmt.Errorf("dbus connection closed")
			}
			switch sig.Name {
			case omIface + ".InterfacesAdded":
				path, ifaces, ok := decodeInterfacesAdded(sig.Body)
				if !ok || !strings.HasPrefix(string(path), prefix) {
					continue
				}
				if props, ok := ifaces[deviceIface]; ok {
					cache[path] = props
					emit(path, "added")
				}
			case omIface + ".InterfacesRemoved":
				if len(sig.Body) > 0 {
					if path, ok := sig.Body[0].(dbus.ObjectPath); ok {
						delete(cache, path)
					}
				}
			case propsIface + ".PropertiesChanged":
				if !strings.HasPrefix(string(sig.Path), prefix) || len(sig.Body) < 2 {
					continue
				}
				if iface, _ := sig.Body[0].(string); iface != deviceIface {
					continue
				}
				changed, _ := sig.Body[1].(map[string]dbus.Variant)
				if _, ok := cache[sig.Path]; !ok {
					// Device known to BlueZ before we subscribed: fetch the full set once.
					var all map[string]dbus.Variant
					if err := conn.Object(bluezService, sig.Path).Call(propsIface+".GetAll", 0, deviceIface).Store(&all); err != nil {
						log.Printf("GetAll %s: %v", sig.Path, err)
						continue
					}
					cache[sig.Path] = all
				}
				for k, v := range changed {
					cache[sig.Path][k] = v
				}
				if len(sig.Body) > 2 {
					inval, _ := sig.Body[2].([]string)
					for _, k := range inval {
						delete(cache[sig.Path], k)
					}
				}
				names := make([]string, 0, len(changed))
				for k := range changed {
					names = append(names, k)
				}
				sort.Strings(names)
				emit(sig.Path, strings.Join(names, ";"))
			}
		}
	}
}

func decodeInterfacesAdded(body []any) (dbus.ObjectPath, map[string]map[string]dbus.Variant, bool) {
	if len(body) < 2 {
		return "", nil, false
	}
	path, ok1 := body[0].(dbus.ObjectPath)
	ifaces, ok2 := body[1].(map[string]map[string]dbus.Variant)
	return path, ifaces, ok1 && ok2
}
