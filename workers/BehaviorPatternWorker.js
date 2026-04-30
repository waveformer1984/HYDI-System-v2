            // Find best and worst performing job types
            let bestType = null;
            let worstType = null;
            let bestRate = 0;
            let worstRate = 1;
            
            for (const type in performanceByType) {
                const rate = performanceByType[type].successRate;
                if (rate > bestRate) {
                    bestRate = rate;
                    bestType = type;
                }
                if (rate < worstRate) {
                    worstRate = rate;
                    worstType = type;
                }
            }
            
            if (bestType && worstType && bestType !== worstType) {
                insights.push(`Best performing job type: ${bestType} (${(bestRate*100).toFixed(1)}% success rate)`);
                insights.push(`Worst performing job type: ${worstType} (${(worstRate*100).toFixed(1)}% success rate)`);
            }
            
            return insights;
        };

        this.analyzeServiceUsagePatterns = async function(time_period, filters) {
            // Analyze service usage patterns
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
            
            const { data: serviceUsage } = await this.supabase
                .from('service_usage_logs')
                .select('*')
                .gte('timestamp', startDate.toISOString());
            
            if (filters && filters.service_name) {
                // Filter by service name if specified
                serviceUsage.filter = su => su.service_name === filters.service_name;
            }
            
            #analyze-service-usage-statistics