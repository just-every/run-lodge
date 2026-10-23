#!/usr/bin/env bash
# rer dev/preview require 15 GiB free. Keep another 5 GiB for fresh-clone
# dependencies, builds and archives; avoid deleting large hosted SDKs when the
# runner already has that headroom. This runs only on disposable hosted Ubuntu.
set -euo pipefail
available_bytes() { df -PB1 "$PWD" | awk 'NR == 2 { print $4 }'; }
target_bytes=$((20 * 1024 * 1024 * 1024))
minimum_bytes=$((15 * 1024 * 1024 * 1024))
df -h "$PWD"
for sdk_path in /usr/local/lib/android /usr/share/dotnet /usr/local/.ghcup; do
  if [ "$(available_bytes)" -ge "$target_bytes" ]; then break; fi
  if [ -d "$sdk_path" ]; then
    echo "Reclaiming unused hosted SDK: $sdk_path"
    sudo rm -rf -- "$sdk_path"
  fi
done
if [ "$(available_bytes)" -lt "$minimum_bytes" ]; then
  echo 'Hosted runner has less than the 15 GiB required by rer dev/preview.' >&2
  exit 1
fi
df -h "$PWD"
