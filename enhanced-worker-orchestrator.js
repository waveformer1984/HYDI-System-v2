/**
 * ENHANCED WORKER ORCHESTRATOR - Business Intelligence Edition
 * Handles job processing with business awareness
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

class BusinessAwareWorkerOrchestrator {
  constructor() {
    this.supabase = null
    this.workerId = `worker_${crypto.randomUUID()}`
    this.metrics = {
      jobsProcessed: 0,
      revenueProcessed: 0,
      entitlementsCreated: 0,
      failures: 0
    }
  }

  async initialize() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials')
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey)
    
    // Register worker
    await this.supabase.from('worker_registry').upsert({
      worker_id: this.workerId,
      enabled: true,
      ecosystem: 'business-aware',
      concurrency_limit: 10,
      heartbeat_at: new Date().toISOString()
    })
    
    console.log(`[🎼 Orchestrator] Initialized ${this.workerId}`)
  }

  async claimJobs(queueName, batchSize = 20, timeoutSeconds = 60) {
    const leaseExpires = new Date(Date.now() + (timeoutSeconds * 1000)).toISOString()
    
    const { data, error } = await this.supabase
      .from('worker_jobs')
      .select('*')
      .eq('queue_name', queueName)
      .eq('status', 'queued')
      .lt('available_at', new Date().toISOString())
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(batchSize)

    if (error) throw error

    if (!data || data.length === 0) {
      return { claimed: [], alreadyClaimed: 0 }
    }

    // Try to claim jobs
    const jobIds = data.map(j => j.id)
    const { data: updated, error: updateError } = await this.supabase
      .from('worker_jobs')
      .update({
        status: 'processing',
        locked_by: this.workerId,
        lease_expires_at: leaseExpires,
        updated_at: new Date().toISOString()
      })
      .eq('status', 'queued')
      .in('id', jobIds)

    if (updateError) throw updateError

    const claimedCount = updated ? updated.length : 0
    const claimed = data.slice(0, claimedCount)

    // Emit job claimed event
    if (claimed.length > 0) {
      await this.supabase.from('event_bus_events').insert({
        topic: 'workers:jobs',
        event_name: 'jobs_claimed',
        source_worker: this.workerId,
        correlation_id: crypto.randomUUID(),
        payload: {
          queue_name: queueName,
          job_count: claimed.length,
          worker_id: this.workerId
        },
        occurred_at: new Date().toISOString()
      })
    }

    return { claimed, alreadyClaimed: jobIds.length - claimedCount }
  }

  async processJob(job) {
    const startTime = Date.now()
    
    try {
      let result
      
      // Route to appropriate processor
      switch (job.job_type) {
        case 'revenue':
          result = await this.processRevenueJob(job)
          break
        case 'provisioning':
          result = await this.processProvisioningJob(job)
          break
        case 'entitlement':
          result = await this.processEntitlementJob(job)
          break
        default:
          result = await this.processGenericJob(job)
      }

      // Mark as complete
      await this.supabase
        .from('worker_jobs')
        .update({
          status: 'done',
          result: result,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      // Update metrics
      this.metrics.jobsProcessed++
      if (job.job_type === 'revenue' && result?.amount) {
        this.metrics.revenueProcessed += result.amount
      }
      if (job.job_type === 'entitlement' && result?.entitlementCreated) {
        this.metrics.entitlementsCreated++
      }

      // Emit success event
      await this.supabase.from('event_bus_events').insert({
        topic: 'workers:jobs',
        event_name: 'job_completed',
        source_worker: this.workerId,
        correlation_id: job.correlation_id,
        payload: {
          job_id: job.id,
          queue_name: job.queue_name,
          job_type: job.job_type,
          duration_ms: Date.now() - startTime,
          worker_id: this.workerId,
          result: result
        },
        occurred_at: new Date().toISOString()
      })

      return result

    } catch (error) {
      this.metrics.failures++
      
      // Mark as failed
      await this.supabase
        .from('worker_jobs')
        .update({
          status: 'failed',
          error_message: error.message,
          attempts: job.attempts + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      // Emit failure event
      await this.supabase.from('event_bus_events').insert({
        topic: 'workers:errors',
        event_name: 'job_failed',
        source_worker: this.workerId,
        correlation_id: job.correlation_id,
        payload: {
          job_id: job.id,
          queue_name: job.queue_name,
          job_type: job.job_type,
          error: error.message,
          attempts: job.attempts + 1,
          worker_id: this.workerId
        },
        occurred_at: new Date().toISOString()
      })

      throw error
    }
  }

  async processRevenueJob(job) {
    const payload = job.payload
    
    // Track revenue
    const { data, error } = await this.supabase
      .from('revenue_tracking')
      .insert({
        event_id: payload.event_id,
        customer_id: payload.customer_id,
        amount: payload.amount,
        currency: payload.currency,
        product_id: payload.product_id,
        metadata: payload.metadata
      })
      .select()
      .single()

    if (error) throw error

    // Emit revenue tracked event
    await this.supabase.from('event_bus_events').insert({
      topic: 'revenue:tracked',
      event_name: 'revenue_recorded',
      source_worker: this.workerId,
      correlation_id: job.correlation_id,
      payload: {
        revenue_id: data.id,
        amount: payload.amount,
        customer_id: payload.customer_id
      },
      occurred_at: new Date().toISOString()
    })

    return { revenueTracked: true, amount: payload.amount, revenueId: data.id }
  }

  async processProvisioningJob(job) {
    const payload = job.payload
    
    // Create or update customer service
    const { data, error } = await this.supabase
      .from('customer_services')
      .upsert({
        customer_id: payload.customer_id,
        service_id: payload.service_id,
        status: 'active',
        provisioned_at: new Date().toISOString(),
        source_event_id: payload.source_event_id,
        metadata: payload.metadata
      })
      .select()
      .single()

    if (error) throw error

    // Emit provisioning event
    await this.supabase.from('event_bus_events').insert({
      topic: 'provisioning:completed',
      event_name: 'service_provisioned',
      source_worker: this.workerId,
      correlation_id: job.correlation_id,
      payload: {
        customer_id: payload.customer_id,
        service_id: payload.service_id,
        provision_id: data.id
      },
      occurred_at: new Date().toISOString()
    })

    return { provisioned: true, provisionId: data.id }
  }

  async processEntitlementJob(job) {
    const payload = job.payload
    
    // Create entitlement
    const { data, error } = await this.supabase
      .from('entitlements')
      .insert({
        customer_id: payload.customer_id,
        product_id: payload.product_id,
        status: 'active',
        start_date: new Date().toISOString(),
        source_event_id: payload.source_event_id,
        metadata: payload.metadata
      })
      .select()
      .single()

    if (error) throw error

    // Broadcast entitlement creation
    await this.supabase.from('event_bus_events').insert({
      topic: 'entitlements:granted',
      event_name: 'entitlement_created',
      source_worker: this.workerId,
      correlation_id: job.correlation_id,
      payload: {
        customer_id: payload.customer_id,
        product_id: payload.product_id,
        entitlement_id: data.id
      },
      occurred_at: new Date().toISOString()
    })

    return { entitlementCreated: true, entitlementId: data.id }
  }

  async processGenericJob(job) {
    // Default processor for unknown job types
    console.log(`Processing generic job: ${job.job_type}`)
    
    await new Promise(resolve => setTimeout(resolve, 100)) // Simulate work
    
    return { processed: true, jobType: job.job_type }
  }

  async updateHeartbeat() {
    await this.supabase
      .from('worker_registry')
      .update({
        heartbeat_at: new Date().toISOString(),
        last_activity: new Date().toISOString()
      })
      .eq('worker_id', this.workerId)
  }

  async publishMetrics() {
    await this.supabase.from('event_bus_events').insert({
      topic: 'workers:metrics',
      event_name: 'worker_performance',
      source_worker: this.workerId,
      correlation_id: crypto.randomUUID(),
      payload: {
        worker_id: this.workerId,
        metrics: this.metrics,
        timestamp: new Date().toISOString()
      },
      occurred_at: new Date().toISOString()
    })
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const orchestrator = new BusinessAwareWorkerOrchestrator()
    await orchestrator.initialize()

    const { queue_name, batch_size = 20 } = await req.json()
    
    if (!queue_name) {
      throw new Error('queue_name is required')
    }

    // Claim jobs
    const { claimed } = await orchestrator.claimJobs(queue_name, batch_size)
    
    // Process jobs
    const results = []
    for (const job of claimed) {
      const result = await orchestrator.processJob(job)
      results.push({ jobId: job.id, result })
    }

    // Update heartbeat and publish metrics
    await orchestrator.updateHeartbeat()
    await orchestrator.publishMetrics()

    return new Response(
      JSON.stringify({
        success: true,
        workerId: orchestrator.workerId,
        processed: results.length,
        metrics: orchestrator.metrics,
        results
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Worker orchestrator error:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
