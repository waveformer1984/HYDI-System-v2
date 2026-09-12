import json
import os
import sys

import manifest as manifest_mod
import qa_check
import verify_package
import episode_registry
import hydi_bridge

EPISODE_ID = sys.argv[1]
SCRIPT_PATH = "script.json"
RENDER_PATH = f"{EPISODE_ID}.mp4"
DURATIONS_PATH = f"{EPISODE_ID}.durations.json"
OUT_DIR = os.path.join("episodes", EPISODE_ID)

with open(SCRIPT_PATH) as f:
    script = json.load(f)
with open(DURATIONS_PATH) as f:
    durations = json.load(f)

m = manifest_mod.create_manifest(EPISODE_ID, script["title"], script["pillar"], script["topic_slug"], script["format"])
print("created manifest, state:", m["state"])

m = manifest_mod.record_fact_check(m, script)
print("record_fact_check ok, state:", m["state"], "needs_manual_review:", m["needs_manual_review"])

m = manifest_mod.record_script(m, script)
print("record_script ok, state:", m["state"])

m["segment_durations"] = durations["seg_durations"]
m = manifest_mod.record_generated(m, RENDER_PATH, durations["tts_provider"])
print("record_generated ok, state:", m["state"], "tts_provider:", m["tts_provider"])

qa_result = qa_check.run_qa(RENDER_PATH, expected_format=script["format"])
m = manifest_mod.record_qa(m, qa_result)
print("record_qa ok, state:", m["state"], "qa passed:", qa_result["passed"])

m = manifest_mod.record_package(m, SCRIPT_PATH, RENDER_PATH, OUT_DIR)
print("record_package ok, state:", m["state"], "package_dir:", m["package_dir"])

manifest_mod.save_manifest(m, OUT_DIR)
print("saved manifest.json (pre-verification snapshot)")

manifest_path = os.path.join(OUT_DIR, "manifest.json")
with open(manifest_path) as f:
    m_reloaded = json.load(f)

verify_results = verify_package.check_package(OUT_DIR, m_reloaded)
n_pass = sum(1 for r in verify_results if r["passed"])
n_total = len(verify_results)
print(f"verify_package: {n_pass}/{n_total} passed")
for r in verify_results:
    if not r["passed"]:
        print("  FAIL:", r["check"], "--", r["detail"])

if n_pass != n_total:
    print("VERIFICATION FAILED -- stopping, not advancing state.")
    sys.exit(1)

m = manifest_mod.record_verification(m, verify_results)
print("record_verification ok, state:", m["state"])

hydi_bridge.episode_verified(m, {"n_pass": n_pass, "n_total": n_total})
manifest_mod.save_manifest(m, OUT_DIR)

m = manifest_mod.advance_to_human_review(m)
print("advance_to_human_review ok, state:", m["state"])

hydi_bridge.project_status(m)
hydi_bridge.orchestration_ping(m)
manifest_mod.save_manifest(m, OUT_DIR)
print("final manifest saved, state:", m["state"])

reg_record = episode_registry.register_episode(
    EPISODE_ID, m["title"], m["topic_slug"], m["pillar"], m["script_sha256"],
    [s["url"] for s in m["sources"]], m["state"], manifest_path,
)
print("registered episode:", reg_record["episode_id"], reg_record["status"])

print("DONE")
