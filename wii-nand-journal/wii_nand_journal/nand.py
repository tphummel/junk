"""
Wii NAND (SFFS) parser, ported from WiiQt's nandbin.cpp (trapexit/wiiqt).

Handles the "old bootmii" dump type (file size 553649152 = 0x21000400),
which appends a 0x400-byte keys.bin blob at the very end of the raw dump
containing the per-console AES-128 NAND key. This is the format produced
by BootMii's "backup NAND" feature and is the most common Wii NAND dump
you'll find in the wild.
"""
import struct

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

EXPECTED_SIZE = 553649152  # 0x21000400

# type-2 ("old bootmii") layout constants, from NandBin::InitNand /
# FindSuperblock / GetFST / GetFAT / GetCluster in WiiQt's nandbin.cpp
N_START = 0x20BE0000
N_END = 0x21000000
N_LEN = 0x42000
N_FATLEN = 0x010800
N_FST = 2
N_FAT = 0x20
N_CLUSTERLEN = 0x4200
N_PAGELEN = 0x840
KEY_OFFSET = 0x21000158
HMAC_KEY_OFFSET = 0x21000144

FST_COUNT = 0x17FF  # 6143


class WiiNandError(Exception):
    pass


class WiiNand:
    def __init__(self, path):
        self.f = open(path, "rb")
        size = self.f.seek(0, 2)
        if size != EXPECTED_SIZE:
            raise WiiNandError(
                f"unexpected nand.bin size {size}, expected {EXPECTED_SIZE} "
                "(type-2/old-bootmii dump with appended keys.bin)"
            )
        self.f.seek(KEY_OFFSET)
        self.key = self.f.read(16)
        self.loc_super = self._find_superblock()
        self.loc_fat = self.loc_super
        self.loc_fst = self.loc_fat + 0xC + N_FATLEN
        self.fsts = None

    def close(self):
        self.f.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _read_at(self, off, n):
        self.f.seek(off)
        return self.f.read(n)

    def _find_superblock(self):
        best_gen = -1
        best_loc = None
        loc = N_START
        while loc < N_END:
            magic = self._read_at(loc, 4)
            if magic == b"SFFS":
                gen = struct.unpack(">I", self._read_at(loc + 4, 4))[0]
                if gen > best_gen:
                    best_gen = gen
                    best_loc = loc
            loc += N_LEN
        if best_loc is None:
            raise WiiNandError("no valid SFFS superblock found")
        self.superblock_generation = best_gen
        return best_loc

    def get_fst(self, entry):
        if entry >= FST_COUNT:
            raise IndexError(entry)
        loc_entry = ((entry // 0x40) * N_FST + entry) * 0x20
        base = self.loc_fst + loc_entry
        name = self._read_at(base, 0xC)
        attr, wtf = struct.unpack(">BB", self._read_at(base + 0xC, 2))
        sub, sib = struct.unpack(">HH", self._read_at(base + 0xE, 4))
        pos = base + 0x12
        if (entry + 1) % 64 == 0:
            size_hi = self._read_at(pos, 2)
            pos += 2 + 0x40
            size_lo = self._read_at(pos, 2)
            pos += 2
            size = struct.unpack(">I", size_hi + size_lo)[0]
        else:
            size = struct.unpack(">I", self._read_at(pos, 4))[0]
            pos += 4
        uid = struct.unpack(">I", self._read_at(pos, 4))[0]
        pos += 4
        gid = struct.unpack(">H", self._read_at(pos, 2))[0]
        pos += 2
        x3 = struct.unpack(">I", self._read_at(pos, 4))[0]
        return {
            "idx": entry,
            "name": name.split(b"\x00")[0].decode("ascii", errors="replace"),
            "attr": attr,
            "wtf": wtf,
            "sub": sub,
            "sib": sib,
            "size": size,
            "uid": uid,
            "gid": gid,
            "x3": x3,
        }

    def get_fat(self, fat_entry):
        fe = fat_entry + 6
        loc = self.loc_fat + (((fe // 0x400) * N_FAT + fe) * 2)
        return struct.unpack(">H", self._read_at(loc, 2))[0]

    def get_cluster(self, cluster_entry, decrypt=True):
        cluster = bytearray()
        base = cluster_entry * N_CLUSTERLEN
        for i in range(8):
            page = self._read_at(base + i * N_PAGELEN, 0x800)
            cluster += page
        cluster = bytes(cluster)
        if not decrypt:
            return cluster
        cipher = Cipher(algorithms.AES(self.key), modes.CBC(b"\x00" * 16))
        dec = cipher.decryptor()
        return dec.update(cluster) + dec.finalize()

    def load_all(self):
        self.fsts = [self.get_fst(i) for i in range(FST_COUNT)]
        return self.fsts

    @staticmethod
    def is_dir(fst):
        return (fst["attr"] & 3) == 2

    @staticmethod
    def is_file(fst):
        return (fst["attr"] & 3) == 1

    def get_file_data(self, fst):
        if not fst["size"]:
            return b""
        fat = fst["sub"]
        data = bytearray()
        guard = 0
        while fat < 0xFFF0:
            data += self.get_cluster(fat)
            fat = self.get_fat(fat)
            guard += 1
            if guard > 200000:
                raise WiiNandError("cluster chain too long / probably looping")
        return bytes(data[: fst["size"]])

    def walk(self):
        """Return list of (path, fst_dict) for the whole tree, via sub/sib links."""
        if self.fsts is None:
            self.load_all()
        results = []

        def rec(idx, path):
            fst = self.fsts[idx]
            results.append((path, fst))
            if self.is_dir(fst) and fst["sub"] != 0xFFFF:
                child = fst["sub"]
                seen = set()
                while child != 0xFFFF and child not in seen and child < FST_COUNT:
                    seen.add(child)
                    cfst = self.fsts[child]
                    cpath = (
                        (path.rstrip("/") + "/" + cfst["name"])
                        if path != "/"
                        else "/" + cfst["name"]
                    )
                    rec(child, cpath)
                    child = cfst["sib"]

        rec(0, "/")
        return results

    def find(self, path):
        """Find a single file/dir by absolute path (e.g. '/title/00000001/00000002/data/cdb.vff')."""
        for p, fst in self.walk():
            if p == path:
                return fst
        return None
