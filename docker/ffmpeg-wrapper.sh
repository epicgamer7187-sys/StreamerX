#!/bin/sh
# Wrapper installed as /usr/local/bin/ffmpeg (the real binary stays at /usr/bin/ffmpeg).
#
# 1. Debian's ffmpeg 7.1 rejects "-flags lowdelay" (now "low_delay"), which the stream library passes.
# 2. FAST START: the library's demuxer reads ~5 MB from ffmpeg before the stream goes live. A static page
#    only produces ~45 KB/s, so that took ~110 s. With constant-bitrate H264 + filler data ffmpeg outputs the
#    full bitrate even for a static picture, so the stream starts in ~15 s.
#    Disable with STREAM_FAST_START=false (uses less upload bandwidth on static pages).

REAL=/usr/bin/ffmpeg
fast=0
bv=""
prev=""
n=$#

case " $* " in
  *" -forced-idr "*)
    [ "$STREAM_FAST_START" != "false" ] && fast=1
    ;;
esac

if [ "$fast" = "1" ]; then
  for a; do
    [ "$prev" = "-b:v" ] && bv="$a"
    prev="$a"
  done
  [ -z "$bv" ] && fast=0
fi

prev=""
i=0
for a; do
  shift
  i=$((i + 1))
  cur="$a"
  [ "$a" = "lowdelay" ] && a="low_delay"
  if [ "$fast" = "1" ]; then
    [ "$prev" = "-maxrate:v" ] && a="$bv"
    if [ "$i" = "$n" ]; then
      set -- "$@" -x264-params nal-hrd=cbr
    fi
  fi
  set -- "$@" "$a"
  prev="$cur"
done

exec "$REAL" "$@"
