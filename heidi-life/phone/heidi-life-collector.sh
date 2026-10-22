#!/data/data/com.termux/files/usr/bin/bash
# Heidi Life phone collector (Termux). Every INTERVAL seconds:
#   1. read location + battery via Termux:API
#   2. append to a local queue (works offline / away from home)
#   3. when Frank is reachable on the LAN, flush the queue and pick up due notifications
# Config: ~/.heidi-life/env  (HEIDI_FRANK_URL, HEIDI_TOKEN, optional INTERVAL)
set -u
DIR="$HOME/.heidi-life"
mkdir -p "$DIR"
# shellcheck disable=SC1091
. "$DIR/env"
INTERVAL="${INTERVAL:-300}"
QUEUE="$DIR/queue.jsonl"
LOG="$DIR/collector.log"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; }

sample() {
  local ts loc bat
  ts=$(( $(date +%s) * 1000 ))
  # network provider first (cheap); GPS fallback if network gives nothing
  loc=$(timeout 45 termux-location -p network -r once 2>/dev/null)
  [ -z "$loc" ] && loc=$(timeout 60 termux-location -p gps -r once 2>/dev/null)
  bat=$(timeout 15 termux-battery-status 2>/dev/null)
  jq -cn --argjson ts "$ts" --argjson loc "${loc:-null}" --argjson bat "${bat:-null}" '{
      ts: $ts,
      lat: ($loc.latitude // null), lon: ($loc.longitude // null),
      acc: ($loc.accuracy // null), provider: ($loc.provider // null),
      battery: ($bat.percentage // null),
      charging: (($bat.plugged // "UNPLUGGED") != "UNPLUGGED")
    }' >> "$QUEUE" 2>/dev/null || log "sample failed"
}

flush() {
  [ -s "$QUEUE" ] || return 0
  local batch="$DIR/batch.jsonl" body
  head -n 500 "$QUEUE" > "$batch"
  body=$(jq -cs '{pings: .}' "$batch") || { log "bad queue line, resetting"; : > "$QUEUE"; return 1; }
  if curl -fsS -m 15 -X POST "$HEIDI_FRANK_URL/ingest" \
       -H "x-heidi-token: $HEIDI_TOKEN" -H 'content-type: application/json' \
       --data "$body" > /dev/null; then
    local n; n=$(wc -l < "$batch")
    tail -n +"$((n + 1))" "$QUEUE" > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"
    log "flushed $n"
    [ -s "$QUEUE" ] && flush
  fi
  return 0
}

notifications() {
  local resp
  resp=$(curl -fsS -m 10 "$HEIDI_FRANK_URL/api/notifications/pending" -H "x-heidi-token: $HEIDI_TOKEN") || return 0
  echo "$resp" | jq -c '.notifications[]?' | while read -r n; do
    termux-notification --id "heidi-$(echo "$n" | jq -r .id)" \
      --title "Heidi · $(echo "$n" | jq -r .title)" --content "$(echo "$n" | jq -r .body)" --priority high
  done
}

# keep the queue from growing forever if Frank is unreachable for weeks (~30 days at 5-min pings)
trim() { [ "$(wc -l < "$QUEUE" 2>/dev/null || echo 0)" -gt 9000 ] && tail -n 9000 "$QUEUE" > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"; }

termux-wake-lock
log "collector start, interval ${INTERVAL}s → $HEIDI_FRANK_URL"
while true; do
  sample
  flush && notifications
  trim
  sleep "$INTERVAL"
done
