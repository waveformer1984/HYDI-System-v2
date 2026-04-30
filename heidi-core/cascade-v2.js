// CASCADE AGENT v2 - Governance Layer
// Enforces strategic coherence and portfolio balance over time

const fs = require('fs').promises;
const path = require('path');

class CascadeEngineV2 {
    constructor() {
        this.mode = "execution";
        this.weights = {
            profit_potential: 0.15,
            time_to_revenue: 0.10,
            complexity: 0.08,
            defensibility: 0.15,
            scalability: 0.12,
            dependency_risk: 0.08,
            cashflow_type: 0.08,
            strategic_coherence: 0.15,
            cross_division_impact: 0.09
        };
        
        // v2 Governance Layer
        this.strategicThemes = [
            "AI Infrastructure Revenue",
            "Industrial Manufacturing Monetization", 
            "Music/IP Asset Expansion",
            "Automation SaaS Ecosystem"
        ];
        
        this.portfolioBalanceTargets = {
            'SaaS / Digital': 0.30,
            'Physical / Industrial': 0.25,
            'IP / Media': 0.25,
            'Infrastructure / Platform': 0.20
        };
        
        this.executionFocusLimit = 3;
        this.coherenceThreshold = 70;
        this.strategicDebtThreshold = 0.6;
        
        this.cache = new Map();
        this.lastUpdate = null;
        this.governanceMetrics = null;
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

    // 1. STRATEGIC THEME MAPPING
    mapTaskToTheme(task) {
        const themeMappings = {
            'AI Infrastructure Revenue': [
                'HEIDI / AI PRODUCTIZATION',
                'Core AI / SaaS Revenue Systems',
                'Automation & Micro-SaaS Ideas'
            ],
            'Industrial Manufacturing Monetization': [
                '3D Printing / Manufacturing Revenue',
                'ProtoForge Industrial Systems',
                'Physical Systems / Mobility / Hardware'
            ],
            'Music/IP Asset Expansion': [
                'Music / Waveformer Revenue Engine',
                'R&D / Grant / Funding Systems'
            ],
            'Automation SaaS Ecosystem': [
                'Platform / Ecosystem Expansion',
                'Growth / Marketing / Revenue Ops'
            ]
        };
        
        for (const [theme, categories] of Object.entries(themeMappings)) {
            if (categories.includes(task.category)) {
                return theme;
            }
        }
        
        // Fallback: try to infer from keywords
        const titleLower = task.title.toLowerCase();
        const descLower = task.description.toLowerCase();
        
        if (titleLower.includes('ai') || descLower.includes('ai') || titleLower.includes('api')) {
            return 'AI Infrastructure Revenue';
        }
        if (titleLower.includes('print') || descLower.includes('manufacturing') || titleLower.includes('hardware')) {
            return 'Industrial Manufacturing Monetization';
        }
        if (titleLower.includes('music') || descLower.includes('beat') || titleLower.includes('licensing')) {
            return 'Music/IP Asset Expansion';
        }
        if (titleLower.includes('automation') || descLower.includes('saas') || titleLower.includes('platform')) {
            return 'Automation SaaS Ecosystem';
        }
        
        return null; // Unmapped - will be downgraded
    }

    // 2. PORTFOLIO BALANCE ENGINE
    calculatePortfolioBalance(tasks) {
        const categoryDistribution = {
            'SaaS / Digital': 0,
            'Physical / Industrial': 0,
            'IP / Media': 0,
            'Infrastructure / Platform': 0
        };
        
        tasks.forEach(task => {
            const category = this.mapTaskToRevenueCategory(task);
            if (category && categoryDistribution[category] !== undefined) {
                categoryDistribution[category]++;
            }
        });
        
        const total = Object.values(categoryDistribution).reduce((sum, val) => sum + val, 0);
        if (total === 0) return categoryDistribution;
        
        // Convert to percentages
        Object.keys(categoryDistribution).forEach(key => {
            categoryDistribution[key] = (categoryDistribution[key] / total) * 100;
        });
        
        // Calculate balance score
        let balanceScore = 100;
        Object.entries(this.portfolioBalanceTargets).forEach(([category, target]) => {
            const actual = categoryDistribution[category] || 0;
            const deviation = Math.abs(actual - (target * 100));
            balanceScore -= deviation * 2; // 2 points per percent deviation
        });
        
        return {
            distribution: categoryDistribution,
            balance_score: Math.max(0, balanceScore),
            needs_rebalancing: balanceScore < 80
        };
    }

    mapTaskToRevenueCategory(task) {
        const categoryMappings = {
            'SaaS / Digital': ['Core AI / SaaS Revenue Systems', 'Automation & Micro-SaaS Ideas', 'Growth / Marketing / Revenue Ops'],
            'Physical / Industrial': ['3D Printing / Manufacturing Revenue', 'ProtoForge Industrial Systems', 'Physical Systems / Mobility / Hardware'],
            'IP / Media': ['Music / Waveformer Revenue Engine', 'R&D / Grant / Funding Systems'],
            'Infrastructure / Platform': ['Platform / Ecosystem Expansion', 'HEIDI / AI PRODUCTIZATION']
        };
        
        for (const [category, categories] of Object.entries(categoryMappings)) {
            if (categories.includes(task.category)) {
                return category;
            }
        }
        
        return null;
    }

    // 3. STRATEGIC DEBT TRACKING
    calculateStrategicDebt(task) {
        let debtScore = 0;
        const factors = [];
        
        // Ollama dependency
        if (task.category.includes('AI') && !task.title.includes('HEIDI')) {
            debtScore += 0.7;
            factors.push('External AI dependency');
        }
        
        // Hardware dependency
        if (task.category.includes('Physical') || task.category.includes('Manufacturing')) {
            debtScore += 0.6;
            factors.push('Hardware infrastructure');
        }
        
        // Platform dependency
        if (task.category.includes('Platform') && !task.title.includes('ProtoForge')) {
            debtScore += 0.5;
            factors.push('Third-party platform');
        }
        
        // Complexity debt
        if (task.complexity === 'high') {
            debtScore += 0.3;
            factors.push('High implementation complexity');
        }
        
        // Time debt
        if (task.time_to_revenue.includes('4-6') || task.time_to_revenue.includes('24+')) {
            debtScore += 0.4;
            factors.push('Extended timeline');
        }
        
        const debtLevel = debtScore > 0.7 ? 'high' : debtScore > 0.4 ? 'medium' : 'low';
        
        return {
            score: debtScore,
            level: debtLevel,
            factors
        };
    }

    // 4. REVENUE EVOLUTION STAGES
    determineEvolutionStage(task) {
        // Default to idea for new tasks
        // In production, this would be tracked in database
        const stageIndicators = {
            'idea': ['new', 'proposed', 'concept'],
            'prototype': ['prototype', 'mvp', 'demo'],
            'validated': ['validated', 'tested', 'proven'],
            'monetized': ['monetized', 'revenue', 'paying'],
            'scaled': ['scaled', 'growth', 'expansion']
        };
        
        // For now, default to idea stage
        // In production, this would be persistent state
        return 'idea';
    }

    // 5. EXECUTION FOCUS ENFORCEMENT
    enforceExecutionFocus(tasks) {
        const activeTasks = tasks.filter(t => t.status === 'active');
        
        if (activeTasks.length <= this.executionFocusLimit) {
            return activeTasks;
        }
        
        // Sort by strategic importance and take top N
        return activeTasks
            .sort((a, b) => b.strategic_importance - a.strategic_importance)
            .slice(0, this.executionFocusLimit);
    }

    // 6. CROSS-DIVISION IMPACT SCORING
    calculateCrossDivisionImpact(task) {
        const divisions = {
            'ProtoForge Core': 0,
            'Waveformer Records': 0,
            'Z Labs / Hardware': 0,
            'AI Systems (HEIDI)': 0
        };
        
        // Analyze task title and description for division keywords
        const text = (task.title + ' ' + task.description).toLowerCase();
        
        // ProtoForge Core impacts
        if (text.includes('protoforge') || text.includes('core') || text.includes('infrastructure')) {
            divisions['ProtoForge Core'] += 0.8;
        }
        
        // Waveformer Records impacts
        if (text.includes('music') || text.includes('beat') || text.includes('licensing') || text.includes('waveformer')) {
            divisions['Waveformer Records'] += 0.8;
        }
        
        // Z Labs / Hardware impacts
        if (text.includes('3d') || text.includes('print') || text.includes('manufacturing') || text.includes('hardware')) {
            divisions['Z Labs / Hardware'] += 0.8;
        }
        
        // AI Systems impacts
        if (text.includes('ai') || text.includes('heidi') || text.includes('automation') || text.includes('api')) {
            divisions['AI Systems (HEIDI)'] += 0.8;
        }
        
        // Calculate impact score
        const activeDivisions = Object.values(divisions).filter(score => score > 0).length;
        const maxImpact = Math.max(...Object.values(divisions));
        
        let impactScore = maxImpact;
        
        // Exponential boost for multi-division impact
        if (activeDivisions >= 3) {
            impactScore *= 2.0;
        } else if (activeDivisions >= 2) {
            impactScore *= 1.5;
        }
        
        return {
            score: Math.min(impactScore, 2.0), // Cap at 2.0
            divisions: Object.entries(divisions)
                .filter(([name, score]) => score > 0)
                .map(([name, score]) => ({ division: name, impact: score })),
            active_divisions: activeDivisions
        };
    }

    // 7. EXISTENCE REASON VALIDATION
    validateExistenceReason(task) {
        const reasons = {
            revenue: ['revenue', 'monetize', 'profit', 'arpu', 'cashflow'],
            efficiency: ['automate', 'optimize', 'streamline', 'efficiency'],
            growth: ['scale', 'expand', 'grow', 'acquisition'],
            defense: ['defend', 'protect', 'moat', 'competitive'],
            innovation: ['innovate', 'new', 'breakthrough', 'disrupt']
        };
        
        const text = (task.title + ' ' + task.description).toLowerCase();
        
        let primaryReason = null;
        let confidence = 0;
        
        for (const [reason, keywords] of Object.entries(reasons)) {
            const matches = keywords.filter(keyword => text.includes(keyword)).length;
            if (matches > confidence) {
                confidence = matches;
                primaryReason = reason;
            }
        }
        
        if (!primaryReason) {
            return {
                valid: false,
                reason: null,
                confidence: 0,
                message: 'Cannot justify strategic purpose'
            };
        }
        
        return {
            valid: true,
            reason: primaryReason,
            confidence,
            message: `Primary purpose: ${primaryReason}`
        };
    }

    // 8. FAILURE SIMULATION LAYER
    simulateFailureScenarios(task) {
        const scenarios = [];
        
        // Scenario 1: Market adoption failure
        if (task.profit_potential === 'very_high') {
            scenarios.push({
                type: 'market_adoption_failure',
                probability: 0.3,
                impact: 'high',
                description: 'Market fails to adopt high-value proposition',
                mitigation: 'Start with MVP, iterate based on early feedback'
            });
        }
        
        // Scenario 2: Revenue delay
        if (task.time_to_revenue.includes('4-6') || task.time_to_revenue.includes('24+')) {
            scenarios.push({
                type: 'revenue_delay',
                probability: 0.4,
                impact: 'medium',
                description: 'Revenue generation takes longer than expected',
                mitigation: 'Build interim cashflow products, secure bridge funding'
            });
        }
        
        // Scenario 3: Dependency breakage
        const strategicDebt = this.calculateStrategicDebt(task);
        if (strategicDebt.level === 'high') {
            scenarios.push({
                type: 'dependency_breakage',
                probability: 0.5,
                impact: 'critical',
                description: 'Key dependency becomes unavailable or changes',
                mitigation: 'Develop backup solutions, reduce dependency coupling'
            });
        }
        
        // Scenario 4: Competitive pressure
        if (task.defensibility && task.defensibility.grade === 'D') {
            scenarios.push({
                type: 'competitive_pressure',
                probability: 0.6,
                impact: 'high',
                description: 'Competitors copy or outperform the solution',
                mitigation: 'Focus on unique value props, build switching costs'
            });
        }
        
        return {
            scenarios,
            overall_risk: scenarios.reduce((risk, s) => risk + (s.probability * this.impactWeight(s.impact)), 0),
            has_mitigation: scenarios.every(s => s.mitigation)
        };
    }

    impactWeight(impact) {
        const weights = { 'critical': 1.0, 'high': 0.7, 'medium': 0.4, 'low': 0.2 };
        return weights[impact] || 0.5;
    }

    // 9. STRATEGIC COHERENCE SCORE
    calculateStrategicCoherence(tasks) {
        let coherenceScore = 100;
        const issues = [];
        
        // Theme alignment
        const themeCoverage = {};
        this.strategicThemes.forEach(theme => {
            themeCoverage[theme] = 0;
        });
        
        tasks.forEach(task => {
            if (task.strategic_theme) {
                themeCoverage[task.strategic_theme]++;
            }
        });
        
        const uncoveredThemes = this.strategicThemes.filter(theme => themeCoverage[theme] === 0);
        if (uncoveredThemes.length > 0) {
            coherenceScore -= uncoveredThemes.length * 10;
            issues.push(`${uncoveredThemes.length} strategic themes uncovered`);
        }
        
        // Portfolio balance
        const balance = this.calculatePortfolioBalance(tasks);
        if (balance.needs_rebalancing) {
            coherenceScore -= 20;
            issues.push('Portfolio needs rebalancing');
        }
        
        // Execution focus compliance
        const activeTasks = tasks.filter(t => t.status === 'active');
        if (activeTasks.length > this.executionFocusLimit) {
            coherenceScore -= 15;
            issues.push(`Too many active tasks (${activeTasks.length} > ${this.executionFocusLimit})`);
        }
        
        // Strategic debt
        const avgDebt = tasks.reduce((sum, t) => sum + (t.strategic_debt?.score || 0), 0) / tasks.length;
        if (avgDebt > this.strategicDebtThreshold) {
            coherenceScore -= 25;
            issues.push('High strategic debt concentration');
        }
        
        // Existence reason validation
        const invalidTasks = tasks.filter(t => !t.existence_reason?.valid);
        if (invalidTasks.length > 0) {
            coherenceScore -= invalidTasks.length * 5;
            issues.push(`${invalidTasks.length} tasks lack clear purpose`);
        }
        
        return {
            score: Math.max(0, coherenceScore),
            issues,
            theme_coverage: themeCoverage,
            portfolio_balance: balance,
            status: coherenceScore >= this.coherenceThreshold ? 'healthy' : 'warning'
        };
    }

    // MAIN REPRIORITIZATION FUNCTION (v2)
    async reprioritizeTasks() {
        const revenueData = await this.loadRevenueTasks();
        const enhancedTasks = [];
        
        // Process each task through v2 governance
        for (const task of revenueData.tasks) {
            // Strategic theme mapping
            const strategicTheme = this.mapTaskToTheme(task);
            if (!strategicTheme) {
                console.warn(`[CASCADE v2] Task ${task.id} unmapped to strategic theme - downgrading`);
            }
            
            // Cross-division impact
            const crossDivisionImpact = this.calculateCrossDivisionImpact(task);
            
            // Existence reason validation
            const existenceReason = this.validateExistenceReason(task);
            
            // Strategic debt
            const strategicDebt = this.calculateStrategicDebt(task);
            
            // Evolution stage
            const evolutionStage = this.determineEvolutionStage(task);
            
            // Failure simulation
            const failureSimulation = this.simulateFailureScenarios(task);
            
            // Core scoring (inherited from v1)
            const advancedScore = this.calculateAdvancedScore(task);
            
            // Strategic coherence contribution
            const strategicCoherenceContribution = this.calculateCoherenceContribution(task, strategicTheme, crossDivisionImpact);
            
            // Apply mode adjustments
            const modeAdjustedScore = this.applyModeAdjustments(advancedScore.total_score, task);
            
            // Apply governance penalties/bonuses
            let governanceAdjustedScore = modeAdjustedScore;
            
            // Theme alignment bonus/penalty
            if (strategicTheme) {
                governanceAdjustedScore *= 1.1;
            } else {
                governanceAdjustedScore *= 0.7; // Unmapped tasks penalized
            }
            
            // Cross-division impact bonus
            if (crossDivisionImpact.active_divisions >= 2) {
                governanceAdjustedScore *= 1.2;
            }
            
            // Strategic debt penalty
            if (strategicDebt.level === 'high') {
                governanceAdjustedScore *= 0.6;
            }
            
            // Existence reason validation
            if (!existenceReason.valid) {
                governanceAdjustedScore *= 0.5;
            }
            
            // Determine status
            const status = this.determineTaskStatusV2(task, advancedScore, strategicDebt, existenceReason, failureSimulation);
            
            enhancedTasks.push({
                ...task,
                // v1 fields
                advanced_score: advancedScore,
                // v2 governance fields
                strategic_theme,
                cross_division_impact: crossDivisionImpact,
                existence_reason,
                strategic_debt: strategicDebt,
                evolution_stage: evolutionStage,
                failure_simulation: failureSimulation,
                strategic_coherence_contribution: strategicCoherenceContribution,
                governance_adjusted_score: Math.round(governanceAdjustedScore),
                status
            });
        }
        
        // Sort by governance-adjusted score
        enhancedTasks.sort((a, b) => b.governance_adjusted_score - a.governance_adjusted_score);
        
        // Enforce execution focus limit
        const focusedTasks = this.enforceExecutionFocus(enhancedTasks);
        
        // Calculate system-level metrics
        const portfolioBalance = this.calculatePortfolioBalance(focusedTasks);
        const strategicCoherence = this.calculateStrategicCoherence(focusedTasks);
        
        // Update governance metrics
        this.governanceMetrics = {
            portfolio_balance,
            strategic_coherence,
            execution_focus: focusedTasks.length,
            governance_health: strategicCoherence.status,
            last_update: new Date().toISOString()
        };
        
        // Cache results
        this.lastUpdate = new Date().toISOString();
        this.cache.set('enhanced_tasks_v2', enhancedTasks);
        this.cache.set('governance_metrics', this.governanceMetrics);
        
        return {
            tasks: enhancedTasks,
            focused_tasks: focusedTasks,
            governance_metrics: this.governanceMetrics,
            strategic_themes: this.getThemeDistribution(enhancedTasks),
            portfolio_balance,
            recommended_actions: this.generateGovernanceActions(enhancedTasks, strategicCoherence),
            warnings: this.generateGovernanceWarnings(strategicCoherence),
            metadata: {
                mode: this.mode,
                last_update: this.lastUpdate,
                total_tasks: enhancedTasks.length,
                active_tasks: focusedTasks.length,
                coherence_score: strategicCoherence.score,
                governance_health: strategicCoherence.status
            }
        };
    }

    calculateCoherenceContribution(task, theme, crossDivisionImpact) {
        let contribution = 0.5; // Base contribution
        
        // Theme alignment
        if (theme) contribution += 0.2;
        
        // Cross-division impact
        if (crossDivisionImpact.active_divisions >= 2) contribution += 0.3;
        
        return Math.min(contribution, 1.0);
    }

    getThemeDistribution(tasks) {
        const distribution = {};
        this.strategicThemes.forEach(theme => {
            distribution[theme] = tasks.filter(t => t.strategic_theme === theme).length;
        });
        return distribution;
    }

    generateGovernanceActions(tasks, coherence) {
        const actions = [];
        
        // Balance rebalancing actions
        if (coherence.issues.includes('Portfolio needs rebalancing')) {
            const balance = this.calculatePortfolioBalance(tasks);
            Object.entries(balance.distribution).forEach(([category, percentage]) => {
                const target = this.portfolioBalanceTargets[category] * 100;
                if (percentage < target * 0.8) {
                    actions.push({
                        priority: 'high',
                        type: 'rebalance_portfolio',
                        category,
                        current: `${percentage.toFixed(1)}%`,
                        target: `${(target * 100).toFixed(1)}%`,
                        message: `Increase ${category} focus from ${percentage.toFixed(1)}% to ${(target * 100).toFixed(1)}%`
                    });
                }
            });
        }
        
        // Strategic debt actions
        const highDebtTasks = tasks.filter(t => t.strategic_debt.level === 'high');
        if (highDebtTasks.length > 0) {
            actions.push({
                priority: 'critical',
                type: 'address_strategic_debt',
                tasks: highDebtTasks.map(t => t.id),
                message: `Address ${highDebtTasks.length} high-debt tasks before proceeding`
            });
        }
        
        // Execution focus actions
        const activeTasks = tasks.filter(t => t.status === 'active');
        if (activeTasks.length > this.executionFocusLimit) {
            actions.push({
                priority: 'medium',
                type: 'limit_execution_focus',
                current: activeTasks.length,
                target: this.executionFocusLimit,
                message: `Reduce active tasks from ${activeTasks.length} to ${this.executionFocusLimit}`
            });
        }
        
        return actions.slice(0, 10);
    }

    generateGovernanceWarnings(coherence) {
        return coherence.issues.map(issue => ({
            type: 'governance_warning',
            message: issue,
            severity: coherence.score < 60 ? 'critical' : 'warning'
        }));
    }

    // Helper methods (inherited from v1)
    calculateAdvancedScore(task) {
        // Simplified version - full implementation would be in v1
        return {
            total_score: 75,
            confidence_score: 80,
            failure_risk_score: 25,
            breakdown: {
                profit_potential: 80,
                time_to_revenue: 70,
                complexity: 60,
                defensibility: 75,
                scalability: 70,
                dependency_risk: 30,
                cashflow_type: 75
            }
        };
    }

    applyModeAdjustments(baseScore, task) {
        let adjusted = baseScore;
        
        switch (this.mode) {
            case 'execution':
                if (task.evolution_stage === 'monetized') adjusted *= 1.3;
                break;
            case 'exploration':
                if (task.evolution_stage === 'idea') adjusted *= 1.2;
                break;
            case 'optimization':
                if (task.evolution_stage === 'scaled') adjusted *= 1.4;
                break;
        }
        
        return adjusted;
    }

    determineTaskStatusV2(task, advancedScore, strategicDebt, existenceReason, failureSimulation) {
        // Killed tasks
        if (!existenceReason.valid || strategicDebt.level === 'high' || failureSimulation.overall_risk > 0.8) {
            return 'killed';
        }
        
        // Dormant tasks
        if (advancedScore.failure_risk_score > 70 || failureSimulation.has_mitigation === false) {
            return 'dormant';
        }
        
        return 'active';
    }

    // Mode management
    setMode(newMode) {
        if (['execution', 'exploration', 'optimization'].includes(newMode)) {
            this.mode = newMode;
            console.log(`[CASCADE v2] Mode changed to: ${newMode}`);
        } else {
            throw new Error(`Invalid mode: ${newMode}`);
        }
    }

    getMode() {
        return this.mode;
    }

    getGovernanceMetrics() {
        return this.governanceMetrics;
    }
}

module.exports = CascadeEngineV2;
