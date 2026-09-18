// Package imagegen generates deterministic PNG images from a seed string.
package imagegen

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	mrand "math/rand"
)

// numRectangles is the number of random coloured rectangles drawn on top of
// the white canvas.
const numRectangles = 12

// Generate renders a width x height PNG. A non-empty seed produces a
// deterministic image (same seed and dimensions always produce identical
// bytes); an empty seed produces a genuinely random image on every call.
func Generate(seed string, width, height int) ([]byte, error) {
	rng, err := newRNG(seed)
	if err != nil {
		return nil, err
	}

	img := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)

	for i := 0; i < numRectangles; i++ {
		drawRandomRect(img, rng, width, height)
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// newRNG builds a PRNG seeded deterministically from the SHA-256 hash of
// seed, or from crypto/rand when seed is empty.
func newRNG(seed string) (*mrand.Rand, error) {
	if seed == "" {
		var b [8]byte
		if _, err := rand.Read(b[:]); err != nil {
			return nil, err
		}
		return mrand.New(mrand.NewSource(int64(binary.BigEndian.Uint64(b[:])))), nil
	}
	sum := sha256.Sum256([]byte(seed))
	s := int64(binary.BigEndian.Uint64(sum[:8]))
	return mrand.New(mrand.NewSource(s)), nil
}

func drawRandomRect(img *image.RGBA, rng *mrand.Rand, width, height int) {
	x0 := rng.Intn(width)
	y0 := rng.Intn(height)
	w := 1 + rng.Intn(width/3+1)
	h := 1 + rng.Intn(height/3+1)
	x1 := clamp(x0+w, 0, width)
	y1 := clamp(y0+h, 0, height)

	c := color.RGBA{
		R: uint8(rng.Intn(256)),
		G: uint8(rng.Intn(256)),
		B: uint8(rng.Intn(256)),
		A: 255,
	}

	draw.Draw(img, image.Rect(x0, y0, x1, y1), &image.Uniform{C: c}, image.Point{}, draw.Src)
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
