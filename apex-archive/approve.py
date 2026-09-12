"""Manual approval-gate CLI. Only J (or Claude acting on J's direct instruction in a
live session) runs this -- it is never invoked by the scheduled task itself.

Usage:
  python3 approve.py episode/manifest.json approve   --by "J" [--notes "..."]
  python3 approve.py episode/manifest.json ready     --by "J" [--notes "..."]
  python3 approve.py episode/manifest.json published --by "J" [--url "https://youtu.be/..."]
"""
import argparse
import json
import os
import sys

import manifest as manifest_mod

try:
    import episode_registry
except ImportError:
    episode_registry = None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("manifest_path")
    p.add_argument("action", choices=["approve", "ready", "published"])
    p.add_argument("--by", required=True)
    p.add_argument("--notes")
    p.add_argument("--url")
    args = p.parse_args()

    with open(args.manifest_path) as f:
        m = json.load(f)

    try:
        if args.action == "approve":
            m = manifest_mod.human_approve(m, args.by, note=args.notes)
        elif args.action == "ready":
            m = manifest_mod.human_mark_ready_to_upload(m, args.by, note=args.notes)
        else:
            m = manifest_mod.human_mark_published(m, args.by, url=args.url)
    except manifest_mod.StateError as e:
        print(f"Blocked: {e}")
        sys.exit(1)

    try:
        import hydi_bridge
        if args.action == "published":
            hydi_bridge.publication_event(m)
        else:
            hydi_bridge.approval_event(m, args.action, args.by)
    except Exception as e:
        print(f"[hydi] best-effort event emit failed (non-fatal): {e}")

    if episode_registry is not None and m.get("episode_id"):
        try:
            episode_registry.update_status(m["episode_id"], m["state"], published_at=m.get("published_at"))
        except ValueError as e:
            print(f"[registry] {e} (non-fatal -- manifest is still the source of truth)")

    package_dir = os.path.dirname(os.path.abspath(args.manifest_path))
    manifest_mod.save_manifest(m, package_dir)
    print(f"OK -- {args.manifest_path} is now {m['state']}")


if __name__ == "__main__":
    main()
