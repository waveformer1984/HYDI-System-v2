/**
 * API LAYER - /api/chat
 * 
 * Handles user input, retrieves memory, routes to ModelManager, returns streamed response
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { HeidiOrchestrator } from '../../lib/orchestrator';

interface ChatRequest {
  message: string;
  session_id: string;
  user_id: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, session_id, user_id }: ChatRequest = req.body;

    if (!message || !session_id || !user_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: message, session_id, user_id' 
      });
    }

    const orchestrator = new HeidiOrchestrator();
    const startTime = Date.now();

    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Process the chat request
    const response = await orchestrator.processChat({
      message,
      session_id,
      user_id
    });

    // Stream the response
    const streamResponse = () => {
      // Send metadata
      res.write(`data: ${JSON.stringify({
        type: 'metadata',
        model_used: response.model_used,
        latency: response.latency,
        session_state: response.session_state
      })}\n\n`);

      // Send content
      res.write(`data: ${JSON.stringify({
        type: 'content',
        content: response.response
      })}\n\n`);

      // Send actions
      if (response.actions && response.actions.length > 0) {
        res.write(`data: ${JSON.stringify({
          type: 'actions',
          actions: response.actions
        })}\n\n`);
      }

      // End stream
      res.write('data: [DONE]\n\n');
      res.end();
    };

    streamResponse();

  } catch (error) {
    console.error('Chat API error:', error);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } else {
      // If streaming already started, send error as stream event
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      })}\n\n`);
      res.end();
    }
  }
}
