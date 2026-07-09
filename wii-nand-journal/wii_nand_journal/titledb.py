"""
Resolve 4-character Wii game/channel codes to human-readable names using
GameTDB's plaintext title database (the same source the riiwind project
itself uses for name resolution).

Source: https://www.gametdb.com/wiitdb.txt?LANG=EN&WIIWARE=1
(the &WIIWARE=1 flag is required, otherwise system channels like the
Mii Channel / Wii Shop Channel are omitted from the dump)
"""
import os
import re
import time
import urllib.request
from collections import defaultdict

TITLEDB_URL = "https://www.gametdb.com/wiitdb.txt?LANG=EN&WIIWARE=1"
DEFAULT_CACHE_PATH = os.path.expanduser("~/.cache/wii-nand-journal/wiitdb.txt")
CACHE_MAX_AGE_SECONDS = 30 * 24 * 3600  # 30 days

_LINE_RE = re.compile(r"^([0-9A-Za-z]{4,6})\s*=\s*(.+?)\r?$")


class TitleDB:
    """Maps 4-char game codes to a best-guess name, with a confidence note."""

    def __init__(self, path):
        self.by_id = {}  # full id (4 or 6 char) -> name
        self.by_prefix = defaultdict(list)  # 4-char code -> [(full_id, name), ...]
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                m = _LINE_RE.match(line.rstrip("\n"))
                if not m:
                    continue
                full_id, name = m.group(1), m.group(2).strip()
                self.by_id[full_id] = name
                self.by_prefix[full_id[:4]].append((full_id, name))

    def resolve(self, code4):
        """Return (name_or_None, confidence, variant_count)."""
        if code4 in self.by_id:
            return self.by_id[code4], "exact_channel_match", 1
        opts = self.by_prefix.get(code4, [])
        if not opts:
            return None, "not_found", 0
        retail = [o for o in opts if o[0] == code4 + "01"]
        if retail:
            confidence = "retail_01" if len(opts) == 1 else "retail_01_ambiguous"
            return retail[0][1], confidence, len(opts)
        # no clean "01" retail id; fall back to first known variant (often a
        # region-suffixed id like "8P" for PAL) — flagged as lower confidence
        return opts[0][1], "fallback_variant", len(opts)


def ensure_titledb(cache_path=None, refresh=False, offline=False):
    """Return path to a local wiitdb.txt, downloading/refreshing the cache as needed."""
    if offline:
        return None
    cache_path = cache_path or DEFAULT_CACHE_PATH
    stale = True
    if os.path.exists(cache_path) and not refresh:
        age = time.time() - os.path.getmtime(cache_path)
        stale = age > CACHE_MAX_AGE_SECONDS
    if not os.path.exists(cache_path) or refresh or stale:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        try:
            with urllib.request.urlopen(TITLEDB_URL, timeout=30) as resp:
                data = resp.read()
            with open(cache_path, "wb") as fh:
                fh.write(data)
        except Exception:
            if os.path.exists(cache_path):
                # network unavailable but we still have a (possibly stale) cache
                return cache_path
            raise
    return cache_path
