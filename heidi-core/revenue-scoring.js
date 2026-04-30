// Revenue Task Scoring System for HEIDI
// Scores and prioritizes revenue-generating tasks

const fs = require('fs').promises;
const path = require('path');

class RevenueScorer {
    constructor() {
        this.tasksFile = path.join(__dirname, 'revenue-tasks.json');
        this.weights = {
            profit_potential: 0.4,
            time_to_revenue: 0.3,
            complexity: 0.3
        };
    }

    async loadTasks() {
        try {
            const data = await fs.readFile(this.tasksFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to load revenue tasks:', error);
            return { tasks: [] };
        }
    }

    normalizeScore(value, type) {
        const mappings = {
            profit_potential: {
                'very_high': 1.0, 'high': 0.8, 'medium': 0.5, 'low': 0.3
            },
            time_to_revenue: {
                '1 month': 1.0, '1-2 months': 0.8, '2-3 months': 0.6,
                '3-4 months': 0.4, '4-6 months': 0.2
            },
            complexity: {
                'low': 1.0, 'medium': 0.6, 'high': 0.3
            }
        };
        return mappings[type][value] || 0.5;
    }

    calculateScore(task) {
        const profitScore = this.normalizeScore(task.profit_potential, 'profit_potential');
        const timeScore = this.normalizeScore(task.time_to_revenue, 'time_to_revenue');
        const complexityScore = this.normalizeScore(task.complexity, 'complexity');

        const weightedScore = 
            (profitScore * this.weights.profit_potential) +
            (timeScore * this.weights.time_to_revenue) +
            (complexityScore * this.weights.complexity);

        return {
            score: Math.round(weightedScore * 100),
            breakdown: {
                profit_potential: Math.round(profitScore * 100),
                time_to_revenue: Math.round(timeScore * 100),
                complexity: Math.round(complexityScore * 100)
            }
        };
    }

    async scoreAllTasks() {
        const data = await this.loadTasks();
        const scoredTasks = [];

        for (const task of data.tasks) {
            const scoring = this.calculateScore(task);
            scoredTasks.push({
                ...task,
                scoring,
                priority: this.getPriority(scoring.score)
            });
        }

        // Sort by score (highest first)
        scoredTasks.sort((a, b) => b.scoring.score - a.scoring.score);

        return {
            tasks: scoredTasks,
            summary: this.generateSummary(scoredTasks)
        };
    }

    getPriority(score) {
        if (score >= 80) return 'Critical';
        if (score >= 60) return 'High';
        if (score >= 40) return 'Medium';
        return 'Low';
    }

    generateSummary(tasks) {
        const byPriority = {
            Critical: tasks.filter(t => t.priority === 'Critical').length,
            High: tasks.filter(t => t.priority === 'High').length,
            Medium: tasks.filter(t => t.priority === 'Medium').length,
            Low: tasks.filter(t => t.priority === 'Low').length
        };

        const byCategory = {};
        tasks.forEach(task => {
            if (!byCategory[task.category]) {
                byCategory[task.category] = [];
            }
            byCategory[task.category].push(task);
        });

        const topCategories = Object.entries(byCategory)
            .map(([cat, tasks]) => ({
                category: cat,
                avgScore: Math.round(tasks.reduce((sum, t) => sum + t.scoring.score, 0) / tasks.length),
                count: tasks.length
            }))
            .sort((a, b) => b.avgScore - a.avgScore)
            .slice(0, 3);

        return {
            total_tasks: tasks.length,
            by_priority: byPriority,
            top_categories: topCategories,
            avg_score: Math.round(tasks.reduce((sum, t) => sum + t.scoring.score, 0) / tasks.length)
        };
    }

    async getTopTasks(count = 5) {
        const scored = await this.scoreAllTasks();
        return scored.tasks.slice(0, count);
    }

    async getTasksByCategory(category) {
        const scored = await this.scoreAllTasks();
        return scored.tasks.filter(task => task.category === category);
    }
}

module.exports = RevenueScorer;
