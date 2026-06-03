'use client';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
    role: ChatRole;
    content: string;
}

export interface ModelsResponse {
    available: boolean;
    default_model?: string;
    models: Array<{ name: string }>;
}

export interface ChatResponse {
    success: boolean;
    response?: string;
    model?: string;
    error?: string;
}

export interface LLMHealthResponse {
    ollama_available: boolean;
}

export interface HYDIGenerateTaskResponse {
    success: boolean;
    task?: any;
    error?: string;
}

export interface HYDIExecuteTaskResponse {
    success: boolean;
    result?: any;
    error?: string;
}

export interface HYDITaskStatusResponse {
    success: boolean;
    task?: any;
    error?: string;
}

export interface IntakeSubmitOptions {
    title: string;
    description?: string;
    task_type?: string;
    priority?: number;       // 1-100
    requested_by?: string;
    input_payload?: Record<string, unknown>;
}

export interface IntakeItem {
    id: string;
    title: string;
    task_type: string;
    priority: number;
    status: 'queued' | 'running' | 'done' | 'failed';
    requested_by: string | null;
    result: unknown | null;
    created_at: string;
    completed_at: string | null;
}

export interface QueueStats {
    queued: number;
    running: number;
    done: number;
    failed: number;
    total: number;
}

export interface InferenceResult {
    success: boolean;
    response: string;
    provider: string;
    model: string;
    duration_ms: number;
    error?: string;
}

export class ProjectOpsClient {
    private baseUrl: string;

    constructor(baseUrl?: string) {
        this.baseUrl = (baseUrl || process.env.NEXT_PUBLIC_PROJECT_OPS_URL || 'http://localhost:3100').replace(/\/$/, '');
    }

    private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...(init?.headers || {}),
            },
        });

        const text = await res.text();
        let json: any;

        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            json = { error: text };
        }

        if (!res.ok) {
            const message = json?.error || json?.message || `Request failed: ${res.status}`;
            throw new Error(message);
        }

        return json as T;
    }

    async health(): Promise<LLMHealthResponse> {
        return this.requestJson<LLMHealthResponse>('/api/llm/health');
    }

    async listModels(): Promise<ModelsResponse> {
        return this.requestJson<ModelsResponse>('/api/models');
    }

    async chat(messages: ChatMessage[], model?: string): Promise<ChatResponse> {
        return this.requestJson<ChatResponse>('/api/llm/chat', {
            method: 'POST',
            body: JSON.stringify({ messages, model }),
        });
    }

    async generateHYDITask(objective: string): Promise<HYDIGenerateTaskResponse> {
        return this.requestJson<HYDIGenerateTaskResponse>('/api/hydi/tasks/generate', {
            method: 'POST',
            body: JSON.stringify({
                template_id: 'protoforge_workflow',
                variables: { objective },
                priority: 3,
                requested_by: 'copilot',
            }),
        });
    }

    async executeHYDITask(taskId: string): Promise<HYDIExecuteTaskResponse> {
        return this.requestJson<HYDIExecuteTaskResponse>('/api/hydi/tasks/execute', {
            method: 'POST',
            body: JSON.stringify({ task_id: taskId }),
        });
    }

    async getHYDITaskStatus(taskId: string): Promise<HYDITaskStatusResponse> {
        return this.requestJson<HYDITaskStatusResponse>(`/api/hydi/tasks/status/${encodeURIComponent(taskId)}`);
    }

    async completeHYDITask(taskId: string, result?: unknown): Promise<HYDITaskStatusResponse> {
        return this.requestJson<HYDITaskStatusResponse>('/api/hydi/tasks/complete', {
            method: 'POST',
            body: JSON.stringify({ task_id: taskId, result }),
        });
    }

    // ── Intake queue (Supabase-backed persistent queue) ─────────────────────

    /** Submit an objective to the persistent agent work queue */
    async submitToQueue(opts: IntakeSubmitOptions): Promise<IntakeItem> {
        const res = await this.requestJson<{ success: boolean; item: IntakeItem }>('/api/intake/submit', {
            method: 'POST',
            body: JSON.stringify(opts),
        });
        return res.item;
    }

    /** Get queue stats + recent items */
    async getQueueStatus(): Promise<{ stats: QueueStats; recent: IntakeItem[] }> {
        const res = await this.requestJson<{ success: boolean; stats: QueueStats; recent: IntakeItem[] }>('/api/intake/queue');
        return { stats: res.stats, recent: res.recent };
    }

    /** Get status of a single queue item */
    async getQueueItem(id: string): Promise<IntakeItem> {
        const res = await this.requestJson<{ success: boolean; item: IntakeItem }>(`/api/intake/status/${encodeURIComponent(id)}`);
        return res.item;
    }

    // ── Direct inference (bypasses queue, immediate response) ───────────────

    /** Run inference through the Ollama → OpenVINO → Claude stack */
    async infer(prompt: string, options?: { system?: string; model?: string }): Promise<InferenceResult> {
        return this.requestJson<InferenceResult>('/api/llm/generate', {
            method: 'POST',
            body: JSON.stringify({ prompt, system: options?.system, model: options?.model }),
        });
    }

    /** Get executor status (running tasks, queue depth, recently completed) */
    async getExecutorStatus(): Promise<{ isRunning: boolean; queueSize: number; recentlyCompleted: number }> {
        const res = await this.requestJson<{ success: boolean; status: { isRunning: boolean; queueSize: number; recentlyCompleted: number } }>('/api/hydi-executor/status');
        return res.status;
    }

    /** Start the local GPU executor */
    async startExecutor(): Promise<void> {
        await this.requestJson('/api/hydi-executor/start', { method: 'POST' });
    }
}

export const projectOps = new ProjectOpsClient();
