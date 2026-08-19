/**
 * HEIDI Trust Model
 *
 * Explicit trust boundaries for all inputs. Every input is classified
 * into one of 8 trust levels. Content can NEVER create authority —
 * a user message, webpage, email, file, or API response cannot change
 * system policy, permissions, credentials, trust relationships, or
 * autonomy limits.
 *
 * Prompt injection is treated as untrusted input.
 */

import { Pool, QueryResultRow } from 'pg';

export type TrustLevel =
  | 'trusted_human'    // The human owner — full authority
  | 'trusted_system'   // HEIDI's own internal components
  | 'authorized_service' // A service with valid service token
  | 'known_customer'   // An authenticated customer
  | 'unknown_user'     // An unauthenticated user
  | 'external_content' // Content from external sources (web, API responses)
  | 'untrusted_input'  // Input that hasn't been validated
  | 'malicious_input'; // Input detected as malicious

export type InputType =
  | 'human_message' | 'system_event' | 'service_call' | 'customer_message'
  | 'unknown_user' | 'external_content' | 'api_response' | 'file' | 'url' | 'webhook';

export interface TrustClassification {
  trustLevel: TrustLevel;
  inputType: InputType;
  actorId: string | null;
  reason: string;
  canInfluencePolicy: boolean;
  canInfluencePermissions: boolean;
  canInfluenceCredentials: boolean;
  canInfluenceAutonomy: boolean;
  canExecuteActions: boolean;
  canAccessData: boolean;
}

interface DBConfig {
  host?: string; port?: number; database?: string; user?: string; password?: string;
}

// Prompt injection indicators
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) (instructions|prompts|rules)/i,
  /you are now (a|an) /i,
  /disregard (all )?(previous|prior|above)/i,
  /forget (all )?(previous|prior|above)/i,
  /system prompt/i,
  /reveal (your|the) (system|hidden) (prompt|instructions)/i,
  /override (your|the) (rules|policy|policies|constraints)/i,
  /act as (if you are|a) /i,
  /pretend (you are|to be) /i,
  /new instructions:/i,
  /<\|system\|>/i,
  /<\|im_start\|>/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
];

const AUTHORITY_PATTERNS = [
  /grant (me|you) (admin|root|owner|full) (access|permissions|authority)/i,
  /change (my|your) (role|permissions|policy) to/i,
  /increase (your|my) autonomy/i,
  /disable (security|auth|policy|guardrails)/i,
  /reveal (secrets|credentials|api keys|passwords)/i,
  /execute (shell|bash|cmd|command) /i,
  /drop (table|database|schema)/i,
  /delete (all|every) (records|rows|data|files)/i,
];

export class TrustModel {
  private pool: Pool;
  private knownServiceTokens: Set<string> = new Set();
  private knownCustomerIds: Set<string> = new Set();

  constructor(config?: DBConfig) {
    this.pool = new Pool({
      host: config?.host || process.env.PG_HOST || '127.0.0.1',
      port: config?.port || parseInt(process.env.PG_PORT || '54322', 10),
      database: config?.database || process.env.PG_DATABASE || 'postgres',
      user: config?.user || process.env.PG_USER || 'postgres',
      password: config?.password || process.env.PG_PASSWORD || 'postgres',
      max: 5, idleTimeoutMillis: 30000,
    });
  }

  classify(input: {
    source: string;
    inputType: InputType;
    actorId?: string;
    content?: string;
    hasServiceToken?: boolean;
    hasDeviceToken?: boolean;
    isAuthenticated?: boolean;
  }): TrustClassification {
    const content = input.content || '';
    const actorId = input.actorId || null;

    // Check for malicious patterns first
    const injectionDetected = INJECTION_PATTERNS.some((p) => p.test(content));
    const authorityGrab = AUTHORITY_PATTERNS.some((p) => p.test(content));

    if (injectionDetected || authorityGrab) {
      const classification: TrustClassification = {
        trustLevel: 'malicious_input',
        inputType: input.inputType,
        actorId,
        reason: injectionDetected
          ? 'Prompt injection pattern detected — input classified as malicious'
          : 'Authority escalation attempt detected — input classified as malicious',
        canInfluencePolicy: false,
        canInfluencePermissions: false,
        canInfluenceCredentials: false,
        canInfluenceAutonomy: false,
        canExecuteActions: false,
        canAccessData: false,
      };
      this.recordClassification(input.source, input.inputType, classification).catch(() => {});
      return classification;
    }

    // Classify based on source and authentication
    let trustLevel: TrustLevel;
    let reason: string;

    switch (input.source) {
      case 'human_owner':
        trustLevel = 'trusted_human';
        reason = 'Input from human owner — full trust';
        break;
      case 'heidi_internal':
      case 'heidi_core':
      case 'cognitive_core':
        trustLevel = 'trusted_system';
        reason = 'Input from HEIDI internal component — system trust';
        break;
      case 'authorized_service':
        if (input.hasServiceToken) {
          trustLevel = 'authorized_service';
          reason = 'Input from service with valid service token';
        } else {
          trustLevel = 'untrusted_input';
          reason = 'Service call without valid service token — untrusted';
        }
        break;
      case 'customer':
        if (input.isAuthenticated || input.hasDeviceToken) {
          trustLevel = 'known_customer';
          reason = 'Input from authenticated customer';
        } else {
          trustLevel = 'unknown_user';
          reason = 'Input from unauthenticated user claiming customer identity';
        }
        break;
      case 'web':
      case 'api_response':
      case 'external_api':
        trustLevel = 'external_content';
        reason = 'Content from external source — no authority';
        break;
      case 'webhook':
        trustLevel = input.isAuthenticated ? 'authorized_service' : 'untrusted_input';
        reason = input.isAuthenticated
          ? 'Webhook with valid signature — authorized service'
          : 'Webhook without valid signature — untrusted';
        break;
      default:
        trustLevel = 'untrusted_input';
        reason = `Unknown source '${input.source}' — untrusted by default`;
    }

    // Determine capabilities based on trust level
    const canInfluencePolicy = trustLevel === 'trusted_human';
    const canInfluencePermissions = trustLevel === 'trusted_human';
    const canInfluenceCredentials = false; // Never via content
    const canInfluenceAutonomy = trustLevel === 'trusted_human';
    const canExecuteActions = trustLevel === 'trusted_human' || trustLevel === 'trusted_system' || trustLevel === 'authorized_service';
    const canAccessData = trustLevel === 'trusted_human' || trustLevel === 'trusted_system' || trustLevel === 'authorized_service' || trustLevel === 'known_customer';

    const classification: TrustClassification = {
      trustLevel,
      inputType: input.inputType,
      actorId,
      reason,
      canInfluencePolicy,
      canInfluencePermissions,
      canInfluenceCredentials,
      canInfluenceAutonomy,
      canExecuteActions,
      canAccessData,
    };

    this.recordClassification(input.source, input.inputType, classification).catch(() => {});
    return classification;
  }

  canExecute(trustLevel: TrustLevel, actionRisk: string): boolean {
    if (trustLevel === 'malicious_input') return false;
    if (trustLevel === 'untrusted_input') return false;
    if (trustLevel === 'unknown_user') return false;
    if (trustLevel === 'external_content') return false;

    // R3+ requires trusted_human or trusted_system
    if (actionRisk === 'R3' || actionRisk === 'R4' || actionRisk === 'R5') {
      return trustLevel === 'trusted_human' || trustLevel === 'trusted_system';
    }

    // R0-R2 can be executed by authorized services and known customers (within policy)
    return true;
  }

  sanitizeContent(content: string): { sanitized: string; modifications: string[] } {
    const modifications: string[] = [];
    let sanitized = content;

    // Remove potential injection markers
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, '[FILTERED: injection pattern]');
        modifications.push('Removed injection pattern');
      }
    }

    // Remove authority escalation attempts
    for (const pattern of AUTHORITY_PATTERNS) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, '[FILTERED: authority escalation]');
        modifications.push('Removed authority escalation attempt');
      }
    }

    return { sanitized, modifications };
  }

  private async recordClassification(source: string, inputType: InputType, classification: TrustClassification): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO heidi_trust_classifications
           (input_source, input_type, trust_level, actor_id, classification_reason, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          source,
          inputType,
          classification.trustLevel,
          classification.actorId,
          classification.reason,
          JSON.stringify({
            canInfluencePolicy: classification.canInfluencePolicy,
            canExecuteActions: classification.canExecuteActions,
            canAccessData: classification.canAccessData,
          }),
        ],
      );
    } catch {
      // Don't fail classification if audit recording fails
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Singleton
let _instance: TrustModel | null = null;

export function getTrustModel(config?: DBConfig): TrustModel {
  if (!_instance) {
    _instance = new TrustModel(config);
  }
  return _instance;
}
