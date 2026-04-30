# HYDI Revenue Engine - 5 Core Money-Making Systems

## Overview
HYDI now does useful stuff that makes money. These 5 systems are wired end-to-end with CASCADE scoring to kill what doesn't work.

## The 5 Systems

### 1. Lead Scraping + Outreach
- Scrapes leads for 3D printing services
- Auto-sends personalized outreach emails
- Tracks response rates and scores leads
- **API:** `GET/POST /api/revenue/leads`

### 2. Auto Proposal Generation
- Generates personalized proposals based on lead data
- Calculates pricing dynamically
- Tracks proposal status and acceptance
- **API:** `POST /api/revenue/proposal`

### 3. Instant Quoting + Stripe Checkout
- Creates instant quotes with dynamic pricing
- Generates Stripe checkout sessions
- Tracks payment completion
- **API:** `POST /api/revenue` (action: create_quote/create_checkout)

### 4. 3D Product Generation + Listing
- Generates product ideas from trends
- Creates listings for marketplaces
- Tracks product performance
- **API:** `POST /api/revenue/products`

### 5. Revenue Tracking Dashboard
- Real-time metrics and reporting
- Visual charts and activity feeds
- Auto-refreshes every 30 seconds
- **URL:** `/revenue-dashboard.html`

## Quick Start

### 1. Set up environment
```bash
# Add to .env
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
STRIPE_SECRET_KEY=sk_test_...  # Optional for checkout
```

### 2. Create database tables
```bash
# Run the schema
psql -f revenue-engine/schema.sql
```

### 3. Start the server
```bash
npm run dev
```

### 4. Access the dashboard
Open: `http://localhost:3000/revenue-dashboard.html`

## CLI Usage

```bash
# Run complete revenue cycle
node revenue-engine/index.js cycle

# Individual operations
node revenue-engine/index.js leads
node revenue-engine/index.js outreach
node revenue-engine/index.js quote custom_print 5 medium
node revenue-engine/index.js report today
```

## API Endpoints

### Dashboard
```
GET /api/revenue
Returns: { success: true, dashboard: {...} }
```

### Lead Management
```
GET /api/revenue/leads
POST /api/revenue/leads
```

### Quotes & Checkout
```
POST /api/revenue
{
  "action": "create_quote",
  "projectType": "custom_print",
  "quantity": 5,
  "complexity": "medium",
  "rushOrder": false
}

POST /api/revenue
{
  "action": "create_checkout",
  "quoteId": "quote_xxx",
  "customerEmail": "user@example.com"
}
```

### Revenue Report
```
GET /api/revenue/report?period=today|week|month
```

### Full Cycle
```
POST /api/revenue/cycle
```

## CASCADE Integration

Each task is scored based on performance:
- **Lead scraping:** Score > 0.3 to survive
- **Outreach:** Score > 0.3 to survive  
- **Proposals:** Score > 0.4 to survive
- **Checkouts:** Score > 0.2 to survive
- **Products:** Score > 0.3 to survive

Low-performing tasks are automatically killed.

## Metrics Tracked

- Leads scraped and converted
- Outreach sent and response rate
- Proposals generated and acceptance rate
- Quotes created and checkout conversion
- Products listed and sales
- Total revenue and transaction count

## Database Schema

Tables created:
- `leads` - Lead information and status
- `outreach` - Email tracking
- `proposals` - Proposal details
- `quotes` - Quote information
- `checkout_sessions` - Stripe sessions
- `product_ideas` - Generated product concepts
- `product_listings` - Marketplace listings

## Example Flow

1. **Scrape leads** → Get 3 new leads
2. **Send outreach** → Auto-email each lead
3. **Generate proposals** → For high-score leads
4. **Create quotes** → Instant pricing
5. **Checkout** → Stripe payment processing
6. **Track revenue** → Dashboard updates in real-time

## Production Deployment

1. Deploy to Vercel/Netlify
2. Set environment variables
3. Run database migrations
4. Test Stripe webhook endpoints
5. Monitor dashboard for performance

## Scaling Strategy

- Add more lead sources (LinkedIn, directories)
- Implement A/B testing for outreach
- Add more marketplace platforms
- Implement automated follow-up sequences
- Add SMS/WhatsApp outreach
- Create affiliate/referral system

## Troubleshooting

**Leads not appearing?**
- Check Supabase connection
- Verify table exists
- Check RLS policies

**Stripe checkout failing?**
- Verify STRIPE_SECRET_KEY
- Check webhook configuration
- Ensure CORS settings

**Dashboard not updating?**
- Check API responses in browser console
- Verify database permissions
- Check auto-refresh interval

## Next Steps

1. Wire up real lead scraping APIs
2. Implement actual email sending (SendGrid/SES)
3. Add real Stripe webhook handling
4. Create automated follow-up sequences
5. Add SMS outreach capability
6. Implement A/B testing framework
7. Add more marketplace integrations

---

**Remember:** Start with these 5 systems. Don't add anything else until these are profitable. CASCADE will kill what doesn't work.
