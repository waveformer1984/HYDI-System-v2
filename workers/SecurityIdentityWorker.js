const { createClient } = require('@supabase/supabase-js');
const QueueManager = require('./QueueManager');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const logger = require('../lib/structured-logger').child({ component: 'SecurityIdentityWorker' });

class SecurityIdentityWorker {
    constructor(workerId) {
        this.workerId = workerId || `security-identity-worker-${Date.now()}`;
        this.running = false;
        this.pollInterval = 5000;
        this.pollTimer = null;
        this.supabase = null;
        this.queue = new QueueManager();
        this.securityConfig = {
            // No hardcoded fallback -- a publicly-known default secret here would let
            // anyone forge valid auth JWTs for whatever this worker gates. Fail closed
            // instead (see initialize() below).
            jwtSecret: process.env.JWT_SECRET || null,
            tokenExpiry: '24h',
            rateLimiting: { enabled: true, maxRequestsPerMinute: 60 },
            session: { timeoutMinutes: 60, renewThreshold: 10 }
        };

        this.initialize = function() {
            if (!this.securityConfig.jwtSecret) throw new Error('Missing JWT_SECRET');
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');
            this.supabase = createClient(supabaseUrl, supabaseKey);
            this.queue.registerWorker('security_identity', this.workerId);
            this.queue.updateHeartbeat('idle');
            logger.info('Security Identity Worker initialized', { workerId: this.workerId });
        };

        this.start = async function() {
            if (this.running) return;
            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            if (this.pollTimer) clearTimeout(this.pollTimer);
            await this.queue.shutdown();
        };

        this.poll = function() {
            if (!this.running) return;
            this.processNextTask()
                .catch(err => logger.error('Security Identity Worker poll error', { error: err }))
                .finally(() => { this.pollTimer = setTimeout(() => this.poll(), this.pollInterval); });
        };

        this.processNextTask = async function() {
            const taskId = await this.queue.dequeue('security_identity');
            if (!taskId) return;
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) return;
                switch (task.payload.event_type) {
                    case 'auth.attempt': await this.processAuthentication(task.payload); break;
                    case 'token.validate': await this.validateToken(task.payload); break;
                    case 'permission.check': await this.checkPermission(task.payload); break;
                    case 'rate_limit.check': await this.checkRateLimit(task.payload); break;
                    case 'session.refresh': await this.refreshSession(task.payload); break;
                    case 'security.audit': await this.performSecurityAudit(task.payload); break;
                    default: logger.info('Unhandled security event type', { eventType: task.payload.event_type });
                }
                await this.queue.completeTask(taskId, true);
            } catch (err) {
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.checkTokenPermission = async function(decoded, endpoint, required_permission) {
            // No RBAC implementation exists yet. Returning true unconditionally
            // would let any validly-signed JWT pass every permission check
            // regardless of what it was actually issued for. Fail closed until
            // real per-token permission logic is implemented (see ISSUES_FOUND.md #44).
            return false;
        };

        this.processAuthentication = async function(payload) {
            const { email, ip_address, user_agent } = payload.data;
            logger.info('Processing authentication', { email });
            // This event's payload carries no password/API-key/credential to
            // verify against anything -- and this codebase has no user/password
            // schema at all (its actual identity model is API-key based, see
            // src/middleware/keymaker.js and the `api_keys` table). Simulating
            // success regardless of input would let anyone impersonate any
            // email. Fail closed and log the attempt as rejected until real
            // credential verification is designed and wired up (see
            // ISSUES_FOUND.md #44) -- never issue a token from here.
            const failureReason = 'no credential verification implemented for auth.attempt; rejecting';
            try {
                await this.supabase
                    .from('auth_attempts')
                    .insert({
                        email: email,
                        ip_address: ip_address,
                        user_agent: user_agent,
                        success: false,
                        failure_reason: failureReason,
                        attempted_at: new Date()
                    });
            } catch (error) {
                logger.error('Failed to log rejected auth attempt', { email, error });
            }
            logger.info('Auth rejected', { email, failureReason });
        };

        this.validateToken = async function(payload) {
            const { token, endpoint, required_permission } = payload.data;
            
            logger.info('Validating token', { endpoint });
            
            // validate-token-details
            try {
                const decoded = jwt.verify(token, this.securityConfig.jwtSecret);
                
                // check-token-permissions
                // Check if token has required permission for endpoint
                const hasPermission = await this.checkTokenPermission(decoded, endpoint, required_permission);
                
                if (hasPermission) {
                    // Token is valid and has permission
                    await this.supabase
                        .from('token_validations')
                        .insert({
                            token_id: decoded.jti || 'unknown',
                            email: decoded.email,
                            endpoint: endpoint,
                            required_permission: required_permission,
                            granted_permission: true,
                            validated_at: new Date()
                        });
                    
                    logger.info('Token valid', { email: decoded.email, endpoint });
                } else {
                    // Token valid but insufficient permissions
                    await this.supabase
                        .from('token_validations')
                        .insert({
                            token_id: decoded.jti || 'unknown',
                            email: decoded.email,
                            endpoint: endpoint,
                            required_permission: required_permission,
                            granted_permission: false,
                            validated_at: new Date()
                        });
                    
                    logger.info('Token valid but insufficient permissions', { email: decoded.email, endpoint });
                }
            } catch (error) {
                // Invalid or expired token
                await this.supabase
                    .from('token_validations')
                    .insert({
                        token_id: 'unknown',
                        email: 'unknown',
                        endpoint: endpoint,
                        required_permission: required_permission,
                        granted_permission: false,
                        validation_error: error.message,
                        validated_at: new Date()
                    });
                
                logger.info('Token validation failed', { error });
            }
        };

        this.checkPermission = async function(payload) {
            const { user_id, resource, action } = payload.data;
            
            logger.info('Checking permission', { action, resource, userId: user_id });
            
            // check-permission-details
            // Get user's role/permissions from database
            const { data: user } = await this.supabase
                .from('users')
                .select('role, permissions')
                .eq('id', user_id)
                .single();
            
            if (!user) {
                logger.info('User not found', { userId: user_id });
                return false;
            }
            
            // check-if-user-has-permission
            // Check if user has permission for the resource/action
            const userPermissions = user.permissions || [];
            const userRole = user.role || 'guest';
            
            // Admin has all permissions
            if (userRole === 'admin') {
                return true;
            }
            
            // check-specific-permission
            // Check specific permission
            const permissionGranted = userPermissions.includes(action) || 
                                    userPermissions.includes(`${resource}:${action}`) ||
                                    userPermissions.includes(`${resource}:*`);
            
            if (permissionGranted) {
                await this.supabase
                    .from('permission_checks')
                    .insert({
                        user_id: user_id,
                        resource: resource,
                        action: action,
                        granted: true,
                        checked_at: new Date()
                    });
                
                logger.info('Permission granted', { action, resource, userId: user_id });
                return true;
            } else {
                await this.supabase
                    .from('permission_checks')
                    .insert({
                        user_id: user_id,
                        resource: resource,
                        action: action,
                        granted: false,
                        checked_at: new Date()
                    });
                
                logger.info('Permission denied', { action, resource, userId: user_id });
                return false;
            }
        };

        this.checkRateLimit = async function(payload) {
            const { identifier, endpoint, ip_address } = payload.data;
            
            logger.info('Checking rate limit', { identifier, endpoint });
            
            // check-rate-limit-details
            if (!this.securityConfig.rateLimiting.enabled) {
                return true; // Rate limiting disabled
            }
            
            // get-current-request-count
            // Get current request count for this identifier/endpoint
            const windowStart = new Date(Date.now() - 60 * 1000); // Last minute
            
            const { data: requests } = await this.supabase
                .from('rate_limit_log')
                .select('*')
                .eq('identifier', identifier)
                .eq('endpoint', endpoint)
                .gte('timestamp', windowStart.toISOString());
            
            const currentCount = requests.length;
            const maxAllowed = this.securityConfig.rateLimiting.maxRequestsPerMinute;
            
            // check-if-over-limit
            if (currentCount >= maxAllowed) {
                await this.supabase
                    .from('rate_limit_log')
                    .insert({
                        identifier: identifier,
                        endpoint: endpoint,
                        ip_address: ip_address,
                        allowed: false,
                        timestamp: new Date()
                    });
                
                logger.info('Rate limit exceeded', { identifier, endpoint, currentCount, maxAllowed });
                return false;
            } else {
                // allow-request-and-log
                await this.supabase
                    .from('rate_limit_log')
                    .insert({
                        identifier: identifier,
                        endpoint: endpoint,
                        ip_address: ip_address,
                        allowed: true,
                        timestamp: new Date()
                    });
                
                logger.info('Request allowed', { identifier, endpoint, currentCount: currentCount + 1, maxAllowed });
                return true;
            }
        };

        this.refreshSession = async function(payload) {
            const { session_id, user_id } = payload.data;
            
            logger.info('Refreshing session', { sessionId: session_id, userId: user_id });
            
            // refresh-session-details
            // Get current session
            const { data: session } = await this.supabase
                .from('user_sessions')
                .select('*')
                .eq('session_id', session_id)
                .eq('user_id', user_id)
                .single();
            
            if (!session) {
                logger.info('Session not found', { sessionId: session_id });
                return false;
            }
            
            // check-if-session-needs-refresh
            const now = new Date();
            const expiresAt = new Date(session.expires_at);
            const timeUntilExpiry = (expiresAt - now) / (1000 * 60); // minutes
            
            const renewThreshold = this.securityConfig.session.renewThreshold;
            
            if (timeUntilExpiry <= renewThreshold) {
                // extend-session-expiry
                // Extend session
                const newExpiresAt = new Date(now.getTime() + (this.securityConfig.session.timeoutMinutes * 60 * 1000));
                
                await this.supabase
                    .from('user_sessions')
                    .update({
                        expires_at: newExpiresAt.toISOString(),
                        renewed_at: new Date(),
                        renewal_count: session.renewal_count + 1
                    })
                    .eq('session_id', session_id)
                    .eq('user_id', user_id);
                
                logger.info('Session refreshed', { sessionId: session_id, expiresInMinutes: this.securityConfig.session.timeoutMinutes });
                return true;
            } else {
                logger.info('Session does not need refresh yet', { sessionId: session_id, expiresInMinutes: Number(timeUntilExpiry.toFixed(1)) });
                return false; // No need to refresh yet
            }
        };

        this.performSecurityAudit = async function(payload) {
            const { audit_type, scope, time_period } = payload.data;
            
            logger.info('Performing security audit', { auditType: audit_type });
            
            // perform-security-audit-details
            let auditResults = {};
            
            switch (audit_type) {
                case 'authentication':
                    auditResults = await this.auditAuthentication(scope, time_period);
                    break;
                    
                case 'authorization':
                    auditResults = await this.auditAuthorization(scope, time_period);
                    break;
                    
                case 'rate_limiting':
                    auditResults = await this.auditRateLimiting(scope, time_period);
                    break;
                    
                case 'session_management':
                    auditResults = await this.auditSessionManagement(scope, time_period);
                    break;
                    
                case 'vulnerability_scan':
                    auditResults = await this.auditVulnerabilities(scope, time_period);
                    break;
                    
                default:
                    logger.info('Unknown audit type', { auditType: audit_type });
                    auditResults = { error: 'Unknown audit type' };
            }
            
            // store-audit-results
            // Store audit results
            await this.supabase
                .from('security_audits')
                .insert({
                    audit_type: audit_type,
                    scope: scope,
                    time_period: time_period,
                    results: auditResults,
                    performed_by: this.workerId,
                    performed_at: new Date()
                });
            
            logger.info('Security audit completed', { auditType: audit_type });
        };

        // helper-methods-for-security-operations
        this.auditAuthentication = async function(scope, time_period) {
            // Audit authentication attempts
            let startDate;
            if (time_period === 'today') {
                startDate = new Date();
                startDate.setHours(0, 0, 0, 0);
            } else if (time_period === 'week') {
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 7);
            } else if (time_period === 'month') {
                startDate = new Date();
                startDate.setMonth(startDate.getMonth() - 1);
            } else {
                // Default to last 30 days
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);
            }
            
            const { data: authAttempts } = await this.supabase
                .from('auth_attempts')
                .select('*')
                .gte('attempted_at', startDate.toISOString());
            
            if (scope && scope === 'failed_only') {
                // Filter to only failed attempts
                authAttempts.filter = attempt => !attempt.success;
            }
            
            const totalAttempts = authAttempts.length;
            const failedAttempts = authAttempts.filter(attempt => !attempt.success).length;
            const successRate = totalAttempts > 0 ? (totalAttempts - failedAttempts) / totalAttempts : 0;
            
            // find-top-failing-ips-or-emails
        };
    }
}

// Run worker if called directly
if (require.main === module) {
    const worker = new SecurityIdentityWorker();
    process.on('SIGINT', async () => { await worker.stop(); process.exit(0); });
    process.on('SIGTERM', async () => { await worker.stop(); process.exit(0); });
    worker.start().catch(err => { logger.error('Security Identity Worker failed to start', { error: err }); process.exit(1); });
}

module.exports = SecurityIdentityWorker;
