package handlers

import (
	"fmt"
	"io"
	"mime/multipart"
)

// maxGPXFileBytes bounds how much of an uploaded file we'll read into
// memory. GPX files are plain XML text; even a long multi-day track rarely
// exceeds a few megabytes, so this comfortably covers real uploads while
// bounding worst-case memory use per request.
const maxGPXFileBytes = 20 << 20 // 20 MiB

func readMultipartFile(fh *multipart.FileHeader) ([]byte, error) {
	if fh.Size > maxGPXFileBytes {
		return nil, fmt.Errorf("file too large: %d bytes (max %d)", fh.Size, maxGPXFileBytes)
	}
	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, maxGPXFileBytes+1))
}
