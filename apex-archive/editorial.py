"""
Editorial intelligence -- advisory topic scoring, feeding Step 3's topic selection.
This is a RECOMMENDATION layer only. It has no authority: it cannot approve, publish,
skip QA, or bypass any gate in manifest.py. Its only effect is which topic the
scheduler tries first; the deterministic rotation in Step 3 remains the guaranteed
fallback if scoring has nothing useful to say (which, honestly, is the common case
today -- there's no analytics data yet).

score_topics() returns a recommendation per pillar: MAKE_MORE / REFINE / DEPRIORITIZE
/ AVOID / INSUFFICIENT_DATA. With zero ANALYZED episodes in the registry (the current
reality), every pillar reports INSUFFICIENT_DATA -- this module does not pretend to
have signal it doesn't have.
"""

RECOMMENDATIONS = {"MAKE_MORE", "REFINE", "DEPRIORITIZE", "AVOID", "INSUFFICIENT_DATA"}
MIN_ANALYZED_SAMPLES = 3  # below this, a pillar's data is too thin to score


def score_topics(registry_records):
    """registry_records: the list from episode_registry.load_registry().
    Returns {pillar: {"recommendation": ..., "sample_size": n, "reasoning": "..."}}."""
    by_pillar = {}
    for r in registry_records:
        pillar = r.get("pillar", "unknown")
        by_pillar.setdefault(pillar, []).append(r)

    scores = {}
    for pillar, records in by_pillar.items():
        analyzed = [r for r in records if r.get("status") == "ANALYZED"]
        if len(analyzed) < MIN_ANALYZED_SAMPLES:
            scores[pillar] = {
                "recommendation": "INSUFFICIENT_DATA",
                "sample_size": len(analyzed),
                "reasoning": f"only {len(analyzed)} analyzed episode(s) for '{pillar}', "
                             f"need >= {MIN_ANALYZED_SAMPLES} before scoring is meaningful",
            }
            continue
        scores[pillar] = {
            "recommendation": "INSUFFICIENT_DATA",
            "sample_size": len(analyzed),
            "reasoning": "scoring model not yet implemented against real metrics -- "
                         "wire this up once ANALYZED episodes carry real analytics data",
        }
    return scores


def recommend_for_pillar(registry_records, pillar):
    scores = score_topics(registry_records)
    return scores.get(pillar, {
        "recommendation": "INSUFFICIENT_DATA", "sample_size": 0, "reasoning": f"no history for pillar '{pillar}'",
    })
