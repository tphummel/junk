package imagegen

import (
	"bytes"
	"image/png"
	"testing"
)

func TestGenerateDeterministic(t *testing.T) {
	a, err := Generate("hello", 100, 100)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	b, err := Generate("hello", 100, 100)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if !bytes.Equal(a, b) {
		t.Fatal("same seed produced different PNG bytes")
	}
}

func TestGenerateDifferentSeedsDiffer(t *testing.T) {
	a, err := Generate("hello", 100, 100)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	b, err := Generate("world", 100, 100)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if bytes.Equal(a, b) {
		t.Fatal("different seeds produced identical PNG bytes")
	}
}

func TestGenerateEmptySeedIsRandom(t *testing.T) {
	a, err := Generate("", 100, 100)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	b, err := Generate("", 100, 100)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if bytes.Equal(a, b) {
		t.Fatal("empty seed produced identical PNG bytes twice; expected true randomness")
	}
}

func TestGenerateValidPNG(t *testing.T) {
	data, err := Generate("seed", 64, 32)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode PNG: %v", err)
	}
	bounds := img.Bounds()
	if bounds.Dx() != 64 || bounds.Dy() != 32 {
		t.Fatalf("got %dx%d image, want 64x32", bounds.Dx(), bounds.Dy())
	}
}
