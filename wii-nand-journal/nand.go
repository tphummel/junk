package main

// Wii NAND (SFFS) parser, ported from WiiQt's nandbin.cpp (trapexit/wiiqt).
//
// Handles the "old bootmii" dump type (file size 553649152 = 0x21000400),
// which appends a 0x400-byte keys.bin blob at the very end of the raw dump
// containing the per-console AES-128 NAND key. This is the format produced
// by BootMii's "backup NAND" feature and is the most common Wii NAND dump
// you'll find in the wild.

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"fmt"
	"os"
	"strings"
)

const (
	expectedNandSize = 553649152 // 0x21000400

	// type-2 ("old bootmii") layout constants, from NandBin::InitNand /
	// FindSuperblock / GetFST / GetFAT / GetCluster in WiiQt's nandbin.cpp
	nStart      = 0x20BE0000
	nEnd        = 0x21000000
	nLen        = 0x42000
	nFatLen     = 0x010800
	nFST        = 2
	nFAT        = 0x20
	nClusterLen = 0x4200
	nPageLen    = 0x840
	keyOffset   = 0x21000158

	fstCount = 0x17FF // 6143
)

type fstEntry struct {
	idx       int
	name      string
	attr, wtf byte
	sub, sib  uint16
	size      uint32
	uid       uint32
	gid       uint16
	x3        uint32
}

func (e *fstEntry) isDir() bool  { return e.attr&3 == 2 }
func (e *fstEntry) isFile() bool { return e.attr&3 == 1 }

type WiiNand struct {
	f                        *os.File
	key                      []byte
	locSuper, locFAT, locFST int64
	superblockGeneration     uint32
	fsts                     []fstEntry
}

func OpenWiiNand(path string) (*WiiNand, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if info.Size() != expectedNandSize {
		f.Close()
		return nil, fmt.Errorf("unexpected nand.bin size %d, expected %d (type-2/old-bootmii dump with appended keys.bin)", info.Size(), expectedNandSize)
	}

	n := &WiiNand{f: f}
	n.key = make([]byte, 16)
	if _, err := f.ReadAt(n.key, keyOffset); err != nil {
		f.Close()
		return nil, fmt.Errorf("reading NAND key: %w", err)
	}

	loc, err := n.findSuperblock()
	if err != nil {
		f.Close()
		return nil, err
	}
	n.locSuper = loc
	n.locFAT = n.locSuper
	n.locFST = n.locFAT + 0xC + nFatLen

	return n, nil
}

func (n *WiiNand) Close() error { return n.f.Close() }

func (n *WiiNand) readAt(off int64, size int) ([]byte, error) {
	buf := make([]byte, size)
	if _, err := n.f.ReadAt(buf, off); err != nil {
		return nil, err
	}
	return buf, nil
}

func (n *WiiNand) findSuperblock() (int64, error) {
	bestGen := int64(-1)
	bestLoc := int64(-1)
	for loc := int64(nStart); loc < nEnd; loc += nLen {
		magic, err := n.readAt(loc, 4)
		if err != nil {
			return 0, err
		}
		if string(magic) == "SFFS" {
			genBuf, err := n.readAt(loc+4, 4)
			if err != nil {
				return 0, err
			}
			gen := int64(binary.BigEndian.Uint32(genBuf))
			if gen > bestGen {
				bestGen = gen
				bestLoc = loc
			}
		}
	}
	if bestLoc == -1 {
		return 0, fmt.Errorf("no valid SFFS superblock found")
	}
	n.superblockGeneration = uint32(bestGen)
	return bestLoc, nil
}

func (n *WiiNand) getFST(entry int) (*fstEntry, error) {
	if entry >= fstCount {
		return nil, fmt.Errorf("fst entry %d out of range", entry)
	}
	locEntry := int64((entry/0x40)*nFST+entry) * 0x20
	base := n.locFST + locEntry

	nameBuf, err := n.readAt(base, 0xC)
	if err != nil {
		return nil, err
	}
	rest, err := n.readAt(base+0xC, 2)
	if err != nil {
		return nil, err
	}
	attr, wtf := rest[0], rest[1]
	subSib, err := n.readAt(base+0xE, 4)
	if err != nil {
		return nil, err
	}
	sub := binary.BigEndian.Uint16(subSib[0:2])
	sib := binary.BigEndian.Uint16(subSib[2:4])

	pos := base + 0x12
	var size uint32
	if (entry+1)%64 == 0 {
		hi, err := n.readAt(pos, 2)
		if err != nil {
			return nil, err
		}
		pos += 2 + 0x40
		lo, err := n.readAt(pos, 2)
		if err != nil {
			return nil, err
		}
		pos += 2
		size = uint32(binary.BigEndian.Uint16(hi))<<16 | uint32(binary.BigEndian.Uint16(lo))
	} else {
		sBuf, err := n.readAt(pos, 4)
		if err != nil {
			return nil, err
		}
		size = binary.BigEndian.Uint32(sBuf)
		pos += 4
	}
	uidBuf, err := n.readAt(pos, 4)
	if err != nil {
		return nil, err
	}
	uid := binary.BigEndian.Uint32(uidBuf)
	pos += 4
	gidBuf, err := n.readAt(pos, 2)
	if err != nil {
		return nil, err
	}
	gid := binary.BigEndian.Uint16(gidBuf)
	pos += 2
	x3Buf, err := n.readAt(pos, 4)
	if err != nil {
		return nil, err
	}
	x3 := binary.BigEndian.Uint32(x3Buf)

	name := string(nameBuf)
	if i := strings.IndexByte(name, 0); i >= 0 {
		name = name[:i]
	}

	return &fstEntry{
		idx: entry, name: name, attr: attr, wtf: wtf,
		sub: sub, sib: sib, size: size, uid: uid, gid: gid, x3: x3,
	}, nil
}

func (n *WiiNand) getFAT(fatEntry uint16) (uint16, error) {
	fe := int64(fatEntry) + 6
	loc := n.locFAT + (((fe/0x400)*nFAT + fe) * 2)
	buf, err := n.readAt(loc, 2)
	if err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint16(buf), nil
}

func (n *WiiNand) getCluster(clusterEntry uint16, decrypt bool) ([]byte, error) {
	cluster := make([]byte, 0, 0x4000)
	base := int64(clusterEntry) * nClusterLen
	for i := 0; i < 8; i++ {
		page, err := n.readAt(base+int64(i)*nPageLen, 0x800)
		if err != nil {
			return nil, err
		}
		cluster = append(cluster, page...)
	}
	if !decrypt {
		return cluster, nil
	}
	block, err := aes.NewCipher(n.key)
	if err != nil {
		return nil, err
	}
	iv := make([]byte, 16)
	dec := cipher.NewCBCDecrypter(block, iv)
	out := make([]byte, len(cluster))
	dec.CryptBlocks(out, cluster)
	return out, nil
}

func (n *WiiNand) loadAll() error {
	n.fsts = make([]fstEntry, fstCount)
	for i := 0; i < fstCount; i++ {
		e, err := n.getFST(i)
		if err != nil {
			return err
		}
		n.fsts[i] = *e
	}
	return nil
}

func (n *WiiNand) GetFileData(fst *fstEntry) ([]byte, error) {
	if fst.size == 0 {
		return []byte{}, nil
	}
	data := make([]byte, 0, fst.size)
	fat := fst.sub
	guard := 0
	for fat < 0xFFF0 {
		cluster, err := n.getCluster(fat, true)
		if err != nil {
			return nil, err
		}
		data = append(data, cluster...)
		fat, err = n.getFAT(fat)
		if err != nil {
			return nil, err
		}
		guard++
		if guard > 200000 {
			return nil, fmt.Errorf("cluster chain too long / probably looping")
		}
	}
	if int(fst.size) < len(data) {
		data = data[:fst.size]
	}
	return data, nil
}

type treeNode struct {
	path string
	fst  *fstEntry
}

func (n *WiiNand) walk() ([]treeNode, error) {
	if n.fsts == nil {
		if err := n.loadAll(); err != nil {
			return nil, err
		}
	}
	var results []treeNode

	var rec func(idx int, path string) error
	rec = func(idx int, path string) error {
		fst := &n.fsts[idx]
		results = append(results, treeNode{path: path, fst: fst})
		if fst.isDir() && fst.sub != 0xFFFF {
			child := fst.sub
			seen := map[uint16]bool{}
			for child != 0xFFFF && !seen[child] && int(child) < fstCount {
				seen[child] = true
				cfst := &n.fsts[child]
				var cpath string
				if path != "/" {
					cpath = strings.TrimRight(path, "/") + "/" + cfst.name
				} else {
					cpath = "/" + cfst.name
				}
				if err := rec(int(child), cpath); err != nil {
					return err
				}
				child = cfst.sib
			}
		}
		return nil
	}
	if err := rec(0, "/"); err != nil {
		return nil, err
	}
	return results, nil
}

// Find locates a single file/dir by absolute path
// (e.g. "/title/00000001/00000002/data/cdb.vff").
func (n *WiiNand) Find(path string) (*fstEntry, error) {
	tree, err := n.walk()
	if err != nil {
		return nil, err
	}
	for _, node := range tree {
		if node.path == path {
			return node.fst, nil
		}
	}
	return nil, nil
}
