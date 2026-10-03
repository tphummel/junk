package main

import (
	"testing"

	"github.com/godbus/dbus/v5"
)

func TestParseSighting(t *testing.T) {
	props := map[string]dbus.Variant{
		"Address":    dbus.MakeVariant("D1:28:E7:1E:56:09"),
		"Name":       dbus.MakeVariant("nm"),
		"Alias":      dbus.MakeVariant("alias"),
		"RSSI":       dbus.MakeVariant(int16(-62)),
		"TxPower":    dbus.MakeVariant(int16(4)),
		"UUIDs":      dbus.MakeVariant([]string{"0000feaf", "0000180f"}),
		"Appearance": dbus.MakeVariant(uint16(0x00c1)),
		"Modalias":   dbus.MakeVariant("usb:v1D6Bp0246d0540"),
		"AdvertisingData": dbus.MakeVariant(map[byte]dbus.Variant{
			0x09: dbus.MakeVariant([]byte("hi")),
			0x01: dbus.MakeVariant([]byte{0x05}),
		}),
		"AdvertisingFlags": dbus.MakeVariant([]byte{0x05}),
		"ManufacturerData": dbus.MakeVariant(map[uint16]dbus.Variant{
			0x1010: dbus.MakeVariant([]byte{0x11, 0x02}),
			0x004c: dbus.MakeVariant([]byte{0x0c}),
		}),
		"ServiceData": dbus.MakeVariant(map[string]dbus.Variant{
			"0000feaf": dbus.MakeVariant([]byte{0xab}),
		}),
	}
	s, ok := parseSighting(10, props)
	if !ok {
		t.Fatal("not ok")
	}
	if s.AddrType != "random" || s.Name != "nm" || s.Alias != "alias" || *s.RSSI != -62 || *s.TxPower != 4 || *s.ADFlags != 5 {
		t.Errorf("unexpected: %+v", s)
	}
	if s.SvcUUIDs != "0000180f;0000feaf" {
		t.Errorf("uuids %q", s.SvcUUIDs)
	}
	if s.MfrData != "0x004c=0c;0x1010=1102" {
		t.Errorf("mfr %q", s.MfrData)
	}
	if s.MfrID == nil || *s.MfrID != 0x004c || *s.Appearance != 0xc1 || s.Modalias != "usb:v1D6Bp0246d0540" {
		t.Errorf("mfr_id/appearance/modalias: %+v", s)
	}
	if s.RawAD != "0x01=05;0x09=6869" {
		t.Errorf("raw ad %q", s.RawAD)
	}
	if s.SvcData != "0000feaf=ab" {
		t.Errorf("svc %q", s.SvcData)
	}
}

func TestParseSightingMinimal(t *testing.T) {
	if _, ok := parseSighting(1, map[string]dbus.Variant{}); ok {
		t.Fatal("expected !ok without address")
	}
	s, _ := parseSighting(1, map[string]dbus.Variant{"Address": dbus.MakeVariant("18:69:45:76:FE:23")})
	if s.AddrType != "public" || s.RSSI != nil || s.ADFlags != nil {
		t.Errorf("unexpected: %+v", s)
	}
}
