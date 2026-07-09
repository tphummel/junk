package main

// Python port of riiwind's VFF / CDBFILE / playtime-log parser
// (https://github.com/DeekyJay/riiwind), for parsing a Wii Message Board
// cdb.vff extracted from a decrypted NAND dump.
//
// A VFF ("Virtual FAT Filesystem") is a small FAT12/16 container the Wii
// system software uses for WC24/message-board data. Inside it, message
// board entries and playtime logs are stored as "CDBFILE" records (see
// Naim2000/cdbackup's cdbfile.h for the on-disk struct this is based on).

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const (
	wiiEpochOffset = 946684800 // seconds between 1970-01-01 and 2000-01-01
	wiiTickRate    = 60_750_000

	minWiiEpochSeconds = 189302400
	maxWiiEpochSeconds = 946684800
)

func wiiTsToTime(wiiTs int64) time.Time {
	return time.Unix(wiiTs+wiiEpochOffset, 0).UTC()
}

func alignUp(value, alignment int) int {
	return ((value + alignment - 1) / alignment) * alignment
}

// ---- VFF container (FAT12/16) ----

const (
	vffHeaderSize  = 0x20
	vffRootDirEnts = 128
	vffDirentSize  = 32
)

type vffLayout struct {
	fileSize         uint32
	clusterSize      int
	clusterCount     int
	fatType          string // "fat12" | "fat16"
	fatSizeBytes     int
	fatEOFMin        int
	fat1Offset       int
	fat2Offset       int
	rootDirOffset    int
	rootDirSize      int
	dataRegionOffset int
}

func parseVFFLayout(buf []byte) (*vffLayout, error) {
	if len(buf) < 0x10 || string(buf[0:4]) != "VFF " {
		return nil, fmt.Errorf("not a VFF file (bad magic)")
	}
	bom := binary.BigEndian.Uint16(buf[4:6])
	if bom != 0xFEFF {
		return nil, fmt.Errorf("bad VFF BOM %#x", bom)
	}
	l := &vffLayout{}
	l.fileSize = binary.BigEndian.Uint32(buf[0x08:0x0C])
	clusterSizeRaw := binary.BigEndian.Uint16(buf[0x0C:0x0E])
	l.clusterSize = int(clusterSizeRaw) << 4
	if l.clusterSize == 0 {
		return nil, fmt.Errorf("cluster size is 0")
	}
	l.clusterCount = int(l.fileSize) / l.clusterSize

	switch {
	case l.clusterCount < 0xFF5:
		l.fatType = "fat12"
		l.fatSizeBytes = alignUp(((l.clusterCount+1+1)/2)*3, l.clusterSize)
		l.fatEOFMin = 0xFF8
	case l.clusterCount < 0xFFF5:
		l.fatType = "fat16"
		l.fatSizeBytes = alignUp(l.clusterCount*2, l.clusterSize)
		l.fatEOFMin = 0xFFF8
	default:
		return nil, fmt.Errorf("too large for FAT12/16 (%d clusters)", l.clusterCount)
	}

	l.fat1Offset = vffHeaderSize
	l.fat2Offset = l.fat1Offset + l.fatSizeBytes
	l.rootDirOffset = l.fat2Offset + l.fatSizeBytes
	l.rootDirSize = vffRootDirEnts * vffDirentSize
	l.dataRegionOffset = l.rootDirOffset + l.rootDirSize
	return l, nil
}

func parseFAT16(buf []byte, fatOffset, entryCount int) []int {
	entries := make([]int, entryCount)
	for i := 0; i < entryCount; i++ {
		entries[i] = int(binary.LittleEndian.Uint16(buf[fatOffset+i*2:]))
	}
	return entries
}

func parseFAT12(buf []byte, fatOffset, entryCount int) []int {
	entries := make([]int, entryCount)
	for i := 0; i < entryCount; i++ {
		byteOff := fatOffset + (i*3)/2
		b0, b1 := buf[byteOff], buf[byteOff+1]
		if i%2 == 0 {
			entries[i] = int(b0) | (int(b1&0x0F) << 8)
		} else {
			entries[i] = (int(b0) >> 4) | (int(b1) << 4)
		}
	}
	return entries
}

func parseFAT(buf []byte, l *vffLayout) []int {
	if l.fatType == "fat16" {
		return parseFAT16(buf, l.fat1Offset, l.fatSizeBytes/2)
	}
	return parseFAT12(buf, l.fat1Offset, (l.fatSizeBytes*2)/3)
}

func resolveFATChain(fat []int, startCluster, fatEOFMin int) []int {
	if startCluster < 2 {
		return nil
	}
	var chain []int
	seen := map[int]bool{}
	cur := startCluster
	for cur >= 2 && cur < fatEOFMin {
		if seen[cur] || len(chain) > 100000 {
			break
		}
		seen[cur] = true
		chain = append(chain, cur)
		if cur < len(fat) {
			cur = fat[cur]
		} else {
			cur = fatEOFMin
		}
	}
	return chain
}

func clusterToOffset(cluster int, l *vffLayout) int {
	return l.dataRegionOffset + (cluster-2)*l.clusterSize
}

func decode83(buf []byte, off int) string {
	name := strings.TrimRight(string(buf[off:off+8]), " ")
	ext := strings.TrimRight(string(buf[off+8:off+11]), " ")
	if ext != "" {
		return name + "." + ext
	}
	return name
}

func extractLFNChars(buf []byte, entryOff int) string {
	utf16le := func(off, nchars int) string {
		var sb strings.Builder
		for i := 0; i < nchars; i++ {
			code := binary.LittleEndian.Uint16(buf[off+i*2 : off+i*2+2])
			if code == 0x0000 || code == 0xFFFF {
				break
			}
			sb.WriteRune(rune(code))
		}
		return sb.String()
	}
	p1 := utf16le(entryOff+1, 5)
	p2 := utf16le(entryOff+14, 6)
	p3 := utf16le(entryOff+28, 2)
	return p1 + p2 + p3
}

func reconstructFile(buf []byte, chain []int, fileSize int, l *vffLayout) []byte {
	if len(chain) == 0 {
		return []byte{}
	}
	out := make([]byte, 0, len(chain)*l.clusterSize)
	for _, c := range chain {
		off := clusterToOffset(c, l)
		out = append(out, buf[off:off+l.clusterSize]...)
	}
	if fileSize < len(out) {
		out = out[:fileSize]
	}
	return out
}

type vffEntry struct {
	name         string
	isDir        bool
	startCluster int
	size         int
	data         []byte
	children     []*vffEntry
}

func parseDirectory(buf []byte, offset int, fat []int, l *vffLayout, depth int) []*vffEntry {
	if depth > 16 {
		return nil
	}
	var entries []*vffEntry
	i := 0
	var lfnFragments []string
	for {
		entryOff := offset + i*32
		if entryOff+32 > len(buf) {
			break
		}
		first := buf[entryOff]
		if first == 0x00 {
			break
		}
		if first == 0xE5 {
			lfnFragments = nil
			i++
			continue
		}
		attr := buf[entryOff+11]
		if attr == 0x0F {
			lfnFragments = append([]string{extractLFNChars(buf, entryOff)}, lfnFragments...)
			i++
			continue
		}
		if attr&0x08 != 0 {
			lfnFragments = nil
			i++
			continue
		}
		shortName := decode83(buf, entryOff)
		fullName := shortName
		if len(lfnFragments) > 0 {
			fullName = strings.Join(lfnFragments, "")
		}
		lfnFragments = nil
		if fullName == "." || fullName == ".." {
			i++
			continue
		}
		startCluster := int(binary.LittleEndian.Uint16(buf[entryOff+26 : entryOff+28]))
		fileSize := int(binary.LittleEndian.Uint32(buf[entryOff+28 : entryOff+32]))
		isDir := attr&0x10 != 0
		if isDir {
			var dirOff int
			if startCluster >= 2 {
				dirOff = clusterToOffset(startCluster, l)
			} else {
				dirOff = l.rootDirOffset
			}
			children := parseDirectory(buf, dirOff, fat, l, depth+1)
			entries = append(entries, &vffEntry{name: fullName, isDir: true, startCluster: startCluster, children: children})
		} else {
			var chain []int
			if startCluster >= 2 {
				chain = resolveFATChain(fat, startCluster, l.fatEOFMin)
			}
			data := reconstructFile(buf, chain, fileSize, l)
			entries = append(entries, &vffEntry{name: fullName, isDir: false, startCluster: startCluster, size: fileSize, data: data})
		}
		i++
	}
	return entries
}

type vffFile struct {
	path string
	data []byte
}

type VFFVolume struct {
	buf    []byte
	layout *vffLayout
	fat    []int
	root   []*vffEntry
}

func ParseVFFVolume(buf []byte) (*VFFVolume, error) {
	layout, err := parseVFFLayout(buf)
	if err != nil {
		return nil, err
	}
	fat := parseFAT(buf, layout)
	root := parseDirectory(buf, layout.rootDirOffset, fat, layout, 0)
	return &VFFVolume{buf: buf, layout: layout, fat: fat, root: root}, nil
}

func (v *VFFVolume) walkFiles(predicate func(name string, data []byte) bool) []vffFile {
	var results []vffFile
	var walk func(entries []*vffEntry, path string)
	walk = func(entries []*vffEntry, path string) {
		for _, e := range entries {
			p := path + "/" + e.name
			if e.isDir {
				walk(e.children, p)
			} else if predicate == nil || predicate(e.name, e.data) {
				results = append(results, vffFile{path: p, data: e.data})
			}
		}
	}
	walk(v.root, "")
	return results
}

// ---- CDBFILE / RIPLBoardRecord / .ptm parsing ----
//
// CDBFILE struct (from Naim2000/cdbackup source/cdbfile.h):
//   0x00: "CDBFILE" magic (7 bytes)
//   0x08: wii_id -- the console's unique system ID (8 bytes), constant
//         across every record from the same Wii
//   0x14: description string (e.g. "playtimelog", "ripl_board_record")
//   0x74: edit_count (u32 BE)
//   0x7C: last_edit_time (u32 BE, Wii epoch)
//
// RIPLBoardRecord at CDBFILE + 0x400:
//   0x00: magic 0x52495F35 ("RI_5")
//   0x11C/0x120: desc_offset / body_offset (u32 BE, relative to message start)
//   0x128/0x12C/0x130: attachment[0] = { type, offset, size } (u32 BE)
//
// .ptm attachment (type=3, magic "03_0") = 8-byte header + N x 136-byte entries:
//   +0x0C (84 bytes): UTF-16BE game name, null-padded -- written by the
//                     console itself at logging time from the game/channel's
//                     own banner metadata. This is what the Wii's own
//                     Message Board displays, so it's authoritative and
//                     needs no external database to resolve.
//   +0x60 (8 bytes): start ticks (BE u64, 60.75MHz Wii timebase)
//   +0x68 (8 bytes): end ticks (BE u64)
//   +0x70 (16 bytes): ASCII title ID, null-padded (e.g. "RSBE01") -- the
//                     full 6-char disc/channel ID (4-char game code +
//                     2-char maker/region), not just the 4-char code

const (
	cdbfileWiiIDOffset     = 0x08
	cdbfileWiiIDSize       = 8
	cdbfileDescOffset      = 0x14
	cdbfileLastEditOffset  = 0x7C
	cdbfileEditCountOffset = 0x74
	cdbfileMsgOffset       = 0x400
	msgMagicRI5            = 0x52495F35
	msgDescOffsetField     = 0x11C
	msgBodyOffsetField     = 0x120
	msgAtt0TypeOffset      = 0x128
	msgAtt0OffsetOffset    = 0x12C
	msgAtt0SizeOffset      = 0x130
	ptmMagic               = 0x30335F30
	ptmHeaderSize          = 8
	ptmEntrySize           = 136
	ptmGameNameOffset      = 0x0C
	ptmGameNameSize        = 84
	ptmTicksStartOffset    = 0x60
	ptmTicksEndOffset      = 0x68
	ptmTitleIDOffset       = 0x70
	ptmTitleIDSize         = 16
)

func asciiDecode(data []byte, off, length int) string {
	if off >= len(data) {
		return ""
	}
	end := off + length
	if end > len(data) {
		end = len(data)
	}
	chunk := data[off:end]
	if i := indexByte(chunk, 0); i >= 0 {
		chunk = chunk[:i]
	}
	return string(chunk)
}

func indexByte(b []byte, c byte) int {
	for i, v := range b {
		if v == c {
			return i
		}
	}
	return -1
}

func utf16beRead(data []byte, off, maxBytes int) string {
	if off+1 >= len(data) {
		return ""
	}
	var sb strings.Builder
	i := 0
	for i+1 < maxBytes && off+i+1 < len(data) {
		code := binary.BigEndian.Uint16(data[off+i : off+i+2])
		if code == 0 {
			break
		}
		sb.WriteRune(rune(code))
		i += 2
	}
	return sb.String()
}

func isUpperAlnum(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

type cdbRecord struct {
	description  string
	date         time.Time
	editCount    uint32
	messageTitle string
	bodyExcerpt  string
	consoleID    string
	path         string
}

func parseCDBRecord(data []byte, path string) *cdbRecord {
	if len(data) < cdbfileMsgOffset {
		return nil
	}
	if asciiDecode(data, 0, 7) != "CDBFILE" {
		return nil
	}
	description := asciiDecode(data, cdbfileDescOffset, 30)
	lastEditTime := binary.BigEndian.Uint32(data[cdbfileLastEditOffset : cdbfileLastEditOffset+4])
	editCount := binary.BigEndian.Uint32(data[cdbfileEditCountOffset : cdbfileEditCountOffset+4])
	date := wiiTsToTime(int64(lastEditTime))
	consoleID := hex.EncodeToString(data[cdbfileWiiIDOffset : cdbfileWiiIDOffset+cdbfileWiiIDSize])

	rec := &cdbRecord{description: description, date: date, editCount: editCount, consoleID: consoleID, path: path}

	if len(data) >= cdbfileMsgOffset+0x134 {
		msgMagic := binary.BigEndian.Uint32(data[cdbfileMsgOffset : cdbfileMsgOffset+4])
		if msgMagic == msgMagicRI5 {
			descOff := binary.BigEndian.Uint32(data[cdbfileMsgOffset+msgDescOffsetField : cdbfileMsgOffset+msgDescOffsetField+4])
			bodyOff := binary.BigEndian.Uint32(data[cdbfileMsgOffset+msgBodyOffsetField : cdbfileMsgOffset+msgBodyOffsetField+4])
			if descOff > 0 && cdbfileMsgOffset+int(descOff) < len(data) {
				rec.messageTitle = utf16beRead(data, cdbfileMsgOffset+int(descOff), 200)
			}
			if bodyOff > 0 && cdbfileMsgOffset+int(bodyOff) < len(data) {
				rec.bodyExcerpt = utf16beRead(data, cdbfileMsgOffset+int(bodyOff), 2000)
			}
		}
	}
	return rec
}

func extractCDBRecords(v *VFFVolume) []*cdbRecord {
	files := v.walkFiles(func(name string, data []byte) bool {
		return len(data) >= 7 && asciiDecode(data, 0, 7) == "CDBFILE"
	})
	var records []*cdbRecord
	for _, f := range files {
		if rec := parseCDBRecord(f.data, f.path); rec != nil {
			records = append(records, rec)
		}
	}
	return records
}

type playtimeEntry struct {
	gameCode        string
	titleID         string
	gameName        string
	durationSeconds int
	date            time.Time
	consoleID       string
	blockOffset     int
	vffPath         string
}

func parseCDBPlaytimeFile(data []byte, path string) []playtimeEntry {
	if len(data) < cdbfileMsgOffset+0x140 {
		return nil
	}
	if asciiDecode(data, 0, 7) != "CDBFILE" {
		return nil
	}
	lastEditTime := binary.BigEndian.Uint32(data[cdbfileLastEditOffset : cdbfileLastEditOffset+4])
	fallbackDate := wiiTsToTime(int64(lastEditTime))
	consoleID := hex.EncodeToString(data[cdbfileWiiIDOffset : cdbfileWiiIDOffset+cdbfileWiiIDSize])
	msgMagic := binary.BigEndian.Uint32(data[cdbfileMsgOffset : cdbfileMsgOffset+4])
	if msgMagic != msgMagicRI5 {
		return nil
	}
	attType := binary.BigEndian.Uint32(data[cdbfileMsgOffset+msgAtt0TypeOffset : cdbfileMsgOffset+msgAtt0TypeOffset+4])
	attOffset := binary.BigEndian.Uint32(data[cdbfileMsgOffset+msgAtt0OffsetOffset : cdbfileMsgOffset+msgAtt0OffsetOffset+4])
	attSize := binary.BigEndian.Uint32(data[cdbfileMsgOffset+msgAtt0SizeOffset : cdbfileMsgOffset+msgAtt0SizeOffset+4])
	if attType != 3 || attOffset == 0 || attSize == 0 {
		return nil
	}
	ptmStart := cdbfileMsgOffset + int(attOffset)
	if ptmStart >= len(data) {
		return nil
	}
	ptmEnd := ptmStart + int(attSize)
	if ptmEnd > len(data) {
		ptmEnd = len(data)
	}
	ptmSize := ptmEnd - ptmStart
	if ptmSize < ptmHeaderSize {
		return nil
	}
	magic := binary.BigEndian.Uint32(data[ptmStart : ptmStart+4])
	if magic != ptmMagic {
		return nil
	}
	numEntries := (ptmSize - ptmHeaderSize) / ptmEntrySize
	var results []playtimeEntry
	for i := 0; i < numEntries; i++ {
		entOff := ptmStart + ptmHeaderSize + i*ptmEntrySize
		tidOff := entOff + ptmTitleIDOffset
		if tidOff+4 > len(data) {
			break
		}
		titleID := asciiDecode(data, tidOff, ptmTitleIDSize)
		gameCode := titleID
		if len(gameCode) > 4 {
			gameCode = gameCode[:4]
		}
		if len(gameCode) < 3 || !isUpperAlnum(gameCode) {
			continue
		}
		gameName := utf16beRead(data, entOff+ptmGameNameOffset, ptmGameNameSize)
		ticksStartOff := entOff + ptmTicksStartOffset
		ticksEndOff := entOff + ptmTicksEndOffset
		durationSeconds := 0.0
		date := fallbackDate
		if ticksEndOff+8 <= len(data) {
			startTicks := binary.BigEndian.Uint64(data[ticksStartOff : ticksStartOff+8])
			endTicks := binary.BigEndian.Uint64(data[ticksEndOff : ticksEndOff+8])
			if endTicks > startTicks {
				durationSeconds = float64(endTicks-startTicks) / wiiTickRate
			}
			if startTicks > 0 {
				startSeconds := int64(startTicks / wiiTickRate)
				if startSeconds >= minWiiEpochSeconds && startSeconds <= maxWiiEpochSeconds {
					date = wiiTsToTime(startSeconds)
				}
			}
		}
		if durationSeconds > 86400 {
			durationSeconds = 0
		}
		results = append(results, playtimeEntry{
			gameCode:        gameCode,
			titleID:         titleID,
			gameName:        gameName,
			durationSeconds: int(durationSeconds + 0.5),
			date:            date,
			consoleID:       consoleID,
			blockOffset:     entOff,
			vffPath:         path,
		})
	}
	return results
}

func parsePlaytimeLogs(v *VFFVolume) []playtimeEntry {
	logFiles := v.walkFiles(func(name string, data []byte) bool {
		return len(data) >= cdbfileMsgOffset &&
			asciiDecode(data, 0, 7) == "CDBFILE" &&
			asciiDecode(data, cdbfileDescOffset, 12) == "playtimelog"
	})
	var entries []playtimeEntry
	for _, f := range logFiles {
		entries = append(entries, parseCDBPlaytimeFile(f.data, f.path)...)
	}
	return entries
}
