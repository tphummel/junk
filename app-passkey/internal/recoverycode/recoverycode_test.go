package recoverycode

import (
	"strings"
	"testing"
)

func TestGenerateProducesUniqueCodes(t *testing.T) {
	codes, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if len(codes) != Count {
		t.Fatalf("expected %d codes, got %d", Count, len(codes))
	}

	seen := make(map[string]bool)
	for _, c := range codes {
		if seen[c.Display] {
			t.Fatalf("duplicate code generated: %s", c.Display)
		}
		seen[c.Display] = true

		if !strings.Contains(c.Display, "-") {
			t.Fatalf("expected display code to contain a separator, got %q", c.Display)
		}
		if !strings.HasPrefix(c.Display, c.LookupID+"-") {
			t.Fatalf("expected display %q to start with lookup id %q", c.Display, c.LookupID)
		}
	}
}

func TestHashAndVerifyRoundTrip(t *testing.T) {
	codes, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	c := codes[0]

	lookupID, secret, err := Split(c.Display)
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	if lookupID != c.LookupID {
		t.Fatalf("expected lookup id %q, got %q", c.LookupID, lookupID)
	}

	if !Verify(secret, c.Hash) {
		t.Fatal("expected the correct secret to verify")
	}
	if Verify("wrong-secret", c.Hash) {
		t.Fatal("expected an incorrect secret to fail verification")
	}
}

func TestVerifyRejectsTamperedHash(t *testing.T) {
	codes, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	c := codes[0]
	_, secret, err := Split(c.Display)
	if err != nil {
		t.Fatal(err)
	}

	tampered := append([]byte(nil), c.Hash...)
	tampered[len(tampered)-1] ^= 0xFF
	if Verify(secret, tampered) {
		t.Fatal("expected a tampered hash to fail verification")
	}
}

func TestSplitRejectsMalformedInput(t *testing.T) {
	invalid := []string{"", "justtext", "-onlysecret", "onlylookup-"}
	for _, in := range invalid {
		if _, _, err := Split(in); err != ErrMalformed {
			t.Errorf("Split(%q): expected ErrMalformed, got %v", in, err)
		}
	}

	lookupID, secret, err := Split("abc-def")
	if err != nil {
		t.Fatalf("Split(\"abc-def\"): unexpected error %v", err)
	}
	if lookupID != "abc" || secret != "def" {
		t.Errorf("Split(\"abc-def\"): got (%q, %q)", lookupID, secret)
	}
}
