# HYDI Bootstrap System

A comprehensive bootstrap process for HYDI that creates a local system capable of expanding outward to Supabase, Cascade, and the world.

## Overview

The HYDI Bootstrap System provides a phased approach to initializing HYDI:

1. **Local Phase** - Initialize local HYDI components
2. **Supabase Phase** - Connect to Supabase for persistence
3. **Cascade Phase** - Enable Cascade integration for bidirectional communication
4. **World Phase** - Connect to external APIs and webhooks

## Quick Start

```bash
# Full bootstrap (all phases)
node hydi-bootstrap.js --mode=full

# Local only
node hydi-bootstrap.js --mode=local

# Local + Supabase
node hydi-bootstrap.js --mode=supabase

# Local + Cascade
node hydi-bootstrap.js --mode=cascade

# Local + World connectivity
node hydi-bootstrap.js --mode=world

# Verbose output
node hydi-bootstrap.js --mode=full --verbose
```

## Bootstrap Phases

### Phase 1: Local System
- ✅ Express server initialization
- ✅ Local model adapter
- ✅ Module system
- ✅ Event bus
- ✅ Health monitoring

### Phase 2: Supabase Integration
- ✅ Database connection
- ✅ Real-time subscriptions
- ✅ Bidirectional sync
- ✅ Conflict resolution
- ✅ Backup/recovery

### Phase 3: Cascade Integration
- ✅ Event bridge
- ✅ Message routing
- ✅ Protocol adaptation
- ✅ Bidirectional communication
- ✅ Health monitoring

### Phase 4: World Connectivity
- ✅ External API connections (Stripe, monitoring)
- ✅ Webhook management
- ✅ Rate limiting
- ✅ Circuit breaking
- ✅ Event processing

## Configuration

### Environment Variables

Required for full functionality:

```bash
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key

# Stripe (for world connectivity)
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret

# Monitoring (optional)
MONITORING_ENDPOINT=your_monitoring_endpoint
MONITORING_API_KEY=your_monitoring_api_key

# Cascade (optional)
CASCADE_API_KEY=your_cascade_api_key
```

### Configuration Files

- `config/supabase-expansion.json` - Supabase expansion configuration
- `.env` - Environment variables
- `package.json` - Dependencies

## Components

### Bootstrap Script (`hydi-bootstrap.js`)
Main orchestrator that:
- Checks prerequisites
- Installs dependencies
- Initializes components by phase
- Performs health checks
- Provides status reporting

### Supabase Expansion Manager (`modules/supabase-expansion-manager.js`)
Manages local-to-Supabase expansion:
- Bidirectional sync
- Conflict resolution
- Real-time subscriptions
- Health monitoring

### Cascade Integration Bridge (`modules/cascade-integration-bridge.js`)
Handles Cascade communication:
- Event translation
- Message routing
- Protocol adaptation
- Retry mechanisms

### World Connectivity Manager (`modules/world-connectivity-manager.js`)
Manages external connections:
- API integrations
- Webhook processing
- Rate limiting
- Circuit breaking

## Access Points

Once bootstrapped, HYDI provides these endpoints:

- **Local Server**: `http://localhost:3005`
- **Health Check**: `http://localhost:3005/health`
- **Heidi Insights**: `http://localhost:3005/heidi/insights`
- **Event Processing**: `http://localhost:3005/process`
- **Event Streaming**: `http://localhost:3005/events/stream`

## Monitoring and Health

### Health Checks
The system performs continuous health checks on:
- Local server status
- Supabase connectivity
- Cascade bridge status
- External API health

### Metrics
Tracks:
- Request success/failure rates
- Response times
- Event processing rates
- Circuit breaker status

### Alerts
Configurable alerts for:
- Service failures
- High error rates
- Circuit breaker trips
- Queue buildup

## Troubleshooting

### Common Issues

1. **Server startup timeout**
   - Check for port conflicts
   - Verify dependencies are installed
   - Check environment variables

2. **Supabase connection failed**
   - Verify SUPABASE_URL and keys
   - Check network connectivity
   - Validate database permissions

3. **Module not found errors**
   - Run `npm install`
   - Check file paths in configuration
   - Verify all required modules exist

4. **Webhook verification failures**
   - Check webhook secrets
   - Verify signature generation
   - Ensure proper headers

### Debug Mode

Enable verbose logging:
```bash
node hydi-bootstrap.js --mode=full --verbose
```

### Manual Component Testing

Test individual components:

```bash
# Test Supabase connection
node -e "require('./modules/supabase-expansion-manager').testConnection()"

# Test Cascade bridge
node -e "require('./modules/cascade-integration-bridge').testConnection()"

# Test world connectivity
node -e "require('./modules/world-connectivity-manager').testConnections()"
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Local HYDI    │    │    Supabase     │    │    Cascade      │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │◄──►│ ┌─────────────┐ │◄──►│ ┌─────────────┐ │
│ │   Server    │ │    │ │  Database   │ │    │ │   Bridge    │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │   Models    │ │    │ │   Storage   │ │    │ │   Events    │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │   Modules   │ │    │ │   Auth      │ │    │ │   Messages  │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │      World      │
                    │                 │
                    │ ┌─────────────┐ │
                    │ │   APIs      │ │
                    │ └─────────────┘ │
                    │ ┌─────────────┐ │
                    │ │  Webhooks   │ │
                    │ └─────────────┘ │
                    │ ┌─────────────┐ │
                    │ │ Monitoring  │ │
                    │ └─────────────┘ │
                    └─────────────────┘
```

## Security Considerations

- API keys stored in environment variables
- Webhook signature verification
- Rate limiting on external calls
- Circuit breaker protection
- Sensitive data filtering

## Performance

- Async event processing
- Connection pooling
- Retry mechanisms with exponential backoff
- Health monitoring with automatic recovery
- Graceful degradation

## Extending the System

### Adding New Expansion Phases

1. Create new manager module
2. Add phase configuration
3. Update bootstrap script
4. Add health checks
5. Document integration

### Adding New External Services

1. Add service configuration
2. Implement connection test
3. Add webhook handler if needed
4. Update rate limiting rules
5. Add monitoring metrics

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review verbose logs
3. Verify configuration
4. Test individual components
5. Check system prerequisites

---

**Status**: ✅ Fully Operational  
**Version**: 1.0.0  
**Last Updated**: 2026-04-30
