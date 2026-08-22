/**
 * HYDI Communication Action Adapter
 *
 * Implements communication operations: prepare/send email, prepare/send message.
 * Wraps the existing CommunicationLayer and email infrastructure.
 *
 * Safety:
 *   - Sending email/messages is HIGH RISK (external communication)
 *   - Recipient and content are verified before sending
 *   - All sends are recorded in the audit trail
 *   - No secret material in messages
 */

import type {
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionObservation,
  ActionVerificationResult,
  HumanAction,
  RollbackResult,
} from '../HumanActionTypes';

export interface CommunicationAdapterDeps {
  sendEmail?: (input: {
    to: string;
    subject: string;
    body: string;
    from?: string;
  }) => Promise<{ messageId: string; deliveryStatus: string; error: string | null }>;
  sendMessage?: (input: {
    channel: string;
    message: string;
  }) => Promise<{ messageId: string; deliveryStatus: string; error: string | null }>;
  getCapabilities?: () => Promise<unknown[]>;
}

export class CommunicationAdapter implements ActionAdapter {
  adapterId = 'communication';
  category = 'COMMUNICATION' as const;
  capabilities = [
    'comm.prepare_email',
    'comm.send_email',
    'comm.prepare_message',
    'comm.send_message',
  ];

  constructor(private deps: CommunicationAdapterDeps) {}

  async execute(
    action: HumanAction,
    _context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now();

    try {
      let output: unknown;
      const evidence: ActionExecutionResult['evidence'] = [];

      switch (action.capability) {
        case 'comm.prepare_email': {
          const to = action.parameters.recipient as string;
          const subject = action.parameters.subject as string;
          const body = action.parameters.messageBody as string;
          if (!to || !subject || !body) {
            throw new Error('recipient, subject, and messageBody are required');
          }
          // Prepare draft — does NOT send
          output = {
            draft: true,
            to, subject,
            bodyLength: body.length,
            prepared: true,
          };
          evidence.push({
            check: 'email_prepared',
            status: 'pass',
            value: `Draft prepared for ${to}: ${subject}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'comm.send_email': {
          if (!this.deps.sendEmail) {
            return {
              executed: false, output: null,
              error: 'Email sending is not configured',
              evidence: [{
                check: 'email_available',
                status: 'fail',
                value: 'No email service configured',
                checkedAt: new Date().toISOString(),
              }],
              durationMs: Date.now() - startTime,
            };
          }
          const to = action.parameters.recipient as string;
          const subject = action.parameters.subject as string;
          const body = action.parameters.messageBody as string;
          const from = action.parameters.from as string | undefined;
          if (!to || !subject || !body) {
            throw new Error('recipient, subject, and messageBody are required');
          }
          const result = await this.deps.sendEmail({ to, subject, body, from });
          output = {
            sent: result.deliveryStatus === 'sent',
            messageId: result.messageId,
            deliveryStatus: result.deliveryStatus,
          };
          evidence.push({
            check: 'email_sent',
            status: result.deliveryStatus === 'sent' ? 'pass' : 'fail',
            value: `Email to ${to}: ${result.deliveryStatus}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'comm.prepare_message': {
          const channel = action.parameters.channel as string;
          const message = action.parameters.messageBody as string;
          if (!channel || !message) {
            throw new Error('channel and messageBody are required');
          }
          output = {
            draft: true,
            channel,
            messageLength: message.length,
            prepared: true,
          };
          evidence.push({
            check: 'message_prepared',
            status: 'pass',
            value: `Draft prepared for ${channel}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'comm.send_message': {
          if (!this.deps.sendMessage) {
            return {
              executed: false, output: null,
              error: 'Message sending is not configured',
              evidence: [{
                check: 'message_available',
                status: 'fail',
                value: 'No message service configured',
                checkedAt: new Date().toISOString(),
              }],
              durationMs: Date.now() - startTime,
            };
          }
          const channel = action.parameters.channel as string;
          const message = action.parameters.messageBody as string;
          if (!channel || !message) {
            throw new Error('channel and messageBody are required');
          }
          const result = await this.deps.sendMessage({ channel, message });
          output = {
            sent: result.deliveryStatus === 'sent',
            messageId: result.messageId,
            deliveryStatus: result.deliveryStatus,
          };
          evidence.push({
            check: 'message_sent',
            status: result.deliveryStatus === 'sent' ? 'pass' : 'fail',
            value: `Message to ${channel}: ${result.deliveryStatus}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        default:
          return {
            executed: false, output: null,
            error: `Unsupported capability: ${action.capability}`,
            evidence: [], durationMs: Date.now() - startTime,
          };
      }

      return {
        executed: true, output, error: null, evidence,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        executed: false, output: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        evidence: [{
          check: 'execution_error',
          status: 'fail',
          value: error instanceof Error ? error.message : 'Unknown error',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: Date.now() - startTime,
      };
    }
  }

  async verify(
    action: HumanAction,
    executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<ActionVerificationResult> {
    const evidence: ActionVerificationResult['evidence'] = [];
    if (!executionResult.executed) {
      return { verified: false, evidence, reason: 'Action was not executed' };
    }

    if (action.capability === 'comm.send_email' || action.capability === 'comm.send_message') {
      const output = executionResult.output as { sent: boolean; deliveryStatus: string };
      evidence.push({
        check: 'delivery_confirmed',
        status: output.sent ? 'pass' : 'fail',
        value: `Delivery: ${output.deliveryStatus}`,
        checkedAt: new Date().toISOString(),
      });
      return {
        verified: output.sent,
        evidence,
        reason: output.sent ? 'Delivery confirmed' : 'Delivery failed',
      };
    }

    // Prepare operations just need to produce a draft
    const hasPass = executionResult.evidence.some((e) => e.status === 'pass');
    return {
      verified: hasPass,
      evidence,
      reason: hasPass ? 'Draft prepared' : 'Preparation failed',
    };
  }

  async rollback(
    action: HumanAction,
    _executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<RollbackResult> {
    // Sent communications cannot be unsent
    if (action.capability === 'comm.send_email' || action.capability === 'comm.send_message') {
      return { attempted: false, succeeded: false, evidence: 'Cannot unsend a message', error: 'Irreversible' };
    }
    return { attempted: true, succeeded: true, evidence: 'Draft needs no rollback' };
  }

  isAvailable(): { available: boolean; reason: string | null } {
    if (!this.deps.sendEmail && !this.deps.sendMessage) {
      return { available: false, reason: 'No communication services configured' };
    }
    return { available: true, reason: null };
  }

  async observe(target: string, _context: ActionExecutionContext): Promise<ActionObservation> {
    return {
      target,
      exists: !!this.deps.sendEmail || !!this.deps.sendMessage,
      state: this.isAvailable().available ? 'available' : 'not_configured',
      properties: {},
      observedAt: new Date().toISOString(),
    };
  }
}
