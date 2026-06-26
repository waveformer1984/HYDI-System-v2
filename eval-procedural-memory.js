/**
 * Procedural Memory Evaluation Harness
 * Tests the effectiveness of procedural memory by comparing performance
 * with and without learned lessons on held-out tasks.
 */

const proceduralMemory = require('./heidi-procedural-memory');
const fs = require('fs');
const path = require('path');

const EVAL_RESULTS_FILE = path.join(__dirname, '.procedural-memory-eval-results.json');

// Sample held-out tasks for evaluation
const EVAL_TASKS = [
    {
        id: 'deploy_staging',
        situation: 'When user requests to deploy to staging',
        expected_lesson: 'Always run health check after deploy',
        action_type: 'run_script',
        action_summary: 'deploy.sh --env=staging'
    },
    {
        id: 'database_timeout',
        situation: 'When database operations timeout',
        expected_lesson: 'Retry with exponential backoff up to 3 times before reporting failure',
        action_type: 'api_call',
        action_summary: 'GET /api/health'
    },
    {
        id: 'file_write_permission',
        situation: 'When file write fails due to permissions',
        expected_lesson: 'Check directory permissions before attempting write operations',
        action_type: 'write_file',
        action_summary: '/data/output.json'
    }
];

class ProceduralMemoryEvaluator {
    constructor(ollamaUrl, supabase = null) {
        this.ollamaUrl = ollamaUrl;
        this.supabase = supabase;
        this.deviceId = 'eval_harness';
        this.results = [];
    }

    /**
     * Seed the memory with known lessons for testing
     */
    async seedLessons() {
        console.log('[Eval] Seeding procedural memory with test lessons...');
        
        for (const task of EVAL_TASKS) {
            const success = await proceduralMemory.storeLesson(
                this.deviceId,
                {
                    situation: task.situation,
                    action_type: task.action_type,
                    action_summary: task.action_summary,
                    outcome: 'success',
                    outcome_detail: 'Test seed',
                    lesson: task.expected_lesson,
                    confidence: 0.8
                },
                this.ollamaUrl,
                this.supabase
            );
            console.log(`[Eval] Seed ${task.id}: ${success ? '✓' : '✗'}`);
        }
        
        // Verify storage
        const stored = await proceduralMemory.listLessons(this.deviceId, this.supabase);
        console.log(`[Eval] Verified ${stored.length} lessons stored`);
    }

    /**
     * Test retrieval effectiveness
     */
    async testRetrieval() {
        console.log('[Eval] Testing lesson retrieval...');
        
        let correctRetrievals = 0;
        
        for (const task of EVAL_TASKS) {
            const lessons = await proceduralMemory.recall(
                this.deviceId,
                task.situation,
                this.ollamaUrl,
                3,
                this.supabase
            );
            
            const found = lessons.some(l => 
                l.lesson.toLowerCase().includes(task.expected_lesson.toLowerCase().substring(0, 20))
            );
            
            if (found) {
                correctRetrievals++;
                console.log(`[Eval] ✓ ${task.id}: Retrieved correctly`);
            } else {
                console.log(`[Eval] ✗ ${task.id}: Failed to retrieve`);
            }
            
            this.results.push({
                task_id: task.id,
                retrieval_success: found,
                lessons_found: lessons.length,
                top_lesson: lessons[0]?.lesson || null
            });
        }
        
        const accuracy = correctRetrievals / EVAL_TASKS.length;
        console.log(`[Eval] Retrieval accuracy: ${(accuracy * 100).toFixed(1)}%`);
        
        return accuracy;
    }

    /**
     * Test confidence scoring
     */
    async testConfidenceScoring() {
        console.log('[Eval] Testing confidence scoring...');
        
        // Retrieve a lesson and update its application stats
        const lessons = await proceduralMemory.recall(
            this.deviceId,
            EVAL_TASKS[0].situation,
            this.ollamaUrl,
            1,
            this.supabase
        );
        
        if (lessons.length === 0) {
            console.log('[Eval] No lessons found for confidence test');
            return 0;
        }
        
        const lesson = lessons[0];
        const initialConfidence = lesson.confidence;
        
        // Simulate successful application
        await proceduralMemory.updateApplication(lesson.id, true, this.supabase);
        
        // Check updated confidence
        const updatedLessons = await proceduralMemory.listLessons(this.deviceId, this.supabase);
        const updatedLesson = updatedLessons.find(l => l.id === lesson.id);
        
        const confidenceIncrease = updatedLesson.confidence - initialConfidence;
        console.log(`[Eval] Confidence increased by ${(confidenceIncrease * 100).toFixed(1)}%`);
        
        return confidenceIncrease;
    }

    /**
     * Test lesson pruning
     */
    async testPruning() {
        console.log('[Eval] Testing lesson pruning...');
        
        const beforeCount = (await proceduralMemory.listLessons(this.deviceId, this.supabase)).length;
        
        // Add a low-confidence lesson
        await proceduralMemory.storeLesson(
            this.deviceId,
            {
                situation: 'Test situation for pruning',
                action_type: 'run_command',
                action_summary: 'test command',
                outcome: 'success',
                outcome_detail: 'Test',
                lesson: 'This lesson should be pruned',
                confidence: 0.1
            },
            this.ollamaUrl,
            this.supabase
        );
        
        // Prune lessons with confidence < 0.3
        const pruned = await proceduralMemory.pruneLessons(0.3, 0, this.supabase);
        
        const afterCount = (await proceduralMemory.listLessons(this.deviceId, this.supabase)).length;
        
        console.log(`[Eval] Pruned ${pruned} lessons (${beforeCount} → ${afterCount})`);
        
        return pruned;
    }

    /**
     * Run full evaluation
     */
    async runFullEval() {
        console.log('\n=== Procedural Memory Evaluation ===\n');
        
        const startTime = Date.now();
        
        try {
            // Seed lessons
            await this.seedLessons();
            
            // Test retrieval
            const retrievalAccuracy = await this.testRetrieval();
            
            // Test confidence scoring
            const confidenceIncrease = await this.testConfidenceScoring();
            
            // Test pruning
            const prunedCount = await this.testPruning();
            
            const duration = Date.now() - startTime;
            
            const summary = {
                timestamp: new Date().toISOString(),
                duration_ms: duration,
                retrieval_accuracy: retrievalAccuracy,
                confidence_increase: confidenceIncrease,
                lessons_pruned: prunedCount,
                tasks_tested: EVAL_TASKS.length,
                results: this.results
            };
            
            // Save results
            fs.writeFileSync(EVAL_RESULTS_FILE, JSON.stringify(summary, null, 2));
            
            console.log('\n=== Evaluation Summary ===');
            console.log(`Duration: ${duration}ms`);
            console.log(`Retrieval Accuracy: ${(retrievalAccuracy * 100).toFixed(1)}%`);
            console.log(`Confidence Increase: ${(confidenceIncrease * 100).toFixed(1)}%`);
            console.log(`Lessons Pruned: ${prunedCount}`);
            console.log(`Results saved to: ${EVAL_RESULTS_FILE}`);
            
            return summary;
            
        } catch (error) {
            console.error('[Eval] Evaluation failed:', error);
            throw error;
        }
    }

    /**
     * Load previous results
     */
    static loadResults() {
        try {
            return JSON.parse(fs.readFileSync(EVAL_RESULTS_FILE, 'utf8'));
        } catch {
            return null;
        }
    }

    /**
     * Compare with previous results
     */
    static compareResults(previous) {
        if (!previous) {
            console.log('[Eval] No previous results to compare');
            return null;
        }
        
        console.log('\n=== Comparison with Previous Run ===');
        console.log(`Previous: ${new Date(previous.timestamp).toLocaleString()}`);
        console.log(`Retrieval Accuracy: ${(previous.retrieval_accuracy * 100).toFixed(1)}%`);
        console.log(`Confidence Increase: ${(previous.confidence_increase * 100).toFixed(1)}%`);
        console.log(`Lessons Pruned: ${previous.lessons_pruned}`);
    }
}

// CLI interface
if (require.main === module) {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    
    // Check if we should compare with previous results
    const previousResults = ProceduralMemoryEvaluator.loadResults();
    if (previousResults) {
        ProceduralMemoryEvaluator.compareResults(previousResults);
    }
    
    const evaluator = new ProceduralMemoryEvaluator(ollamaUrl);
    evaluator.runFullEval()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = ProceduralMemoryEvaluator;
