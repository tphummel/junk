"""
Python port of riiwind's VFF / CDBFILE / playtime-log parser
(https://github.com/DeekyJay/riiwind), for parsing a Wii Message Board
cdb.vff extracted from a decrypted NAND dump.

A VFF ("Virtual FAT Filesystem") is a small FAT12/16 container the Wii
system software uses for WC24/message-board data. Inside it, message
board entries and playtime logs are stored as "CDBFILE" records (see
Naim2000/cdbackup's cdbfile.h for the on-disk struct this is based on).
"""
import struct
import datetime

WII_EPOCH_OFFSET = 946684800  # seconds between 1970-01-01 and 2000-01-01
WII_TICK_RATE = 60_750_000  # Wii bus clock (243 MHz) / 4


def wii_ts_to_dt(wii_ts):
    return datetime.datetime.fromtimestamp(
        wii_ts + WII_EPOCH_OFFSET, tz=datetime.timezone.utc
    )


def align_up(value, alignment):
    return -(-value // alignment) * alignment


class VFFError(Exception):
    pass


class VFFLayout:
    HEADER_SIZE = 0x20
    ROOT_DIR_ENTRIES = 128
    DIRENT_SIZE = 32

    def __init__(self, buf):
        if buf[0:4] != b"VFF ":
            raise VFFError("not a VFF file (bad magic)")
        bom = struct.unpack(">H", buf[4:6])[0]
        if bom != 0xFEFF:
            raise VFFError(f"bad VFF BOM {bom:#x}")
        self.file_size = struct.unpack(">I", buf[0x08:0x0C])[0]
        cluster_size_raw = struct.unpack(">H", buf[0x0C:0x0E])[0]
        self.cluster_size = cluster_size_raw << 4
        if self.cluster_size == 0:
            raise VFFError("cluster size is 0")
        self.cluster_count = self.file_size // self.cluster_size

        if self.cluster_count < 0xFF5:
            self.fat_type = "fat12"
            self.fat_size_bytes = align_up(
                -(-(self.cluster_count + 1) // 2) * 3, self.cluster_size
            )
            self.fat_eof_min = 0xFF8
        elif self.cluster_count < 0xFFF5:
            self.fat_type = "fat16"
            self.fat_size_bytes = align_up(self.cluster_count * 2, self.cluster_size)
            self.fat_eof_min = 0xFFF8
        else:
            raise VFFError(f"too large for FAT12/16 ({self.cluster_count} clusters)")

        self.fat1_offset = self.HEADER_SIZE
        self.fat2_offset = self.fat1_offset + self.fat_size_bytes
        self.root_dir_offset = self.fat2_offset + self.fat_size_bytes
        self.root_dir_size = self.ROOT_DIR_ENTRIES * self.DIRENT_SIZE
        self.data_region_offset = self.root_dir_offset + self.root_dir_size


def parse_fat16(buf, fat_offset, entry_count):
    return list(struct.unpack(f"<{entry_count}H", buf[fat_offset:fat_offset + entry_count * 2]))


def parse_fat12(buf, fat_offset, entry_count):
    entries = [0] * entry_count
    for i in range(entry_count):
        byte_off = fat_offset + (i * 3) // 2
        b0, b1 = buf[byte_off], buf[byte_off + 1]
        if i % 2 == 0:
            entries[i] = b0 | ((b1 & 0x0F) << 8)
        else:
            entries[i] = (b0 >> 4) | (b1 << 4)
    return entries


def parse_fat(buf, layout):
    if layout.fat_type == "fat16":
        entry_count = layout.fat_size_bytes // 2
        return parse_fat16(buf, layout.fat1_offset, entry_count)
    entry_count = (layout.fat_size_bytes * 2) // 3
    return parse_fat12(buf, layout.fat1_offset, entry_count)


def resolve_fat_chain(fat, start_cluster, fat_eof_min, max_len=100_000):
    if start_cluster < 2:
        return []
    chain = []
    seen = set()
    cur = start_cluster
    while 2 <= cur < fat_eof_min:
        if cur in seen or len(chain) > max_len:
            break
        seen.add(cur)
        chain.append(cur)
        cur = fat[cur] if cur < len(fat) else fat_eof_min
    return chain


def cluster_to_offset(cluster, layout):
    return layout.data_region_offset + (cluster - 2) * layout.cluster_size


def decode_83(buf, off):
    name = buf[off:off + 8].decode("latin1").rstrip()
    ext = buf[off + 8:off + 11].decode("latin1").rstrip()
    return f"{name}.{ext}" if ext else name


def extract_lfn_chars(buf, entry_off):
    def utf16le(off, nchars):
        out = []
        for i in range(nchars):
            code = struct.unpack("<H", buf[off + i * 2:off + i * 2 + 2])[0]
            if code in (0x0000, 0xFFFF):
                break
            out.append(chr(code))
        return "".join(out)

    p1 = utf16le(entry_off + 1, 5)
    p2 = utf16le(entry_off + 14, 6)
    p3 = utf16le(entry_off + 28, 2)
    return p1 + p2 + p3


def reconstruct_file(buf, chain, file_size, layout):
    if not chain:
        return b""
    out = bytearray()
    for c in chain:
        off = cluster_to_offset(c, layout)
        out += buf[off:off + layout.cluster_size]
    return bytes(out[:file_size])


def parse_directory(buf, offset, fat, layout, depth=0):
    if depth > 16:
        return []
    entries = []
    i = 0
    lfn_fragments = []
    while True:
        entry_off = offset + i * 32
        if entry_off + 32 > len(buf):
            break
        first = buf[entry_off]
        if first == 0x00:
            break
        if first == 0xE5:
            lfn_fragments = []
            i += 1
            continue
        attr = buf[entry_off + 11]
        if attr == 0x0F:
            lfn_fragments.insert(0, extract_lfn_chars(buf, entry_off))
            i += 1
            continue
        if attr & 0x08:
            lfn_fragments = []
            i += 1
            continue
        short_name = decode_83(buf, entry_off)
        full_name = "".join(lfn_fragments) if lfn_fragments else short_name
        lfn_fragments = []
        if full_name in (".", ".."):
            i += 1
            continue
        start_cluster = struct.unpack("<H", buf[entry_off + 26:entry_off + 28])[0]
        file_size = struct.unpack("<I", buf[entry_off + 28:entry_off + 32])[0]
        is_dir = bool(attr & 0x10)
        if is_dir:
            dir_off = (
                cluster_to_offset(start_cluster, layout)
                if start_cluster >= 2
                else layout.root_dir_offset
            )
            children = parse_directory(buf, dir_off, fat, layout, depth + 1)
            entries.append(
                {"name": full_name, "is_dir": True, "start_cluster": start_cluster, "children": children}
            )
        else:
            chain = (
                resolve_fat_chain(fat, start_cluster, layout.fat_eof_min)
                if start_cluster >= 2
                else []
            )
            data = reconstruct_file(buf, chain, file_size, layout)
            entries.append(
                {
                    "name": full_name,
                    "is_dir": False,
                    "start_cluster": start_cluster,
                    "size": file_size,
                    "data": data,
                }
            )
        i += 1
    return entries


class VFFVolume:
    def __init__(self, buf):
        self.buf = buf
        self.layout = VFFLayout(buf)
        self.fat = parse_fat(buf, self.layout)
        self.root = {
            "name": "/",
            "is_dir": True,
            "children": parse_directory(buf, self.layout.root_dir_offset, self.fat, self.layout),
        }

    def walk_files(self, predicate=None):
        results = []

        def walk(entries, path):
            for e in entries:
                p = path + "/" + e["name"]
                if e["is_dir"]:
                    walk(e["children"], p)
                else:
                    if predicate is None or predicate(e["name"], e["data"]):
                        results.append((p, e["data"]))

        walk(self.root["children"], "")
        return results


# ---- CDBFILE / RIPLBoardRecord / .ptm parsing ----
#
# CDBFILE struct (from Naim2000/cdbackup source/cdbfile.h):
#   0x00: "CDBFILE" magic (7 bytes)
#   0x14: description string (e.g. "playtimelog", "ripl_board_record")
#   0x74: edit_count (u32 BE)
#   0x7C: last_edit_time (u32 BE, Wii epoch)
#
# RIPLBoardRecord at CDBFILE + 0x400:
#   0x00: magic 0x52495F35 ("RI_5")
#   0x11C/0x120: desc_offset / body_offset (u32 BE, relative to message start)
#   0x128/0x12C/0x130: attachment[0] = { type, offset, size } (u32 BE)
#
# .ptm attachment (type=3, magic "03_0") = 8-byte header + N x 136-byte entries:
#   +0x60 (8 bytes): start ticks (BE u64, 60.75MHz Wii timebase)
#   +0x68 (8 bytes): end ticks (BE u64)
#   +0x70 (4 bytes): ASCII game code (e.g. "HACA")

CDBFILE_DESC_OFFSET = 0x14
CDBFILE_LAST_EDIT_OFFSET = 0x7C
CDBFILE_EDIT_COUNT_OFFSET = 0x74
CDBFILE_MSG_OFFSET = 0x400
MSG_MAGIC_RI5 = 0x52495F35
MSG_DESC_OFFSET_FIELD = 0x11C
MSG_BODY_OFFSET_FIELD = 0x120
MSG_ATT0_TYPE_OFFSET = 0x128
MSG_ATT0_OFFSET_OFFSET = 0x12C
MSG_ATT0_SIZE_OFFSET = 0x130
PTM_MAGIC = 0x30335F30
PTM_HEADER_SIZE = 8
PTM_ENTRY_SIZE = 136
PTM_TICKS_START_OFFSET = 0x60
PTM_TICKS_END_OFFSET = 0x68
PTM_GAME_CODE_OFFSET = 0x70

# plausible Wii-epoch range (roughly console launch 2006 .. 2030)
_MIN_WII_EPOCH_SECONDS = 189302400
_MAX_WII_EPOCH_SECONDS = 946684800


def ascii_decode(data, off, length):
    chunk = data[off:off + length]
    out = []
    for b in chunk:
        if b == 0:
            break
        out.append(chr(b))
    return "".join(out)


def utf16be_read(data, off, max_bytes):
    if off + 1 >= len(data):
        return ""
    out = []
    i = 0
    while i + 1 < max_bytes and off + i + 1 < len(data):
        code = struct.unpack(">H", data[off + i:off + i + 2])[0]
        if code == 0:
            break
        out.append(chr(code))
        i += 2
    return "".join(out)


def parse_cdb_record(data, path=""):
    if len(data) < CDBFILE_MSG_OFFSET:
        return None
    if ascii_decode(data, 0, 7) != "CDBFILE":
        return None
    description = ascii_decode(data, CDBFILE_DESC_OFFSET, 30)
    last_edit_time = struct.unpack(">I", data[CDBFILE_LAST_EDIT_OFFSET:CDBFILE_LAST_EDIT_OFFSET + 4])[0]
    edit_count = struct.unpack(">I", data[CDBFILE_EDIT_COUNT_OFFSET:CDBFILE_EDIT_COUNT_OFFSET + 4])[0]
    date = wii_ts_to_dt(last_edit_time)
    message_title = None
    body_excerpt = None
    if len(data) >= CDBFILE_MSG_OFFSET + 0x134:
        msg_magic = struct.unpack(">I", data[CDBFILE_MSG_OFFSET:CDBFILE_MSG_OFFSET + 4])[0]
        if msg_magic == MSG_MAGIC_RI5:
            desc_off = struct.unpack(
                ">I", data[CDBFILE_MSG_OFFSET + MSG_DESC_OFFSET_FIELD:CDBFILE_MSG_OFFSET + MSG_DESC_OFFSET_FIELD + 4]
            )[0]
            body_off = struct.unpack(
                ">I", data[CDBFILE_MSG_OFFSET + MSG_BODY_OFFSET_FIELD:CDBFILE_MSG_OFFSET + MSG_BODY_OFFSET_FIELD + 4]
            )[0]
            if desc_off > 0 and CDBFILE_MSG_OFFSET + desc_off < len(data):
                message_title = utf16be_read(data, CDBFILE_MSG_OFFSET + desc_off, 200)
            if body_off > 0 and CDBFILE_MSG_OFFSET + body_off < len(data):
                body_excerpt = utf16be_read(data, CDBFILE_MSG_OFFSET + body_off, 2000)
    return {
        "description": description,
        "date": date,
        "edit_count": edit_count,
        "message_title": message_title,
        "body_excerpt": body_excerpt,
        "data": data,
        "path": path,
    }


def extract_cdb_records(volume):
    files = volume.walk_files(lambda name, data: len(data) >= 7 and ascii_decode(data, 0, 7) == "CDBFILE")
    records = []
    for path, data in files:
        rec = parse_cdb_record(data, path)
        if rec:
            records.append(rec)
    records.sort(key=lambda r: r["date"], reverse=True)
    return records


def parse_cdb_playtime_file(data, path=""):
    if len(data) < CDBFILE_MSG_OFFSET + 0x140:
        return []
    if ascii_decode(data, 0, 7) != "CDBFILE":
        return []
    last_edit_time = struct.unpack(">I", data[CDBFILE_LAST_EDIT_OFFSET:CDBFILE_LAST_EDIT_OFFSET + 4])[0]
    fallback_date = wii_ts_to_dt(last_edit_time)
    msg_magic = struct.unpack(">I", data[CDBFILE_MSG_OFFSET:CDBFILE_MSG_OFFSET + 4])[0]
    if msg_magic != MSG_MAGIC_RI5:
        return []
    att_type = struct.unpack(
        ">I", data[CDBFILE_MSG_OFFSET + MSG_ATT0_TYPE_OFFSET:CDBFILE_MSG_OFFSET + MSG_ATT0_TYPE_OFFSET + 4]
    )[0]
    att_offset = struct.unpack(
        ">I", data[CDBFILE_MSG_OFFSET + MSG_ATT0_OFFSET_OFFSET:CDBFILE_MSG_OFFSET + MSG_ATT0_OFFSET_OFFSET + 4]
    )[0]
    att_size = struct.unpack(
        ">I", data[CDBFILE_MSG_OFFSET + MSG_ATT0_SIZE_OFFSET:CDBFILE_MSG_OFFSET + MSG_ATT0_SIZE_OFFSET + 4]
    )[0]
    if att_type != 3 or att_offset == 0 or att_size == 0:
        return []
    ptm_start = CDBFILE_MSG_OFFSET + att_offset
    if ptm_start >= len(data):
        return []
    ptm_end = min(ptm_start + att_size, len(data))
    ptm_size = ptm_end - ptm_start
    if ptm_size < PTM_HEADER_SIZE:
        return []
    ptm_magic = struct.unpack(">I", data[ptm_start:ptm_start + 4])[0]
    if ptm_magic != PTM_MAGIC:
        return []
    num_entries = (ptm_size - PTM_HEADER_SIZE) // PTM_ENTRY_SIZE
    results = []
    for i in range(num_entries):
        ent_off = ptm_start + PTM_HEADER_SIZE + i * PTM_ENTRY_SIZE
        gc_off = ent_off + PTM_GAME_CODE_OFFSET
        if gc_off + 4 > len(data):
            break
        game_code = ascii_decode(data, gc_off, 4)
        if len(game_code) < 3 or not game_code.isalnum() or not game_code.isupper():
            continue
        ticks_start_off = ent_off + PTM_TICKS_START_OFFSET
        ticks_end_off = ent_off + PTM_TICKS_END_OFFSET
        duration_seconds = 0
        date = fallback_date
        start_ticks = 0
        end_ticks = 0
        if ticks_end_off + 8 <= len(data):
            start_ticks = struct.unpack(">Q", data[ticks_start_off:ticks_start_off + 8])[0]
            end_ticks = struct.unpack(">Q", data[ticks_end_off:ticks_end_off + 8])[0]
            if end_ticks > start_ticks:
                duration_seconds = (end_ticks - start_ticks) / WII_TICK_RATE
            if start_ticks > 0:
                start_seconds = start_ticks // WII_TICK_RATE
                if _MIN_WII_EPOCH_SECONDS <= start_seconds <= _MAX_WII_EPOCH_SECONDS:
                    date = wii_ts_to_dt(start_seconds)
        if duration_seconds > 86400:
            duration_seconds = 0
        results.append(
            {
                "game_code": game_code,
                "duration_seconds": round(duration_seconds),
                "date": date,
                "start_ticks": start_ticks,
                "end_ticks": end_ticks,
                "block_offset": ent_off,
                "vff_path": path,
            }
        )
    return results


def parse_playtime_logs(volume):
    log_files = volume.walk_files(
        lambda name, data: (
            len(data) >= CDBFILE_MSG_OFFSET
            and ascii_decode(data, 0, 7) == "CDBFILE"
            and ascii_decode(data, CDBFILE_DESC_OFFSET, 12) == "playtimelog"
        )
    )
    entries = []
    for path, data in log_files:
        entries.extend(parse_cdb_playtime_file(data, path))
    entries.sort(key=lambda e: e["date"])
    return entries
