#!/bin/bash

# Script to convert MKV files to MP4 with AAC audio for browser compatibility
# Usage: ./convert-videos.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo -e "${RED}Error: ffmpeg is not installed${NC}"
    echo "Please install it with: sudo apt install ffmpeg"
    exit 1
fi

echo -e "${GREEN}Starting video conversion...${NC}"
echo ""

# Find all MKV files in the media directory
find media -type f -name "*.mkv" | while read -r mkv_file; do
    # Get the directory and filename without extension
    dir=$(dirname "$mkv_file")
    filename=$(basename "$mkv_file" .mkv)
    mp4_file="$dir/$filename.mp4"

    # Skip if MP4 already exists
    if [ -f "$mp4_file" ]; then
        echo -e "${YELLOW}Skipping (MP4 exists): $mkv_file${NC}"
        continue
    fi

    echo -e "${GREEN}Converting: $mkv_file${NC}"
    echo -e "  -> $mp4_file"

    # Convert: copy video codec (fast), re-encode audio to AAC
    # -c:v copy = copy video stream without re-encoding (fast, no quality loss)
    # -c:a aac = convert audio to AAC (browser compatible)
    # -b:a 192k = audio bitrate 192kbps (good quality)
    # -movflags +faststart = optimize for web streaming
    if ffmpeg -i "$mkv_file" \
        -c:v copy \
        -c:a aac \
        -b:a 192k \
        -movflags +faststart \
        -y \
        "$mp4_file" 2>&1 | grep -i "error\|invalid"; then
        echo -e "${RED}Error converting: $mkv_file${NC}"
    else
        echo -e "${GREEN}Success!${NC}"
        echo ""
    fi
done

echo -e "${GREEN}Conversion complete!${NC}"
echo ""
echo "Note: Original MKV files are kept. You can delete them manually if needed."
