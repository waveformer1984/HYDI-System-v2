// CASCADE AGENT - Early-Stage COO Engine
// Evolves HEIDI from task viewer to business architect

const fs = require('fs').promises;
const path = require('path');

class CascadeEngine {
    constructor() {
        this.mode = "execution"; // execution | exploration | optimization
        this.weights = {
            profit_potential: 0.20,
            time_to_revenue: 0.15,
            complexity: 0.10,
            defensibility: 0.20,
            scalability: 0.15,
            dependency_risk: 0.10,
            cashflow_type: 0.10
        };
        
        this.lastUpdate = null;
        this.cache = new Map();
        this.taskGraph = new Map();
    }

    async loadRevenueTasks() {
        try {
            const data = await fs.readFile(path.join(__dirname, 'revenue-tasks.json'), 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to load revenue tasks:', error);
            return { tasks: [] };
        }
    }

    // 1. UPGRADED MULTI-AXIS SCORING
    calculateAdvancedScore(task) {
        // Core metrics
        const profitScore = this.normalizeValue(task.profit_potential, ['low', 'medium', 'high', 'very_high']);
        const timeScore = this.normalizeTimeValue(task.time_to_revenue);
        const complexityScore = this.normalizeValue(task.complexity, ['low', 'medium', 'high']);
        
        // Advanced metrics
        const defensibilityScore = this.calculateDefensibilityScore(task);
        const scalabilityScore = this.calculateScalabilityScore(task);
        const dependencyRisk = this.calculateDependencyRisk(task);
        const cashflowScore = this.calculateCashflowScore(task);
        
        // Weighted calculation
        const totalScore = 
            (profitScore * this.weights.profit_potential) +
            (timeScore * this.weights.time_to_revenue) +
            ((1 - complexityScore) * this.weights.complexity) + // Invert complexity (lower = better)
            (defensibilityScore.score * this.weights.defensibility) +
            (scalabilityScore * this.weights.scalability) +
            ((1 - dependencyRisk) * this.weights.dependency_risk) + // Invert risk (lower = better)
            (cashflowScore.score * this.weights.cashflow_type);
        
        // Confidence and risk calculations
        const confidenceScore = this.calculateConfidence(task, defensibilityScore, dependencyRisk);
        const failureRisk = this.calculateFailureRisk(task, complexityScore, dependencyRisk);
        
        return {
            total_score: Math.round(totalScore * 100),
            confidence_score: Math.round(confidenceScore * 100),
            failure_risk_score: Math.round(failureRisk * 100),
            breakdown: {
                profit_potential: Math.round(profitScore * 100),
                time_to_revenue: Math.round(timeScore * 100),
                complexity: Math.round(complexityScore * 100),
                defensibility: defensibilityScore.score,
                scalability: Math.round(scalabilityScore * 100),
                dependency_risk: Math.round(dependencyRisk * 100),
                cashflow_type: cashflowScore.score
            }
        };
    }

    calculateDefensibilityScore(task) {
        const factors = {
            switching_cost: this.estimateSwitchingCost(task),
            data_moat: this.estimateDataMoat(task),
            integration_depth: this.estimateIntegrationDepth(task),
            brand_lock: this.estimateBrandLock(task),
            automation_dependency: this.estimateAutomationDependency(task)
        };
        
        const scores = Object.values(factors);
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        
        // Grade calculation
        let grade = 'D';
        if (avgScore >= 0.9) grade = 'A';
        else if (avgScore >= 0.75) grade = 'B';
        else if (avgScore >= 0.6) grade = 'C';
        
        return {
            score: Math.round(avgScore * 100),
            grade,
            factors
        };
    }

    calculateScalabilityScore(task) {
        const scalabilityFactors = {
            market_size: this.estimateMarketSize(task),
            automation_potential: this.estimateAutomationPotential(task),
            replication_cost: this.estimateReplicationCost(task),
            network_effects: this.estimateNetworkEffects(task)
        };
        
        const scores = Object.values(scalabilityFactors);
        return scores.reduce((a, b) => a + b, 0) / scores.length;
    }

    calculateDependencyRisk(task) {
        const risks = {
            ollama_dependency: task.category.includes('AI') ? 0.7 : 0.2,
            hardware_dependency: task.category.includes('3D') || task.category.includes('Physical') ? 0.6 : 0.1,
            api_dependency: task.category.includes('SaaS') || task.category.includes('Platform') ? 0.5 : 0.2,
            market_dependency: this.estimateMarketDependency(task)
        };
        
        return Math.max(...Object.values(risks));
    }

    calculateConfidence(task, defensibility, dependencyRisk) {
        let confidence = 0.7; // Base confidence
        
        // Boost from defensibility
        confidence += (defensibility.score / 100) * 0.2;
        
        // Penalty from dependency risk
        confidence -= dependencyRisk * 0.3;
        
        // Boost from profit potential
        const profitScore = this.normalizeValue(task.profit_potential, ['low', 'medium', 'high', 'very_high']);
        confidence += profitScore * 0.1;
        
        return Math.max(0, Math.min(1, confidence));
    }

    calculateFailureRisk(task, complexity, dependencyRisk) {
        let risk = 0.3; // Base risk
        
        // Risk from complexity
        risk += complexity * 0.3;
        
        // Risk from dependencies
        risk += dependencyRisk * 0.4;
        
        // Risk from time to revenue (longer = higher risk)
        const timeRisk = 1 - this.normalizeTimeValue(task.time_to_revenue);
        risk += timeRisk * 0.3;
        
        return Math.max(0, Math.min(1, risk));
    }

    // 2. SYNERGY GRAPH LAYER
    buildTaskGraph(tasks) {
        const graph = new Map();
        
        tasks.forEach(task => {
            graph.set(task.id, {
                ...task,
                depends_on: [],
                enables: [],
                competes_with: [],
                synergy_clusters: []
            });
        });
        
        // Build relationships
        tasks.forEach(task => {
            const taskNode = graph.get(task.id);
            
            tasks.forEach(otherTask => {
                if (task.id === otherTask.id) return;
                
                const relationship = this.analyzeTaskRelationship(task, otherTask);
                
                if (relationship.type === 'dependency') {
                    taskNode.depends_on.push(otherTask.id);
                } else if (relationship.type === 'enables') {
                    taskNode.enables.push(otherTask.id);
                } else if (relationship.type === 'competes') {
                    taskNode.competes_with.push(otherTask.id);
                }
            });
        });
        
        // Identify revenue clusters
        this.identifyRevenueClusters(graph);
        
        return graph;
    }

    analyzeTaskRelationship(task1, task2) {
        // Dependency analysis
        if (this.hasDependency(task1, task2)) {
            return { type: 'dependency', strength: 0.8 };
        }
        
        // Enablement analysis
        if (this.enablesTask(task1, task2)) {
            return { type: 'enables', strength: 0.7 };
        }
        
        // Competition analysis
        if (this.competesWith(task1, task2)) {
            return { type: 'competes', strength: 0.6 };
        }
        
        return { type: 'none', strength: 0 };
    }

    hasDependency(task1, task2) {
        // AI tasks depend on HEIDI API
        if (task1.category.includes('AI') && task2.title.includes('HEIDI')) return true;
        
        // Platform tasks depend on core infrastructure
        if (task1.category.includes('Platform') && task2.category.includes('Core AI')) return true;
        
        return false;
    }

    enablesTask(task1, task2) {
        // HEIDI API enables many AI services
        if (task1.title.includes('HEIDI') && task2.category.includes('AI')) return true;
        
        // Manufacturing enables physical product services
        if (task1.category.includes('Manufacturing') && task2.category.includes('Physical')) return true;
        
        return false;
    }

    competesWith(task1, task2) {
        // Same category with similar profit potential
        if (task1.category === task2.category && 
            task1.profit_potential === task2.profit_potential) {
            return true;
        }
        
        return false;
    }

    identifyRevenueClusters(graph) {
        const clusters = new Map();
        const visited = new Set();
        
        graph.forEach((taskNode, taskId) => {
            if (visited.has(taskId)) return;
            
            const cluster = this.findConnectedTasks(taskId, graph, visited);
            const clusterId = `cluster_${clusters.size + 1}`;
            
            clusters.set(clusterId, {
                id: clusterId,
                tasks: cluster,
                total_value: cluster.reduce((sum, id) => {
                    const task = graph.get(id);
                    return sum + (task.advanced_score?.total_score || 0);
                }, 0),
                dependency_depth: this.calculateDependencyDepth(cluster, graph)
            });
            
            cluster.forEach(id => {
                const taskNode = graph.get(id);
                taskNode.synergy_clusters.push(clusterId);
            });
        });
        
        return clusters;
    }

    findConnectedTasks(taskId, graph, visited) {
        const connected = [];
        const stack = [taskId];
        
        while (stack.length > 0) {
            const currentId = stack.pop();
            if (visited.has(currentId)) continue;
            
            visited.add(currentId);
            connected.push(currentId);
            
            const currentNode = graph.get(currentId);
            [...currentNode.enables, ...currentNode.depends_on].forEach(relatedId => {
                if (!visited.has(relatedId)) {
                    stack.push(relatedId);
                }
            });
        }
        
        return connected;
    }

    calculateDependencyDepth(taskIds, graph) {
        let maxDepth = 0;
        
        taskIds.forEach(taskId => {
            const depth = this.calculateTaskDepth(taskId, graph, new Set());
            maxDepth = Math.max(maxDepth, depth);
        });
        
        return maxDepth;
    }

    calculateTaskDepth(taskId, graph, visited) {
        if (visited.has(taskId)) return 0;
        visited.add(taskId);
        
        const taskNode = graph.get(taskId);
        if (taskNode.depends_on.length === 0) return 1;
        
        const depths = taskNode.depends_on.map(depId => 
            this.calculateTaskDepth(depId, graph, visited)
        );
        
        return 1 + Math.max(...depths);
    }

    // 3. CASHFLOW CLASSIFICATION
    classifyCashflowType(task) {
        const quickCashCategories = ['Automation & Micro-SaaS Ideas'];
        const recurringCategories = ['Core AI / SaaS Revenue Systems', 'Platform / Ecosystem Expansion'];
        const equityCategories = ['HEIDI / AI PRODUCTIZATION', 'Platform / Ecosystem Expansion'];
        
        if (quickCashCategories.includes(task.category) && task.time_to_revenue.includes('1-2')) {
            return { type: 'immediate', recurring: false, priority_boost: 0.8 };
        } else if (recurringCategories.includes(task.category)) {
            return { type: 'recurring', recurring: true, priority_boost: 0.9 };
        } else if (equityCategories.includes(task.category)) {
            return { type: 'equity', recurring: false, priority_boost: 0.6 };
        } else {
            return { type: 'hybrid', recurring: true, priority_boost: 0.7 };
        }
    }

    // 4. AUTO-PRIORITY REWRITER
    async reprioritizeTasks() {
        const revenueData = await this.loadRevenueTasks();
        const enhancedTasks = [];
        
        // Build graph first
        const taskGraph = this.buildTaskGraph(revenueData.tasks);
        
        // Score all tasks
        for (const task of revenueData.tasks) {
            const advancedScore = this.calculateAdvancedScore(task);
            const cashflow = this.classifyCashflowType(task);
            const taskNode = taskGraph.get(task.id);
            
            // Apply mode-based adjustments
            const modeAdjustedScore = this.applyModeAdjustments(advancedScore.total_score, cashflow);
            
            // Determine status
            const status = this.determineTaskStatus(advancedScore, cashflow, taskNode);
            
            enhancedTasks.push({
                ...task,
                advanced_score: advancedScore,
                cashflow_type: cashflow.type,
                recurring_revenue: cashflow.recurring,
                graph_relationships: {
                    depends_on: taskNode.depends_on,
                    enables: taskNode.enables,
                    competes_with: taskNode.competes_with,
                    synergy_clusters: taskNode.synergy_clusters
                },
                status, // active | dormant | killed
                mode_adjusted_score: modeAdjustedScore
            });
        }
        
        // Sort by mode-adjusted score
        enhancedTasks.sort((a, b) => b.mode_adjusted_score - a.mode_adjusted_score);
        
        // Update cache
        this.lastUpdate = new Date().toISOString();
        this.cache.set('enhanced_tasks', enhancedTasks);
        this.cache.set('task_graph', taskGraph);
        
        return {
            tasks: enhancedTasks,
            graph: taskGraph,
            clusters: this.buildPortfolioView(enhancedTasks, taskGraph),
            risk_summary: this.calculateRiskSummary(enhancedTasks),
            recommended_actions: this.generateRecommendedActions(enhancedTasks, taskGraph),
            metadata: {
                mode: this.mode,
                last_update: this.lastUpdate,
                total_tasks: enhancedTasks.length,
                active_tasks: enhancedTasks.filter(t => t.status === 'active').length,
                killed_tasks: enhancedTasks.filter(t => t.status === 'killed').length
            }
        };
    }

    applyModeAdjustments(baseScore, cashflow) {
        let adjusted = baseScore;
        
        switch (this.mode) {
            case 'execution':
                // Prioritize fast revenue
                if (cashflow.type === 'immediate') adjusted *= 1.3;
                if (cashflow.recurring) adjusted *= 1.1;
                break;
                
            case 'exploration':
                // Prioritize high-value, defensible ideas
                adjusted *= 1.0; // No adjustment
                break;
                
            case 'optimization':
                // Prioritize recurring revenue
                if (cashflow.recurring) adjusted *= 1.4;
                if (cashflow.type === 'equity') adjusted *= 0.8;
                break;
        }
        
        return Math.round(adjusted);
    }

    determineTaskStatus(advancedScore, cashflow, taskNode) {
        // Kill low-value tasks
        if (advancedScore.total_score < 30) return 'killed';
        if (advancedScore.defensibility.grade === 'D') return 'killed';
        if (taskNode.competes_with.length > 2) return 'killed';
        
        // Dormant high-risk tasks
        if (advancedScore.failure_risk_score > 70) return 'dormant';
        
        // Everything else is active
        return 'active';
    }

    // 5. PORTFOLIO VIEW CONSTRUCTION
    buildPortfolioView(tasks, graph) {
        const clusters = new Map();
        
        // Group by synergy clusters
        tasks.forEach(task => {
            task.graph_relationships.synergy_clusters.forEach(clusterId => {
                if (!clusters.has(clusterId)) {
                    clusters.set(clusterId, {
                        id: clusterId,
                        tasks: [],
                        dependencies: [],
                        monthly_value: 0,
                        risk_level: 'low'
                    });
                }
                
                const cluster = clusters.get(clusterId);
                cluster.tasks.push(task);
                cluster.monthly_value += this.estimateMonthlyValue(task);
                
                // Aggregate dependencies
                task.graph_relationships.depends_on.forEach(depId => {
                    if (!cluster.dependencies.includes(depId)) {
                        cluster.dependencies.push(depId);
                    }
                });
            });
        });
        
        // Calculate risk levels
        clusters.forEach(cluster => {
            const avgRisk = cluster.tasks.reduce((sum, task) => 
                sum + task.advanced_score.failure_risk_score, 0) / cluster.tasks.length;
            
            if (avgRisk > 70) cluster.risk_level = 'high';
            else if (avgRisk > 40) cluster.risk_level = 'medium';
        });
        
        return Array.from(clusters.values()).sort((a, b) => b.monthly_value - a.monthly_value);
    }

    estimateMonthlyValue(task) {
        const profitMultipliers = {
            'low': 1000,
            'medium': 5000,
            'high': 15000,
            'very_high': 50000
        };
        
        const baseValue = profitMultipliers[task.profit_potential] || 1000;
        
        // Adjust for recurring revenue
        if (task.recurring_revenue) {
            return baseValue * 0.3; // Monthly portion of total value
        }
        
        return baseValue * 0.1; // One-time projects
    }

    calculateRiskSummary(tasks) {
        const activeTasks = tasks.filter(t => t.status === 'active');
        
        const avgConfidence = activeTasks.reduce((sum, t) => 
            sum + t.advanced_score.confidence_score, 0) / activeTasks.length;
        
        const avgRisk = activeTasks.reduce((sum, t) => 
            sum + t.advanced_score.failure_risk_score, 0) / activeTasks.length;
        
        const highRiskTasks = activeTasks.filter(t => t.advanced_score.failure_risk_score > 70);
        const lowDefensibility = activeTasks.filter(t => t.advanced_score.defensibility.grade === 'D');
        
        return {
            overall_confidence: Math.round(avgConfidence),
            overall_risk: Math.round(avgRisk),
            high_risk_tasks: highRiskTasks.length,
            low_defensibility_tasks: lowDefensibility.length,
            risk_rating: this.calculateOverallRiskRating(avgRisk, avgConfidence)
        };
    }

    calculateOverallRiskRating(risk, confidence) {
        const riskScore = risk - confidence;
        if (riskScore > 30) return 'HIGH';
        if (riskScore > 10) return 'MEDIUM';
        return 'LOW';
    }

    generateRecommendedActions(tasks, graph) {
        const actions = [];
        
        // Top 5 immediate actions
        const topTasks = tasks.filter(t => t.status === 'active').slice(0, 5);
        
        topTasks.forEach((task, index) => {
            actions.push({
                priority: index + 1,
                type: 'execute',
                task_id: task.id,
                title: `Execute: ${task.title}`,
                reasoning: `Top priority with score ${task.mode_adjusted_score}`,
                timeline: this.estimateTimeline(task),
                dependencies: task.graph_relationships.depends_on
            });
        });
        
        // Dependency resolution actions
        const dependencyActions = this.generateDependencyActions(tasks, graph);
        actions.push(...dependencyActions);
        
        // Risk mitigation actions
        const riskActions = this.generateRiskActions(tasks);
        actions.push(...riskActions);
        
        return actions.slice(0, 10); // Top 10 actions
    }

    generateDependencyActions(tasks, graph) {
        const actions = [];
        const dependencyMap = new Map();
        
        tasks.forEach(task => {
            task.graph_relationships.depends_on.forEach(depId => {
                if (!dependencyMap.has(depId)) {
                    dependencyMap.set(depId, []);
                }
                dependencyMap.get(depId).push(task);
            });
        });
        
        dependencyMap.forEach((dependents, depId) => {
            if (dependents.length > 2) {
                const depTask = tasks.find(t => t.id === depId);
                actions.push({
                    priority: dependents.length,
                    type: 'resolve_dependency',
                    task_id: depId,
                    title: `Resolve: ${depTask?.title || 'Unknown'}`,
                    reasoning: `Blocks ${dependents.length} other tasks`,
                    timeline: 'Immediate'
                });
            }
        });
        
        return actions;
    }

    generateRiskActions(tasks) {
        const actions = [];
        
        // High confidence, low risk tasks
        const safeBets = tasks.filter(t => 
            t.status === 'active' && 
            t.advanced_score.confidence_score > 80 && 
            t.advanced_score.failure_risk_score < 30
        );
        
        if (safeBets.length > 0) {
            actions.push({
                priority: 1,
                type: 'accelerate',
                task_id: safeBets[0].id,
                title: `Accelerate: ${safeBets[0].title}`,
                reasoning: 'High confidence, low risk opportunity',
                timeline: 'This week'
            });
        }
        
        return actions;
    }

    estimateTimeline(task) {
        const timeMap = {
            '1 month': '1 month',
            '1-2 months': '6 weeks',
            '2-3 months': '2.5 months',
            '3-4 months': '3.5 months',
            '4-6 months': '5 months'
        };
        
        return timeMap[task.time_to_revenue] || 'Unknown';
    }

    // Helper methods (simplified versions)
    normalizeValue(value, scale) {
        const index = scale.indexOf(value);
        return index >= 0 ? (index + 1) / scale.length : 0.5;
    }

    normalizeTimeValue(timeStr) {
        const timeMap = {
            '1 month': 1.0,
            '1-2 months': 0.8,
            '2-3 months': 0.6,
            '3-4 months': 0.4,
            '4-6 months': 0.2
        };
        return timeMap[timeStr] || 0.5;
    }

    estimateSwitchingCost(task) { return 0.5; }
    estimateDataMoat(task) { return 0.5; }
    estimateIntegrationDepth(task) { return 0.5; }
    estimateBrandLock(task) { return 0.5; }
    estimateAutomationDependency(task) { return 0.5; }
    estimateMarketSize(task) { return 0.5; }
    estimateAutomationPotential(task) { return 0.5; }
    estimateReplicationCost(task) { return 0.5; }
    estimateMarketDependency(task) { return 0.5; }
    estimateNetworkEffects(task) { return 0.5; }
    calculateCashflowScore(task) { return { score: 0.5 }; }

    // Mode management
    setMode(newMode) {
        if (['execution', 'exploration', 'optimization'].includes(newMode)) {
            this.mode = newMode;
            console.log(`[CASCADE] Mode changed to: ${newMode}`);
        } else {
            throw new Error(`Invalid mode: ${newMode}`);
        }
    }

    getMode() {
        return this.mode;
    }
}

module.exports = CascadeEngine;
