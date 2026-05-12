#!/bin/bash

# HYDI Blue-Green Deployment Script
set -e

# Configuration
COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env.production"
BLUE_WEIGHT=90
GREEN_WEIGHT=10

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Phase A: Infrastructure Lockdown
infrastructure_lockdown() {
    log "=== PHASE A: INFRASTRUCTURE LOCKDOWN ==="
    
    # Check environment
    if [[ ! -f "$ENV_FILE" ]]; then
        error "Production environment file $ENV_FILE not found"
    fi
    
    # Run database migrations
    log "Running database migrations..."
    # This would typically be done via Supabase dashboard or API
    warn "Please manually run database-migrations.sql in Supabase SQL Editor"
    
    # Build images
    log "Building Docker images..."
    docker-compose -f $COMPOSE_FILE build
    
    # Start blue environment
    log "Starting blue environment..."
    docker-compose -f $COMPOSE_FILE up -d protoforge-blue hydi-processor-blue ursula-dashboard-blue
    
    # Wait for health checks
    log "Waiting for blue environment health checks..."
    sleep 30
    
    # Verify health
    if ! curl -f http://localhost:3001/health > /dev/null 2>&1; then
        error "Blue environment health check failed"
    fi
    
    if ! curl -f http://localhost:3002/health > /dev/null 2>&1; then
        error "Ursula dashboard health check failed"
    fi
    
    log "Blue environment is healthy"
}

# Phase B: Traffic Cutover
traffic_cutover() {
    log "=== PHASE B: TRAFFIC CUTOVER ==="
    
    # Start green environment
    log "Starting green environment..."
    docker-compose -f $COMPOSE_FILE --profile green up -d protoforge-green hydi-processor-green ursula-dashboard-green
    
    # Wait for green health checks
    log "Waiting for green environment health checks..."
    sleep 30
    
    # Verify green health
    if ! curl -f http://localhost:3003/health > /dev/null 2>&1; then
        error "Green environment health check failed"
    fi
    
    log "Green environment is healthy"
    
    # Update nginx configuration for canary
    log "Configuring nginx for canary deployment ($BLUE_WEIGHT% blue, $GREEN_WEIGHT% green)..."
    # This would update the nginx weights dynamically
    sed -i "s/weight=90/weight=$BLUE_WEIGHT/" $COMPOSE_FILE
    sed -i "s/weight=10/weight=$GREEN_WEIGHT/" $COMPOSE_FILE
    
    # Reload nginx
    docker-compose -f $COMPOSE_FILE exec nginx-lb nginx -s reload
    
    log "Canary deployment active: $BLUE_WEIGHT% blue, $GREEN_WEIGHT% green"
}

# Monitoring phase
monitor_canary() {
    log "=== MONITORING CANARY DEPLOYMENT ==="
    
    # Monitor for 5 minutes
    for i in {1..30}; do
        log "Monitor cycle $i/30..."
        
        # Check error rates
        # This would typically query Prometheus or logs
        if curl -f http://localhost:3003/health > /dev/null 2>&1; then
            log "Green environment healthy"
        else
            warn "Green environment unhealthy, rolling back..."
            rollback
            return 1
        fi
        
        sleep 10
    done
    
    log "Canary monitoring complete, proceeding to full cutover"
}

# Full cutover
full_cutover() {
    log "=== FULL CUTOVER TO GREEN ==="
    
    # Update nginx to 100% green
    sed -i "s/weight=$BLUE_WEIGHT/weight=0/" $COMPOSE_FILE
    sed -i "s/weight=$GREEN_WEIGHT/weight=100/" $COMPOSE_FILE
    
    # Reload nginx
    docker-compose -f $COMPOSE_FILE exec nginx-lb nginx -s reload
    
    log "Full cutover to green complete"
    
    # Stop blue environment
    log "Stopping blue environment..."
    docker-compose -f $COMPOSE_FILE stop protoforge-blue hydi-processor-blue ursula-dashboard-blue
    
    log "Blue environment stopped"
}

# Rollback function
rollback() {
    warn "ROLLBACK INITIATED"
    
    # Update nginx to 100% blue
    sed -i "s/weight=.*/weight=100/" $COMPOSE_FILE
    
    # Reload nginx
    docker-compose -f $COMPOSE_FILE exec nginx-lb nginx -s reload
    
    # Stop green environment
    docker-compose -f $COMPOSE_FILE --profile green stop
    
    warn "Rollback complete, all traffic routed to blue environment"
}

# Main execution
main() {
    case "${1:-deploy}" in
        "deploy")
            infrastructure_lockdown
            traffic_cutover
            monitor_canary
            full_cutover
            log "=== DEPLOYMENT COMPLETE ==="
            ;;
        "rollback")
            rollback
            ;;
        "status")
            docker-compose -f $COMPOSE_FILE ps
            ;;
        "logs")
            docker-compose -f $COMPOSE_FILE logs -f "${2:-}"
            ;;
        *)
            echo "Usage: $0 {deploy|rollback|status|logs [service]}"
            exit 1
            ;;
    esac
}

# Execute main function
main "$@"
