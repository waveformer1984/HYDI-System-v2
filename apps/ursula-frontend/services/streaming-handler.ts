/**
 * STREAMING HANDLER
 * 
 * Server-Sent Events for real-time responses
 */

type Response = any;

export interface StreamChunk {
  type: 'text' | 'data' | 'action' | 'complete' | 'error';
  content: any;
  timestamp: Date;
}

export class StreamingHandler {
  private response: Response;
  private isActive: boolean = true;

  constructor(response: Response) {
    this.response = response;

    // Set up SSE headers
    this.response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
  }

  send(chunk: StreamChunk): void {
    if (!this.isActive) return;

    this.response.write(`event: ${chunk.type}\n`);
    this.response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  sendText(text: string): void {
    this.send({
      type: 'text',
      content: text,
      timestamp: new Date()
    });
  }

  sendData(data: any): void {
    this.send({
      type: 'data',
      content: data,
      timestamp: new Date()
    });
  }

  sendAction(action: string): void {
    this.send({
      type: 'action',
      content: action,
      timestamp: new Date()
    });
  }

  complete(): void {
    this.send({
      type: 'complete',
      content: { status: 'done' },
      timestamp: new Date()
    });
    this.close();
  }

  error(error: Error): void {
    this.send({
      type: 'error',
      content: { error: error.message },
      timestamp: new Date()
    });
    this.close();
  }

  close(): void {
    if (this.isActive) {
      this.isActive = false;
      this.response.end();
    }
  }
}

// Usage example for Heidi responses
export async function streamHeidiResponse(
  handler: StreamingHandler,
  input: string,
  mode: 'mobile' | 'full' | 'command'
): Promise<void> {
  try {
    // Simulate streaming text response
    const words = `Heidi is processing: ${input}`.split(' ');

    for (const word of words) {
      handler.sendText(word + ' ');
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Send actions
    handler.sendAction('Continue conversation');
    handler.sendAction('Switch to Ursula');

    // Send final data
    handler.sendData({
      confidence: 0.85,
      mode,
      timestamp: new Date()
    });

    handler.complete();
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    handler.error(error);
  }
}

// Usage example for Ursula task execution
export async function streamUrsulaTask(
  handler: StreamingHandler,
  taskId: string
): Promise<void> {
  try {
    handler.sendData({ taskId, status: 'started' });

    // Simulate task progress
    for (let progress = 10; progress <= 100; progress += 10) {
      handler.sendData({
        taskId,
        progress,
        status: 'running'
      });
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    handler.sendData({
      taskId,
      status: 'completed',
      result: { output: 'Task completed successfully' }
    });

    handler.complete();
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    handler.error(error);
  }
}
