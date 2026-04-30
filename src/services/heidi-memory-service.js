/**
 * Heidi Memory + Calibration Synchronization Layer
 * Persistent intelligence layer for confidence tracking and learning
 */

const { createClient } = require('@supabase/supabase-js');

class HeidiMemoryService {
    constructor(supabaseUrl, supabaseKey) {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.cache = new Map(); // Cache for < 100ms queries
        this.cacheTimeout = 30000; // 30 seconds
    }

    // Cache management
    getCached(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    setCached(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        
        // Limit cache size
        if (this.cache.size > 100) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
    }

    // Theme Predictions
    async recordThemePrediction(taskId, theme, confidence, source) {
        try {
            const { data, error } = await this.supabase
                .from('theme_predictions')
                .insert({
                    task_id: taskId,
                    theme,
                    confidence,
                    source
                })
                .select()
                .single();

            if (error) throw error;

            // Invalidate cache
            this.cache.delete(`theme_accuracy_${theme}`);
            this.cache.delete('system_calibration');

            console.log(`[MEMORY] Recorded prediction: ${taskId} -> ${theme} (${confidence.toFixed(2)})`);
            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to record prediction:', error);
            throw error;
        }
    }

    // Theme Outcomes
    async recordThemeOutcome(taskId, actualTheme, wasCorrect) {
        try {
            const { data, error } = await this.supabase
                .from('theme_outcomes')
                .insert({
                    task_id: taskId,
                    actual_theme: actualTheme,
                    was_correct: wasCorrect
                })
                .select()
                .single();

            if (error) throw error;

            // Invalidate relevant caches
            this.cache.delete(`theme_accuracy_${actualTheme}`);
            this.cache.delete('system_calibration');

            console.log(`[MEMORY] Recorded outcome: ${taskId} -> ${actualTheme} (${wasCorrect ? 'correct' : 'wrong'})`);
            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to record outcome:', error);
            throw error;
        }
    }

    // Theme Accuracy (with caching)
    async getThemeAccuracy(theme) {
        const cacheKey = `theme_accuracy_${theme}`;
        const cached = this.getCached(cacheKey);
        
        if (cached) {
            return cached;
        }

        try {
            const { data, error } = await this.supabase
                .rpc('get_theme_accuracy', { theme_param: theme });

            if (error) throw error;

            this.setCached(cacheKey, data);
            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to get theme accuracy:', error);
            // Return default on error
            return { rolling_accuracy: 0.5, correct: 0, incorrect: 0 };
        }
    }

    // System Calibration (with caching)
    async getSystemCalibration() {
        const cacheKey = 'system_calibration';
        const cached = this.getCached(cacheKey);
        
        if (cached) {
            return cached;
        }

        try {
            const { data, error } = await this.supabase
                .rpc('get_system_calibration');

            if (error) throw error;

            this.setCached(cacheKey, data);
            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to get system calibration:', error);
            return {
                total_predictions: 0,
                overall_accuracy: 0.0,
                avg_confidence: 0.0,
                confidence_accuracy_gap: 0.0,
                overconfidence_rate: 0.0
            };
        }
    }

    // Theme Calibration Endpoint
    async getThemeCalibration(theme = null) {
        try {
            const { data, error } = await this.supabase
                .rpc('get_theme_calibration', { theme_param: theme });

            if (error) throw error;

            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to get theme calibration:', error);
            return null;
        }
    }

    // Heidi Reflections
    async storeReflection(reflection) {
        try {
            const { data, error } = await this.supabase
                .from('heidi_reflections')
                .insert({
                    task_id: reflection.taskId,
                    theme: reflection.theme,
                    confidence: reflection.confidence,
                    was_correct: reflection.wasCorrect,
                    overconfidence_detected: reflection.overconfidenceDetected || false,
                    confidence_justified: reflection.evaluations?.confidence_justified,
                    gating_appropriate: reflection.evaluations?.gating_appropriate,
                    historical_influence: reflection.evaluations?.historical_influence,
                    evaluations: reflection.evaluations
                })
                .select()
                .single();

            if (error) throw error;

            console.log(`[MEMORY] Stored reflection for task: ${reflection.taskId}`);
            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to store reflection:', error);
            throw error;
        }
    }

    // System Misalignment Events
    async logSystemMisalignment(event) {
        try {
            const { data, error } = await this.supabase
                .from('system_misalignment_events')
                .insert({
                    event_type: event.type,
                    high_confidence_errors: event.high_confidence_errors,
                    low_confidence_executions: event.low_confidence_executions,
                    missed_gating_opportunities: event.missed_gating_opportunities,
                    severity: event.severity
                })
                .select()
                .single();

            if (error) throw error;

            console.error(`[MEMORY] Logged system misalignment: ${event.severity} severity`);
            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to log misalignment:', error);
            throw error;
        }
    }

    // Get Recent Reflections
    async getRecentReflections(limit = 20) {
        try {
            const { data, error } = await this.supabase
                .from('heidi_reflections')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to get reflections:', error);
            return [];
        }
    }

    // Get Overconfidence Events
    async getOverconfidenceEvents(theme = null, limit = 10) {
        try {
            let query = this.supabase
                .from('overconfidence_events')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(limit);

            if (theme) {
                query = query.eq('theme', theme);
            }

            const { data, error } = await query;
            
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to get overconfidence events:', error);
            return [];
        }
    }

    // Get System Misalignment Events
    async getMisalignmentEvents(limit = 10) {
        try {
            const { data, error } = await this.supabase
                .from('system_misalignment_events')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('[MEMORY] Failed to get misalignment events:', error);
            return [];
        }
    }

    // Health Check
    async healthCheck() {
        try {
            const startTime = Date.now();
            
            // Test basic connectivity
            const { data, error } = await this.supabase
                .from('theme_predictions')
                .select('count')
                .limit(1);

            const queryTime = Date.now() - startTime;

            return {
                healthy: !error,
                query_time_ms: queryTime,
                cache_size: this.cache.size,
                last_check: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                last_check: new Date().toISOString()
            };
        }
    }

    // Performance Metrics
    async getPerformanceMetrics() {
        const health = await this.healthCheck();
        const calibration = await this.getSystemCalibration();
        
        return {
            memory_service: health,
            calibration_metrics: calibration,
            cache_performance: {
                size: this.cache.size,
                timeout_ms: this.cacheTimeout
            }
        };
    }
}

module.exports = HeidiMemoryService;
