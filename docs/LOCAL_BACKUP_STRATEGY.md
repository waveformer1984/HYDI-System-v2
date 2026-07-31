# Local Backup Strategy

Implements the disaster-recovery leg of the Sovereign Local Development
Protocol (2026-07-25): no remote push/pull/fetch is required or assumed.
`origin` (`git@github.com:waveformer1984/HYDI-System-v2.git`) still exists
and is left untouched, but it is no longer the recovery path — these local
artifacts are.

## What it creates

Running `scripts/local-backup.sh backup` produces, per run, in
`$HYDI_BACKUP_DIR` (default `~/HYDI_Backups/HYDI_System`, outside the repo
tree so a destructive operation inside the working copy can't touch it):

| Artifact | Contents |
|---|---|
| `hydi-system-<ts>.bundle` | Full git history, all branches/tags/refs (`git bundle create --all`) |
| `hydi-system-<ts>-snapshot.tar.gz` | Tracked files only at HEAD (`git archive`) — a working-tree sanity copy |
| `manifest.log` | Append-only line per run: timestamp, commit, branch, clean/dirty, artifact sizes |
| `backup-<ts>` tag | Lightweight tag on HEAD so any bundle traces back to an exact commit |

Every bundle is verified (`git bundle verify`) immediately after creation —
a backup that fails verification fails the whole run (exit 1) rather than
being silently kept.

## Retention

Keeps the newest 10 bundle+snapshot pairs; older ones are deleted
automatically on each run. Tags are never deleted automatically. At ~370MB
per pair, steady-state usage is ~3.7GB.

## Usage

```bash
./scripts/local-backup.sh              # create a backup (default dir)
./scripts/local-backup.sh backup [dir] # explicit subcommand + dir override
./scripts/local-backup.sh verify [dir] # verify the newest bundle only
./scripts/local-backup.sh list [dir]   # print manifest.log
./scripts/local-backup.sh restore <bundle-path> <dest-dir>
```

`HYDI_BACKUP_DIR` env var overrides the default location; a directory
argument overrides the env var.

Restore is a plain `git clone <bundle> <dest>` — no network, no GitHub
involved. Verified 2026-07-25: a bundle taken from `clean-main` at
`ef95167` was restored into a scratch directory and reproduced the exact
commit history and all local/remote-tracking refs with no errors.

## When to run it

Run `local-backup.sh backup` at the end of each engineering round (Phase 8
of the continuous loop — after the commit, before selecting the next
milestone), not on every individual commit. Bundling+archiving a ~200MB
repo takes a few seconds, so it's cheap per round but would add unwanted
overhead if triggered on every commit inside a fast autonomous loop.

## Known limitation

This protects against local corruption, accidental deletion, and bad
resets/rebases — it does not protect against total disk loss, since
nothing leaves the machine. That tradeoff is intentional per the
Sovereign Local Development Protocol (no cloud dependency unless
explicitly authorized). If off-machine redundancy is ever wanted, it is a
separate, explicit decision — not something this script does silently.
