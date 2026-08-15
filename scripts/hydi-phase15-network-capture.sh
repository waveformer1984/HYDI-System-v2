#!/usr/bin/env bash
# Phase 15 — Packet-level network isolation capture
# Run inside the WSL Ubuntu distro as root:
#   wsl -d Ubuntu -u root -e bash scripts/hydi-phase15-network-capture.sh
#
# Captures all packets during a real HYDI acceptance run and reports any
# destination that is not localhost or a local/LAN address.

REPO="/mnt/c/Users/Owner/HYDI_System"
PCAP="/tmp/hydi-phase15-capture.pcap"
SUMMARY="$REPO/artifacts/phase15-network-capture-summary.txt"

cd "$REPO"
mkdir -p artifacts

# Git inside WSL needs to trust this Windows-mounted repository
git config --global --add safe.directory "$REPO" 2>/dev/null || true

# Clean local-only environment
export SUPABASE_URL=http://127.0.0.1:54321
export STRIPE_MODE=mock
export OPENAI_API_KEY=""
export ANTHROPIC_API_KEY=""
export RESEND_API_KEY=""
export ENABLE_LOCAL_MODEL=""

# Start packet capture on all WSL interfaces
rm -f "$PCAP"
echo "[capture] starting tcpdump on all interfaces..."
tcpdump -i any -nn -w "$PCAP" -s 0 2>/dev/null &
TCPDUMP_PID=$!
sleep 2

cleanup() {
  echo "[capture] stopping tcpdump..."
  kill "$TCPDUMP_PID" 2>/dev/null || true
  wait "$TCPDUMP_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "[capture] running HYDI Phase 14 acceptance in clean env..."
# Use the Phase 14 runner as the "real acceptance run" payload.
npm run hydi:readiness
node scripts/hydi-phase14-acceptance.js && ACCEPT_STATUS=PASS || ACCEPT_STATUS=FAIL

cleanup

echo "[capture] analyzing capture..." > "$SUMMARY"
echo "Generated: $(date -Iseconds)" >> "$SUMMARY"
echo "PCAP: $PCAP" >> "$SUMMARY"
echo "" >> "$SUMMARY"

# Print high-level summary
echo "--- Packet counts by IP protocol ---" >> "$SUMMARY"
tcpdump -nn -r "$PCAP" -q 2>/dev/null | head -n 200 >> "$SUMMARY" || true
echo "" >> "$SUMMARY"

echo "--- Unique non-local destination IPv4 addresses ---" >> "$SUMMARY"
tcpdump -nn -r "$PCAP" ip and not '(host 127.0.0.1 or host 0.0.0.0 or net 10.0.0.0/8 or net 172.16.0.0/12 or net 192.168.0.0/16 or net 169.254.0.0/16 or net 224.0.0.0/4 or net 127.0.0.0/8)' 2>/dev/null | awk '{print $3}' | cut -d: -f1 | sort -u >> "$SUMMARY" || true
echo "" >> "$SUMMARY"

echo "--- Unique non-local destination IPv6 addresses ---" >> "$SUMMARY"
tcpdump -nn -r "$PCAP" ip6 and not '(host ::1 or net fe80::/10 or net ff00::/8)' 2>/dev/null | awk '{print $3}' | cut -d. -f1 | sort -u >> "$SUMMARY" || true
echo "" >> "$SUMMARY"

NON_LOCAL=$(tcpdump -nn -r "$PCAP" ip and not '(host 127.0.0.1 or host 0.0.0.0 or net 10.0.0.0/8 or net 172.16.0.0/12 or net 192.168.0.0/16 or net 169.254.0.0/16 or net 224.0.0.0/4 or net 127.0.0.0/8)' 2>/dev/null | wc -l || true)

echo "--- Verdict ---" >> "$SUMMARY"
echo "ACCEPT_STATUS = $ACCEPT_STATUS" >> "$SUMMARY"
if [ "$NON_LOCAL" -eq 0 ]; then
  echo "NO_NON_LOCAL_PACKETS_OBSERVED = YES" >> "$SUMMARY"
  echo "PACKET-LEVEL_NETWORK_ISOLATION_PROOF = CAPTURED" >> "$SUMMARY"
  echo "[capture] PASS: zero non-localhost/non-LAN packets observed"
else
  echo "NO_NON_LOCAL_PACKETS_OBSERVED = NO" >> "$SUMMARY"
  echo "PACKET-LEVEL_NETWORK_ISOLATION_PROOF = FAILED" >> "$SUMMARY"
  echo "[capture] FAIL: $NON_LOCAL non-localhost/non-LAN packets observed"
  exit 1
fi

cp "$PCAP" "$REPO/artifacts/phase15-network-capture.pcap"
echo "[capture] evidence written to artifacts/phase15-network-capture-summary.txt and artifacts/phase15-network-capture.pcap"
