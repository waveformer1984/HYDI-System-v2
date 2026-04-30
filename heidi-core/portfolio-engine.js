// Portfolio Construction Engine
// Upgrades HEIDI from ranking to strategic portfolio management

const fs = require('fs').promises;
const path = require('path');

class PortfolioEngine {
    constructor() {
        this.weights = {
            // Core revenue scoring
            profit_potential: 0.25,
            time_to_revenue: 0.20,
            complexity: 0.15,
            
            // Second-order intelligence
            defensibility: 0.20,
            synergy: 0.15,
            cashflow_type: 0.05
        };
        
        this.defensibilityFactors = {
            ip_potential: { 'high': 1.0, 'medium': 0.6, 'low': 0.3 },
            switching_cost: { 'high': 1.0, 'medium': 0.5, 'low': 0.2 },
            network_effects: { 'strong': 1.0, 'moderate': 0.6, 'none': 0.2 },
            market_moat: { 'wide': 1.0, 'medium': 0.6, 'narrow': 0.3 }
        };
        
        this.cashflowTypes = {
            'immediate_cash': { score: 0.8, horizon: '3-6 months' },
            'long_term_asset': { score: 0.6, horizon: '12-24 months' },
            'hybrid': { score: 1.0, horizon: '6-12 months' },
            'strategic_investment': { score: 0.4, horizon: '24+ months' }
        };
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

    calculateDefensibilityScore(task) {
        // Default defensibility factors (would be enhanced with real data)
        const factors = {
            ip_potential: this.estimateIPPotential(task),
            switching_cost: this.estimateSwitchingCost(task),
            network_effects: this.estimateNetworkEffects(task),
            market_moat: this.estimateMarketMoat(task)
        };

        const scores = Object.entries(factors).map(([key, value]) => 
            this.defensibilityFactors[key][value] || 0.5
        );

        return {
            score: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100),
            breakdown: factors
        };
    }

    estimateIPPotential(task) {
        const ipKeywords = ['AI', 'API', 'platform', 'algorithm', 'proprietary', 'technology'];
        const titleLower = task.title.toLowerCase();
        const descLower = task.description.toLowerCase();
        
        const hasIP = ipKeywords.some(keyword => 
            titleLower.includes(keyword.toLowerCase()) || descLower.includes(keyword.toLowerCase())
        );
        
        if (hasIP && task.category.includes('AI')) return 'high';
        if (hasIP) return 'medium';
        return 'low';
    }

    estimateSwitchingCost(task) {
        const highSwitchingCategories = ['HEIDI / AI PRODUCTIZATION', 'Platform / Ecosystem Expansion'];
        const mediumSwitchingCategories = ['Core AI / SaaS Revenue Systems', 'Automation & Micro-SaaS Ideas'];
        
        if (highSwitchingCategories.includes(task.category)) return 'high';
        if (mediumSwitchingCategories.includes(task.category)) return 'medium';
        return 'low';
    }

    estimateNetworkEffects(task) {
        const networkKeywords = ['marketplace', 'platform', 'ecosystem', 'network', 'community'];
        const descLower = task.description.toLowerCase();
        
        const hasNetwork = networkKeywords.some(keyword => descLower.includes(keyword));
        
        if (hasNetwork && task.category.includes('Platform')) return 'strong';
        if (hasNetwork) return 'moderate';
        return 'none';
    }

    estimateMarketMoat(task) {
        // Estimate based on category uniqueness
        const uniqueCategories = ['HEIDI / AI PRODUCTIZATION', 'Music / Waveformer Revenue Engine'];
        const competitiveCategories = ['Core AI / SaaS Revenue Systems', '3D Printing / Manufacturing Revenue'];
        
        if (uniqueCategories.includes(task.category)) return 'wide';
        if (competitiveCategories.includes(task.category)) return 'medium';
        return 'narrow';
    }

    calculateSynergyScore(task, allTasks) {
        const synergies = [];
        
        // Find complementary tasks
        allTasks.forEach(otherTask => {
            if (task.id === otherTask.id) return;
            
            const synergyScore = this.calculateTaskSynergy(task, otherTask);
            if (synergyScore > 0.3) {
                synergies.push({
                    task_id: otherTask.id,
                    title: otherTask.title,
                    score: synergyScore,
                    type: this.identifySynergyType(task, otherTask)
                });
            }
        });
        
        const totalSynergy = synergies.reduce((sum, s) => sum + s.score, 0);
        const normalizedScore = Math.min(totalSynergy / 3, 1.0); // Cap at 1.0
        
        return {
            score: Math.round(normalizedScore * 100),
            synergies: synergies.sort((a, b) => b.score - a.score).slice(0, 3)
        };
    }

    calculateTaskSynergy(task1, task2) {
        let synergy = 0;
        
        // Category synergy (same category = some synergy)
        if (task1.category === task2.category) synergy += 0.3;
        
        // Technology synergy (AI + AI, Platform + Platform)
        const techKeywords1 = this.extractTechKeywords(task1);
        const techKeywords2 = this.extractTechKeywords(task2);
        const commonTech = techKeywords1.filter(k => techKeywords2.includes(k));
        synergy += commonTech.length * 0.2;
        
        // Customer overlap
        if (this.shareCustomerBase(task1, task2)) synergy += 0.4;
        
        // Resource sharing
        if (this.shareResources(task1, task2)) synergy += 0.3;
        
        return Math.min(synergy, 1.0);
    }

    extractTechKeywords(task) {
        const text = (task.title + ' ' + task.description).toLowerCase();
        const keywords = [];
        
        const techMap = {
            'ai': ['ai', 'machine learning', 'neural', 'algorithm', 'model', 'automation'],
            'api': ['api', 'interface', 'integration', 'endpoint'],
            'platform': ['platform', 'ecosystem', 'marketplace'],
            'manufacturing': ['3d', 'print', 'manufacturing', 'fabrication'],
            'music': ['music', 'beat', 'audio', 'sound', 'licensing']
        };
        
        Object.entries(techMap).forEach(([category, terms]) => {
            if (terms.some(term => text.includes(term))) {
                keywords.push(category);
            }
        });
        
        return keywords;
    }

    shareCustomerBase(task1, task2) {
        // B2B focus overlap
        const b2bKeywords = ['business', 'enterprise', 'b2b', 'client', 'customer'];
        const text1 = (task1.title + ' ' + task1.description).toLowerCase();
        const text2 = (task2.title + ' ' + task2.description).toLowerCase();
        
        const task1B2B = b2bKeywords.some(kw => text1.includes(kw));
        const task2B2B = b2bKeywords.some(kw => text2.includes(kw));
        
        return task1B2B && task2B2B;
    }

    shareResources(task1, task2) {
        // Same resource requirements
        const resourceKeywords = {
            'development': ['build', 'develop', 'code', 'software'],
            'hardware': ['equipment', 'hardware', 'machine', 'device'],
            'content': ['content', 'media', 'creative', 'design']
        };
        
        const text1 = (task1.title + ' ' + task1.description).toLowerCase();
        const text2 = (task2.title + ' ' + task2.description).toLowerCase();
        
        for (const [resource, keywords] of Object.entries(resourceKeywords)) {
            const task1Uses = keywords.some(kw => text1.includes(kw));
            const task2Uses = keywords.some(kw => text2.includes(kw));
            if (task1Uses && task2Uses) return true;
        }
        
        return false;
    }

    identifySynergyType(task1, task2) {
        if (task1.category === task2.category) return 'category';
        if (this.shareCustomerBase(task1, task2)) return 'customer';
        if (this.shareResources(task1, task2)) return 'resource';
        return 'technology';
    }

    calculateCashflowScore(task) {
        // Estimate cashflow type based on category and time to revenue
        const quickCashCategories = ['Automation & Micro-SaaS Ideas', 'Core AI / SaaS Revenue Systems'];
        const assetCategories = ['Platform / Ecosystem Expansion', 'HEIDI / AI PRODUCTIZATION'];
        
        if (quickCashCategories.includes(task.category) && task.time_to_revenue.includes('1-2')) {
            return this.cashflowTypes['immediate_cash'];
        } else if (assetCategories.includes(task.category)) {
            return this.cashflowTypes['long_term_asset'];
        } else if (task.profit_potential === 'very_high') {
            return this.cashflowTypes['hybrid'];
        } else {
            return this.cashflowTypes['strategic_investment'];
        }
    }

    async constructPortfolio() {
        const revenueData = await this.loadRevenueTasks();
        const enhancedTasks = [];

        for (const task of revenueData.tasks) {
            // Calculate second-order scores
            const defensibility = this.calculateDefensibilityScore(task);
            const synergy = this.calculateSynergyScore(task, revenueData.tasks);
            const cashflow = this.calculateCashflowScore(task);
            
            // Calculate portfolio score
            const portfolioScore = this.calculatePortfolioScore(task, defensibility, synergy, cashflow);
            
            enhancedTasks.push({
                ...task,
                defensibility,
                synergy,
                cashflow,
                portfolio_score: portfolioScore,
                founder_intent: this.calculateFounderIntent(task, defensibility, cashflow)
            });
        }

        // Sort by portfolio score
        enhancedTasks.sort((a, b) => b.portfolio_score.score - a.portfolio_score.score);

        return {
            tasks: enhancedTasks,
            portfolio_construction: this.buildPortfolioStrategy(enhancedTasks),
            synergy_map: this.buildSynergyMap(enhancedTasks),
            cashflow_timeline: this.buildCashflowTimeline(enhancedTasks)
        };
    }

    calculatePortfolioScore(task, defensibility, synergy, cashflow) {
        // Normalize base scores
        const baseScores = {
            profit_potential: this.normalizeValue(task.profit_potential, ['low', 'medium', 'high', 'very_high']),
            time_to_revenue: this.normalizeTimeValue(task.time_to_revenue),
            complexity: this.normalizeValue(task.complexity, ['low', 'medium', 'high'])
        };

        // Calculate weighted score
        const weightedScore = 
            (baseScores.profit_potential * this.weights.profit_potential) +
            (baseScores.time_to_revenue * this.weights.time_to_revenue) +
            (baseScores.complexity * this.weights.complexity) +
            (defensibility.score / 100 * this.weights.defensibility) +
            (synergy.score / 100 * this.weights.synergy) +
            (cashflow.score * this.weights.cashflow_type);

        return {
            score: Math.round(weightedScore * 100),
            breakdown: {
                revenue: Math.round((baseScores.profit_potential + baseScores.time_to_revenue + baseScores.complexity) * 33),
                defensibility: defensibility.score,
                synergy: synergy.score,
                cashflow: Math.round(cashflow.score * 100)
            }
        };
    }

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

    calculateFounderIntent(task, defensibility, cashflow) {
        // Should ProtoForge own this forever or extract value?
        const defensibilityScore = defensibility.score / 100;
        const cashflowScore = cashflow.score;
        
        if (defensibilityScore > 0.7 && cashflow.type === 'long_term_asset') {
            return { intent: 'own_forever', confidence: 0.8 };
        } else if (cashflowScore > 0.7 && cashflow.type === 'immediate_cash') {
            return { intent: 'extract_value', confidence: 0.7 };
        } else {
            return { intent: 'hybrid', confidence: 0.6 };
        }
    }

    buildPortfolioStrategy(tasks) {
        const critical = tasks.filter(t => t.portfolio_score.score >= 80);
        const high = tasks.filter(t => t.portfolio_score.score >= 60 && t.portfolio_score.score < 80);
        const medium = tasks.filter(t => t.portfolio_score.score >= 40 && t.portfolio_score.score < 60);
        
        return {
            immediate_focus: critical.slice(0, 3),
            growth_pipeline: high.slice(0, 5),
            strategic_reserve: medium.slice(0, 3),
            portfolio_balance: {
                cash_generating: tasks.filter(t => t.cashflow.type === 'immediate_cash').length,
                asset_building: tasks.filter(t => t.cashflow.type === 'long_term_asset').length,
                hybrid_plays: tasks.filter(t => t.cashflow.type === 'hybrid').length
            }
        };
    }

    buildSynergyMap(tasks) {
        const synergyMap = {};
        
        tasks.forEach(task => {
            if (task.synergy.synergies.length > 0) {
                synergyMap[task.id] = {
                    title: task.title,
                    synergies: task.synergy.synergies
                };
            }
        });
        
        return synergyMap;
    }

    buildCashflowTimeline(tasks) {
        const timeline = {};
        
        tasks.forEach(task => {
            const horizon = task.cashflow.horizon;
            if (!timeline[horizon]) {
                timeline[horizon] = [];
            }
            timeline[horizon].push({
                id: task.id,
                title: task.title,
                cashflow_type: task.cashflow.type,
                portfolio_score: task.portfolio_score.score
            });
        });
        
        return timeline;
    }
}

module.exports = PortfolioEngine;
