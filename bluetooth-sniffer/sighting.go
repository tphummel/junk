package main

import (
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/godbus/dbus/v5"
)

// sighting is one observation of an advertiser, flattened from the BlueZ
// org.bluez.Device1 properties.
type sighting struct {
	TS         float64
	Addr       string
	AddrType   string // "public" | "random"
	Name       string
	Alias      string
	Sensor     string // local adapter address; set by the scanner
	Changed    string // properties in this update; set by the scanner
	MfrID      *int
	Appearance *int
	Modalias   string
	RawAD      string // hex of AdvertisingData by AD type; set only with -raw-ad
	RSSI       *int
	SvcUUIDs   string
	MfrData    string
	SvcData    string
	TxPower    *int
	ADFlags    *int // raw AD Flags byte (BlueZ AdvertisingFlags[0]), nil if absent
}

// parseSighting converts Device1 properties into a sighting. ok is false when
// the properties carry no address.
func parseSighting(ts float64, props map[string]dbus.Variant) (s sighting, ok bool) {
	addr, _ := getVal[string](props, "Address")
	if addr == "" {
		return s, false
	}
	s.TS = ts
	s.Addr = addr

	s.AddrType, _ = getVal[string](props, "AddressType")
	if s.AddrType != "public" && s.AddrType != "random" {
		s.AddrType = deriveAddrType(addr)
	}

	s.Name, _ = getVal[string](props, "Name")
	s.Alias, _ = getVal[string](props, "Alias")

	if v, ok := getVal[int16](props, "RSSI"); ok {
		r := int(v)
		s.RSSI = &r
	}
	if v, ok := getVal[int16](props, "TxPower"); ok {
		t := int(v)
		s.TxPower = &t
	}

	if uuids, ok := getVal[[]string](props, "UUIDs"); ok {
		u := append([]string(nil), uuids...)
		sort.Strings(u)
		s.SvcUUIDs = strings.Join(u, ";")
	}

	if v, ok := getVal[uint16](props, "Appearance"); ok {
		a := int(v)
		s.Appearance = &a
	}
	s.Modalias, _ = getVal[string](props, "Modalias")

	if m, ok := getVal[map[byte]dbus.Variant](props, "AdvertisingData"); ok {
		keys := make([]int, 0, len(m))
		for k := range m {
			keys = append(keys, int(k))
		}
		sort.Ints(keys)
		parts := make([]string, 0, len(m))
		for _, k := range keys {
			b, _ := m[byte(k)].Value().([]byte)
			parts = append(parts, fmt.Sprintf("0x%02x=%s", k, hex.EncodeToString(b)))
		}
		s.RawAD = strings.Join(parts, ";")
	}

	if m, ok := getVal[map[uint16]dbus.Variant](props, "ManufacturerData"); ok {
		parts := make([]string, 0, len(m))
		keys := make([]int, 0, len(m))
		for k := range m {
			keys = append(keys, int(k))
		}
		sort.Ints(keys)
		if len(keys) > 0 {
			id := keys[0]
			s.MfrID = &id
		}
		for _, k := range keys {
			b, _ := m[uint16(k)].Value().([]byte)
			parts = append(parts, fmt.Sprintf("0x%04x=%s", k, hex.EncodeToString(b)))
		}
		s.MfrData = strings.Join(parts, ";")
	}

	if m, ok := getVal[map[string]dbus.Variant](props, "ServiceData"); ok {
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(m))
		for _, k := range keys {
			b, _ := m[k].Value().([]byte)
			parts = append(parts, k+"="+hex.EncodeToString(b))
		}
		s.SvcData = strings.Join(parts, ";")
	}

	if flags, ok := getVal[[]byte](props, "AdvertisingFlags"); ok && len(flags) > 0 {
		f := int(flags[0])
		s.ADFlags = &f
	}
	return s, true
}

// deriveAddrType classifies by the two top bits of the first address byte:
// 0b11 means random static.
func deriveAddrType(addr string) string {
	first, _, _ := strings.Cut(addr, ":")
	b, err := strconv.ParseUint(first, 16, 8)
	if err == nil && b&0xC0 == 0xC0 {
		return "random"
	}
	return "public"
}

func getVal[T any](props map[string]dbus.Variant, key string) (T, bool) {
	var zero T
	v, ok := props[key]
	if !ok {
		return zero, false
	}
	t, ok := v.Value().(T)
	return t, ok
}
