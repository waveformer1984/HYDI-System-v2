# HYDI Worker Architecture

## Overview

The HYDI system now runs on a queue-based worker architecture that provides reliability, scalability, and clear separation of concerns. This replaces the previous synchronous processing that was prone to failures and bottlenecks.

## Architecture Flow

```
Webhooks → Queue → Task Router → Workers → Event Bus → Notifications/Feedback
```

## Core Components

### 1. Queue System (`queue-system.sql`)
- Postgres-based queue implementation
- Partitioned tables for performance
- Built-in retry logic and error handling
- Priority-based task processing

### 2. Queue Manager (`QueueManager.js`)
- Abstracts queue operations
- Handles worker registration and heartbeats
- Provides task enqueue/dequeue methods

### 3. Core Workers

#### Revenue Ingestion Worker (`RevenueIngestionWorker.js`)
- Processes Stripe webhook events
- Updates customer and subscription data
- Tracks revenue metrics
- Triggers provisioning workflows

#### Task Router Worker (`TaskRouterWorker.js`)
- The "brain" of the system
- Analyzes tasks and routes to appropriate workers
- Uses ML-like heuristics for unknown tasks
- Maintains routing statistics

#### Event Bus Worker (`EventBusWorker.js`)
- Central nervous system
- Publishes/subscribes to events
- Supports wildcards and patterns
- Maintains event history

### 4. Supporting Components

#### Webhook Queue Adapter (`WebhookQueueAdapter.js`)
- Bridges webhooks to queue system
- Provides immediate queuing for webhooks
- Handles duplicate detection
- Supports webhook replay

#### Worker Orchestrator (`WorkerOrchestrator.js`)
- Manages all workers
- Handles scaling and restarts
- Monitors health
- Reports metrics

## Worker Ecosystem

### ProtoForge Workers (Production Layer)
1. **Revenue Ingestion** ✅ - Turns Stripe events into data
2. **Provisioning** - Turns payments into access
3. **Fabrication** - Handles build tasks
4. **Inventory** - Tracks materials/resources
5. **Cost & Margin** - Calculates profitability

### HEIDI Workers (Intelligence Layer)
6. **Task Router** ✅ - Routes tasks intelligently
7. **Opportunity Detection** - Finds revenue opportunities
8. **Behavior & Pattern** - Learns system performance
9. **Anomaly Detection** - Stops silent failures
10. **Decision Assist** - Provides recommendations

### URSULA Workers (Communication Layer)
11. **Event Bus** ✅ - Connects all systems
12. **Security & Identity** - Manages auth/permissions
13. **Sync** - Keeps systems aligned
14. **Notification** - Sends alerts/updates
15. **Audit & Logging** - Records all actions

## Getting Started

### 1. Set up the database
```bash
psql -h your-db-host -U postgres -d your-db -f workers/queue-system.sql
```

### 2. Start the orchestrator
```bash
node workers/WorkerOrchestrator.js
```

### 3. Start individual workers (for testing)
```bash
node workers/RevenueIngestionWorker.js
node workers/TaskRouterWorker.js
node workers/EventBusWorker.js
```

## Configuration

Environment variables:
- `SUPABASE_URL`: Your Supabase URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key
- `WEBHOOK_PROCESSING_ENABLED`: Set to 'true' to enable webhooks

## Monitoring

### Queue Statistics
```javascript
const queue = new QueueManager();
await queue.initialize();
const stats = await queue.getQueueStats();
console.log(stats);
```

### Worker Health
```javascript
const orchestrator = new WorkerOrchestrator();
const status = await orchestrator.getWorkerStatus();
console.log(status);
```

## Scaling

### Horizontal Scaling
Workers can be scaled horizontally by running multiple instances:

```javascript
await orchestrator.scaleWorker('revenue_ingestion', 'up');
```

### Auto-scaling (Future)
The system is designed to support auto-scaling based on queue depth and worker load.

## Error Handling

- Workers automatically retry failed tasks (up to 3 times by default)
- Failed tasks are logged with error details
- Critical workers are automatically restarted on failure
- Dead letter queue for permanently failed tasks

## Performance

- Queue operations use `FOR UPDATE SKIP LOCKED` to prevent contention
- Tables are partitioned by queue name
- Indexes optimize common query patterns
- Workers poll at different intervals based on priority

## Security

- All queue operations use RLS policies
- Service role only access to queue tables
- Webhook signatures verified before queuing
- Worker authentication via heartbeat tokens

## Future Enhancements

1. **Remaining Workers**: Implement the 12 unimplemented workers
2. **Real-time Updates**: Use Postgres LISTEN/NOTIFY for instant task availability
3. **Distributed Tracing**: Add request IDs across all workers
4. **Circuit Breakers**: Prevent cascade failures
5. **Batch Processing**: Process multiple tasks together for efficiency
6. **Priority Queues**: Separate queues for different priority levels

## Troubleshooting

### Workers not processing tasks
1. Check worker heartbeats in `worker_status` table
2. Verify queue tables have data
3. Check worker logs for errors

### Tasks stuck in "processing" state
1. Workers may have crashed
2. Check for stale heartbeats
3. Manually reset stuck tasks if needed

### High memory usage
1. Reduce event history size
2. Adjust polling intervals
3. Add more worker instances

## Migration from Old System

The old synchronous webhook handler has been updated to use the queue system. The change is backward compatible - webhooks will return immediately after queuing, and processing happens asynchronously.
