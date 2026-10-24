package web

import (
	"crypto/sha256"
	"fmt"
	"html/template"
	"strings"
)

// avatarSVG draws a deterministic 5x5 symmetric identicon from a user id.
func avatarSVG(id string) template.HTML {
	sum := sha256.Sum256([]byte(id))
	hue := int(sum[0])*360/256 + 0
	var b strings.Builder
	fmt.Fprintf(&b, `<svg class="avatar" viewBox="0 0 5 5" role="img" aria-hidden="true" style="--h:%d">`, hue)
	for y := 0; y < 5; y++ {
		for x := 0; x < 3; x++ {
			if sum[1+y*3+x]&1 == 0 {
				continue
			}
			fmt.Fprintf(&b, `<rect x="%d" y="%d" width="1" height="1"/>`, x, y)
			if x < 2 {
				fmt.Fprintf(&b, `<rect x="%d" y="%d" width="1" height="1"/>`, 4-x, y)
			}
		}
	}
	b.WriteString(`</svg>`)
	return template.HTML(b.String())
}

// knownAuthenticators maps AAGUIDs of common passkey providers to a name.
var knownAuthenticators = map[string]string{
	"fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
	"ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
	"adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
	"08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
	"9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
	"6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
	"bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
	"d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
	"531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
	"fdb141b2-5d84-443e-8a35-4698c205a502": "KeePassXC",
	"ee882879-721c-4913-9775-3dfcce97072a": "YubiKey 5",
}

func aaguidName(aaguid string) string {
	if n, ok := knownAuthenticators[aaguid]; ok {
		return n
	}
	return "Passkey"
}

// deviceName summarises a user-agent string as "Browser on OS".
func deviceName(ua string) string {
	browser := "Browser"
	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/"):
		browser = "Opera"
	case strings.Contains(ua, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "Chrome/") || strings.Contains(ua, "CriOS/"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	osName := "unknown device"
	switch {
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"):
		osName = "iOS"
	case strings.Contains(ua, "Android"):
		osName = "Android"
	case strings.Contains(ua, "Mac OS X"):
		osName = "macOS"
	case strings.Contains(ua, "Windows"):
		osName = "Windows"
	case strings.Contains(ua, "CrOS"):
		osName = "ChromeOS"
	case strings.Contains(ua, "Linux"):
		osName = "Linux"
	}
	return browser + " on " + osName
}

func eventLabel(e string) string {
	switch e {
	case "signup":
		return "Account created"
	case "signin":
		return "Signed in"
	case "stepup":
		return "Identity re-verified"
	case "recovery":
		return "Signed in by recovery"
	case "passkey_added":
		return "Passkey added"
	case "passkey_renamed":
		return "Passkey renamed"
	case "passkey_revoked":
		return "Passkey revoked"
	case "recovery_codes":
		return "Recovery codes regenerated"
	case "session_revoked":
		return "Session ended"
	case "sessions_revoked":
		return "Signed out everywhere"
	case "export":
		return "Archive exported"
	case "profile":
		return "Profile updated"
	}
	return e
}
