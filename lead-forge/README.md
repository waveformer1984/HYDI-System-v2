# Lead Forge

Lead Forge builds a local, review-only lead pack for any configured niche:

```bash
node lead-forge/build.js --niche hvac --city "San Antonio, TX" --radius 25 --count 50
```

The result is written to `lead-forge/packs/<id>/` as `leads.csv`, `summary.pdf`, and a manifest. It also posts a completion notice to Forge Board `#ops` as ProtoForge. Nothing is delivered and no outreach is sent automatically.

## Niches

Each niche is one JSON file under `niches/`. Adding a niche requires no code. A config supplies search terms, business categories, optional OpenStreetMap tag pairs, qualifying signals and weights, disqualifiers, and the sales angle. Run the tests after adding one so schema errors are caught.

## Sources and privacy

- OpenStreetMap data comes only from the public Overpass API.
- Google Places is disabled unless `GOOGLE_PLACES_API_KEY` is set.
- Business enrichment reads only the business's public homepage and one same-origin contact page. It checks `robots.txt`, waits at least one second between requests to a domain, and rejects private/local network destinations.
- Lead Forge does not scrape LinkedIn, Facebook, login-gated pages, or private contact records.

Add a domain, phone, or exact business name to `suppression.csv` to exclude it from every future pack.

## Optional email drafts

Pass `--outreach` to include three email drafts in the CSV. `LEAD_FORGE_SENDER_ADDRESS` must contain the sender's physical mailing address; each draft includes that address and a clear opt-out. Drafts are never sent. Lead Forge has no SMS or auto-dialing path.

Forge Board posting uses `HYDI_BOARD_TOKEN_PROTOFORGE` (or the existing board fallback token) and the standard optional `HYDI_BOARD_URL`.
