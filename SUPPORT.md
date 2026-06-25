# Support

## How to get help

### Bug reports and feature requests

Use [GitHub Issues](https://github.com/waveformer1984/HYDI-System-v2/issues) for:
- Reproducible bugs (include steps to reproduce, expected vs. actual behaviour, and relevant logs)
- Feature requests
- Pipeline correctness issues (incorrect classification, unexpected KILO output, PolicyEngine decisions)

Before opening an issue, please search existing issues to avoid duplicates.

### Security vulnerabilities

**Do not open a public GitHub issue for security vulnerabilities.** Report them privately to **waveformer1984@gmail.com** with the subject line `[SECURITY] HYDI-System-v2`. See [SECURITY.md](SECURITY.md) for the full policy.

### General questions

For questions about architecture, configuration, or usage that are not bugs, email **waveformer1984@gmail.com** with the subject line `[HYDI] <your topic>`.

## Useful references

| Resource | Location |
|----------|----------|
| Architecture overview | [HEIDI_V2_ARCHITECTURE.md](HEIDI_V2_ARCHITECTURE.md) |
| Grounded architecture | [GROUNDED_ARCHITECTURE.md](GROUNDED_ARCHITECTURE.md) |
| AI assistant reference | [CLAUDE.md](CLAUDE.md) |
| Contributing guide | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Security policy | [SECURITY.md](SECURITY.md) |

## Diagnostics

Before reporting an issue, run the built-in health check:

```bash
./verify-supabase.sh    # Verifies Supabase connectivity and key tables
npm run typecheck       # TypeScript type errors
npm test                # Unit test suite
```

Include the output of `verify-supabase.sh` and the failing test names in any bug report.

## What is and is not in scope

**In scope for GitHub Issues:**
- Bugs in the six-layer pipeline (Ingestion, RAW LEDGER, CASCADE, KILO, ProtoForge, Emission)
- PolicyEngine DSL rule evaluation errors
- Worker registration and orchestration bugs
- API route regressions
- CI/CD workflow failures

**Not in scope for GitHub Issues:**
- Supabase infrastructure outages (contact [Supabase support](https://supabase.com/support))
- Stripe billing issues (contact [Stripe support](https://support.stripe.com))
- Vercel deployment failures unrelated to this codebase
