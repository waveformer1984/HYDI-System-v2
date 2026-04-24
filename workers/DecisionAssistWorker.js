            // System optimization decisions
            'system_optimization': {
                min_data_points: 15,
                confidence_threshold: 0.6,
                factors: ['response_time', 'error_rate', 'resource_utilization', 'user_satisfaction']
            }
        };
        
        this.initialize = function() {
            // Initialize Supabase
            const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            
            if (!supabaseUrl || !supabaseKey) {
                throw new Error('Missing Supabase credentials');
            }
            
            this.supabase = createClient(supabaseUrl, supabaseKey);
            
            // Register worker
            this.queue.registerWorker('decision_assist', this.workerId);
            this.queue.updateHeartbeat('idle');
            
            console.log(`[🧠 Decision Assist Worker] Initialized: ${this.workerId}`);
        };

        this.start = async function() {
            if (this.running) {
                console.log('[🧠 Decision Assist Worker] Already running');
                return;
            }
            
            await this.initialize();
            this.running = true;
            this.queue.startHeartbeat();
            
            console.log('[🧠 Decision Assist Worker] Starting to analyze data and provide recommendations...');
            
            // Start polling
            this.poll();
        };

        this.stop = async function() {
            this.running = false;
            
            if (this.pollTimer) {
                clearTimeout(this.pollTimer);
            }
            
            await this.queue.shutdown();
            console.log('[🧠 Decision Assist Worker] Stopped');
        };

        this.poll = function() {
            if (!this.running) return;
            
            this.processNextTask()
                .catch(err => {
                    console.error('[🧠 Decision Assist Worker] Error in poll:', err);
                })
                .finally(() => {
                    // Schedule next poll
                    this.pollTimer = setTimeout(() => this.poll(), this.pollInterval);
                });
        };

        this.processNextTask = async function() {
            const taskId = await this.queue.dequeue('decision_assist');
            
            if (!taskId) {
                return; // No tasks available
            }
            
            try {
                const task = await this.queue.getTask(taskId);
                if (!task) {
                    console.error(`[🧠 Decision Assist Worker] Task not found: ${taskId}`);
                    return;
                }
                
                console.log(`[🧠 Decision Assist Worker] Processing task: ${task.payload.event_type}`);
                
                // Process based on event type
                switch (task.payload.event_type) {
                    case 'financials.updated':
                        await this.analyzeFinancialData(task.payload);
                        break;
                        
                    case 'system.load':
                        await this.analyzeSystemLoad(task.payload);
                        break;
                        
                    case 'behavior.data':
                        await this.analyzeBehaviorData(task.payload);
                        break;
                        
                    case 'decision.request':
                        await this.processDecisionRequest(task.payload);
                        break;
                        
                    case 'optimization.request':
                        await this.processOptimizationRequest(task.payload);
                        break;
                        
                    default:
                        console.log(`[🧠 Decision Assist Worker] Unhandled event type: ${task.payload.event_type}`);
                }
                
                // Mark task as completed
                await this.queue.completeTask(taskId, true);
                
            } catch (err) {
                console.error(`[🧠 Decision Assist Worker] Task failed: ${taskId}`, err);
                await this.queue.completeTask(taskId, false, err.message);
            }
        };

        this.analyzeFinancialData = async function(payload) {
            const { revenue, costs, margins, time_period } = payload.data;
            
            console.log(`[🧠 Decision Assist] Analyzing financial data for ${time_period}`);
            
            #analyze-financial-trends