# HYDI Production Deployment Checklist

## Pre-Deployment (T-Minus 24 Hours)

### Infrastructure
- [ ] **Database Migrations**: Run `database-migrations.sql` in Supabase SQL Editor
- [ ] **Read Replica**: Set up read replica in Supabase dashboard (if >100 users expected)
- [ ] **Performance Indexes**: Verify indexes created (`type`, `timestamp`, `event_id`)
- [ ] **RLS Policies**: Confirm Row Level Security is enabled and policies are correct
- [ ] **SSL Certificates**: Configure SSL certificates for nginx (if using HTTPS)
- [ ] **Domain Configuration**: Set up DNS records for load balancer

### Secrets Management
- [ ] **Environment Variables**: Create `.env.production` with production values
- [ ] **Vault Integration**: Move secrets to HashiCorp Vault or AWS Secrets Manager
- [ ] **Service Role Key**: Ensure SUPABASE_SERVICE_ROLE_KEY is secured
- [ ] **API Keys**: Rotate any test API keys to production keys

### Monitoring Setup
- [ ] **Prometheus**: Configure monitoring targets
- [ ] **Grafana**: Set up dashboards for HYDI metrics
- [ ] **Alert Rules**: Deploy `hydi_alerts.yml`
- [ ] **PagerDuty/Slack**: Configure alert routing
- [ ] **Log Aggregation**: Set up ELK stack or similar

## Dark Launch (T-Minus 24 Hours)

### Heartbeat Verification
- [ ] **Start Heartbeat**: Run `node heartbeat.js start`
- [ ] **Monitor Persistence**: Verify heartbeats appear in Supabase within 30 seconds
- [ ] **SSE Verification**: Check Ursula dashboard shows real-time updates
- [ ] **Stats Collection**: Confirm heartbeat stats are accurate
- [ ] **Run for 24 Hours**: Let heartbeat run continuously for 24 hours

## Soft Launch (Hour 0)

### Traffic Configuration
- [ ] **Single Data Source**: Connect one primary data source
- [ ] **Rate Limiting**: Verify nginx rate limiting is active
- [ ] **CORS Policy**: Confirm CORS headers are correct
- [ ] **Health Checks**: Monitor all health endpoints
- [ ] **Error Monitoring**: Watch for any 4xx/5xx errors

### Performance Validation
- [ ] **Latency Check**: Ensure <200ms persistence latency
- [ ] **Throughput Test**: Verify expected event volume
- [ ] **Memory Usage**: Monitor container memory usage
- [ ] **Database Pool**: Check connection pool utilization
- [ ] **SSE Stability**: Verify dashboard connections stay alive

## Full Throttle (Hour 6)

### Public Launch
- [ ] **Open Endpoints**: Enable all ingestion endpoints
- [ ] **Public Dashboard**: Make Ursula dashboard publicly accessible
- [ ] **Load Testing**: Run load test with expected traffic
- [ ] **Scaling Verification**: Confirm auto-scaling works (if configured)
- [ ] **Backup Verification**: Ensure database backups are running

### Security Hardening
- [ ] **Firewall Rules**: Restrict access to authorized IPs only
- [ ] **DDoS Protection**: Enable DDoS protection (Cloudflare/AWS Shield)
- [ ] **Input Validation**: Verify all inputs are sanitized
- [ ] **SQL Injection**: Confirm RLS prevents SQL injection
- [ ] **Authentication**: Check auth mechanisms are working

## Post-Launch (First 48 Hours)

### Monitoring
- [ ] **Alert Response**: Test alert response procedures
- [ ] **Performance Baseline**: Establish performance baselines
- [ ] **Error Tracking**: Monitor error rates and patterns
- [ ] **User Feedback**: Collect and track user feedback
- [ ] **Resource Usage**: Monitor CPU, memory, and storage usage

### Backup & Recovery
- [ ] **Database Backups**: Verify automated backups are working
- [ ] **Point-in-Time Recovery**: Test recovery procedures
- [ ] **Disaster Recovery**: Run disaster recovery drill
- [ ] **Data Retention**: Confirm data retention policies
- [ ] **Compliance**: Verify compliance requirements are met

## Ongoing Operations

### Daily Checks
- [ ] **Health Status**: Check all service health endpoints
- [ ] **Error Rates**: Review error rates for anomalies
- [ ] **Performance Metrics**: Monitor latency and throughput
- [ ] **Resource Utilization**: Check CPU, memory, disk usage
- [ ] **Backup Status**: Verify backups completed successfully

### Weekly Maintenance
- [ ] **Log Rotation**: Check log rotation is working
- [ ] **Security Updates**: Apply security patches
- [ ] **Performance Tuning**: Review and optimize performance
- [ ] **Capacity Planning**: Assess capacity needs
- [ ] **Documentation Updates**: Update operational documentation

### Monthly Reviews
- [ ] **Security Audit**: Conduct security audit
- [ ] **Performance Review**: Analyze performance trends
- [ ] **Cost Analysis**: Review cloud costs
- [ ] **Disaster Recovery Test**: Run full disaster recovery test
- [ ] **Architecture Review**: Review architecture for improvements

## Emergency Procedures

### Kill Switch Protocol
1. **Divert Traffic**: Point to Redis buffer/message queue
2. **Stop Processor**: Stop HYDI processor
3. **Fix Issue**: Address the root cause
4. **Replay Events**: Drain buffer back to processor
5. **Resume Normal**: Restore normal operation

### Rollback Procedure
1. **Execute**: `./deploy.sh rollback`
2. **Verify**: Check blue environment health
3. **Monitor**: Watch for error resolution
4. **Communicate**: Notify stakeholders of rollback

### Contact Information
- **On-Call Engineer**: [Phone/Slack]
- **Database Admin**: [Phone/Slack]
- **Infrastructure Lead**: [Phone/Slack]
- **Product Manager**: [Phone/Slack]

## Success Criteria

### Technical Metrics
- [ ] **99.9% Uptime**: All services maintain 99.9% uptime
- [ ] **<200ms Latency**: Event persistence latency <200ms
- [ ] **Zero Data Loss**: No events lost during deployment
- [ ] **SSE Stability**: Dashboard connections stable
- [ ] **Auto-Recovery**: System recovers automatically from failures

### Business Metrics
- [ ] **User Satisfaction**: User feedback scores >4.5/5
- [ ] **Event Volume**: Process expected event volume
- [ ] **Dashboard Usage**: Dashboard adoption rate >80%
- [ ] **Error Rate**: User-reported errors <1%
- [ ] **Performance**: Page load times <2 seconds

---

## Deployment Commands

```bash
# Full deployment
./deploy.sh deploy

# Rollback
./deploy.sh rollback

# Check status
./deploy.sh status

# View logs
./deploy.sh logs [service-name]

# Start heartbeat (dark launch)
node heartbeat.js start

# Stop heartbeat
node heartbeat.js stop

# View heartbeat stats
node heartbeat.js stats
```

---

**Last Updated**: 2026-04-21
**Version**: 1.0.0
**Environment**: Production
