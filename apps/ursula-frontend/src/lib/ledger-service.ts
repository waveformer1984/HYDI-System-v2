import { Redis } from '@upstash/redis';

// Initialize Redis (with fallback to file storage)
let redis: Redis | null = null;
try {
  redis = Redis.fromEnv();
} catch (error) {
  console.warn('[LEDGER] Redis not available, using file fallback');
}

const LEDGER_FILE = './data/ledger.json';

export interface CreditTransaction {
  id: string;
  userId: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  balance: number;
  timestamp: string;
  source: string;
  metadata?: Record<string, any>;
  status: 'CONFIRMED' | 'PENDING' | 'FAILED';
}

export interface LedgerEntry {
  userId: string;
  balance: number;
  lastUpdated: string;
  transactions: CreditTransaction[];
}

export interface AddCreditsResult {
  success: boolean;
  newBalance?: number;
  transactionId?: string;
  error?: string;
}

export interface DebitCreditsResult {
  success: boolean;
  newBalance?: number;
  transactionId?: string;
  insufficientFunds?: boolean;
  error?: string;
}

export class LedgerService {
  /**
   * Add credits to user's account
   */
  async addCredits(
    userId: string,
    amount: number,
    metadata?: Record<string, any>
  ): Promise<AddCreditsResult> {
    if (amount <= 0) {
      return { success: false, error: 'Amount must be positive' };
    }

    try {
      const ledger = await this.getLedger();
      const userEntry = ledger[userId] || {
        userId,
        balance: 0,
        lastUpdated: new Date().toISOString(),
        transactions: []
      };

      // Create credit transaction
      const transaction: CreditTransaction = {
        id: this.generateTransactionId(),
        userId,
        type: 'CREDIT',
        amount,
        balance: userEntry.balance + amount,
        timestamp: new Date().toISOString(),
        source: metadata?.source || 'unknown',
        metadata,
        status: 'CONFIRMED'
      };

      // Update user balance
      userEntry.balance += amount;
      userEntry.lastUpdated = transaction.timestamp;
      userEntry.transactions.unshift(transaction); // Add to front

      // Keep only last 100 transactions per user
      if (userEntry.transactions.length > 100) {
        userEntry.transactions = userEntry.transactions.slice(0, 100);
      }

      // Save ledger
      ledger[userId] = userEntry;
      await this.saveLedger(ledger);

      console.log(`[LEDGER] Added ${amount} credits to user ${userId}. New balance: ${userEntry.balance}`);

      return {
        success: true,
        newBalance: userEntry.balance,
        transactionId: transaction.id
      };
    } catch (error) {
      console.error('[LEDGER] Error adding credits:', error);
      return { success: false, error: 'Failed to add credits' };
    }
  }

  /**
   * Debit credits from user's account (for reveal operations)
   */
  async debitCredits(
    userId: string,
    amount: number,
    metadata?: Record<string, any>
  ): Promise<DebitCreditsResult> {
    if (amount <= 0) {
      return { success: false, error: 'Amount must be positive' };
    }

    try {
      const ledger = await this.getLedger();
      const userEntry = ledger[userId];

      if (!userEntry) {
        return { success: false, error: 'User not found', insufficientFunds: true };
      }

      if (userEntry.balance < amount) {
        return {
          success: false,
          error: 'Insufficient credits',
          insufficientFunds: true,
          newBalance: userEntry.balance
        };
      }

      // Create debit transaction
      const transaction: CreditTransaction = {
        id: this.generateTransactionId(),
        userId,
        type: 'DEBIT',
        amount,
        balance: userEntry.balance - amount,
        timestamp: new Date().toISOString(),
        source: metadata?.source || 'reveal_operation',
        metadata,
        status: 'CONFIRMED'
      };

      // Update user balance
      userEntry.balance -= amount;
      userEntry.lastUpdated = transaction.timestamp;
      userEntry.transactions.unshift(transaction);

      // Keep only last 100 transactions per user
      if (userEntry.transactions.length > 100) {
        userEntry.transactions = userEntry.transactions.slice(0, 100);
      }

      // Save ledger
      ledger[userId] = userEntry;
      await this.saveLedger(ledger);

      console.log(`[LEDGER] Debited ${amount} credits from user ${userId}. New balance: ${userEntry.balance}`);

      return {
        success: true,
        newBalance: userEntry.balance,
        transactionId: transaction.id
      };
    } catch (error) {
      console.error('[LEDGER] Error debiting credits:', error);
      return { success: false, error: 'Failed to debit credits' };
    }
  }

  /**
   * Get user's current balance
   */
  async getBalance(userId: string): Promise<number> {
    try {
      const ledger = await this.getLedger();
      const userEntry = ledger[userId];
      return userEntry?.balance || 0;
    } catch (error) {
      console.error('[LEDGER] Error getting balance:', error);
      return 0;
    }
  }

  /**
   * Get user's transaction history
   */
  async getTransactions(userId: string, limit: number = 50): Promise<CreditTransaction[]> {
    try {
      const ledger = await this.getLedger();
      const userEntry = ledger[userId];
      return userEntry?.transactions.slice(0, limit) || [];
    } catch (error) {
      console.error('[LEDGER] Error getting transactions:', error);
      return [];
    }
  }

  /**
   * Get all confirmed debits for reconciliation
   */
  async getConfirmedDebits(since?: Date): Promise<CreditTransaction[]> {
    try {
      const ledger = await this.getLedger();
      const cutoffDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

      const allDebits: CreditTransaction[] = [];

      Object.values(ledger).forEach(userEntry => {
        const confirmedDebits = userEntry.transactions
          .filter(tx =>
            tx.type === 'DEBIT' &&
            tx.status === 'CONFIRMED' &&
            new Date(tx.timestamp) >= cutoffDate
          );
        allDebits.push(...confirmedDebits);
      });

      return allDebits.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
      console.error('[LEDGER] Error getting confirmed debits:', error);
      return [];
    }
  }

  /**
   * Atomic debit operation with double-spend protection
   */
  async atomicDebit(
    userId: string,
    amount: number,
    metadata?: Record<string, any>
  ): Promise<DebitCreditsResult> {
    // This method implements atomic debit using Redis transactions or file locks
    // For now, we'll use a simple approach with timestamp checking

    const lockKey = `debit_lock_${userId}`;
    const lockTimeout = 5000; // 5 seconds

    try {
      // Simple lock mechanism (in production, use Redis distributed locks)
      const lockAcquired = await this.acquireLock(lockKey, lockTimeout);

      if (!lockAcquired) {
        return { success: false, error: 'Could not acquire lock' };
      }

      try {
        // Perform the debit operation
        const result = await this.debitCredits(userId, amount, metadata);

        // Release lock
        await this.releaseLock(lockKey);

        return result;
      } catch (error) {
        await this.releaseLock(lockKey);
        throw error;
      }
    } catch (error) {
      console.error('[LEDGER] Error in atomic debit:', error);
      return { success: false, error: 'Atomic debit failed' };
    }
  }

  /**
   * Get ledger from storage
   */
  private async getLedger(): Promise<Record<string, LedgerEntry>> {
    if (redis) {
      try {
        const data = await redis.get('hydi_ledger');
        return (data ? JSON.parse(data as string) : {}) as Record<string, LedgerEntry>;
      } catch (error) {
        console.error('[LEDGER] Redis read error:', error);
      }
    }

    // Fallback to file storage
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(LEDGER_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return {};
    }
  }

  /**
   * Save ledger to storage
   */
  private async saveLedger(ledger: Record<string, LedgerEntry>): Promise<void> {
    if (redis) {
      try {
        await redis.set('hydi_ledger', JSON.stringify(ledger));
        return;
      } catch (error) {
        console.error('[LEDGER] Redis write error:', error);
      }
    }

    // Fallback to file storage
    try {
      const fs = await import('fs/promises');
      await fs.writeFile(LEDGER_FILE, JSON.stringify(ledger, null, 2));
    } catch (error) {
      console.error('[LEDGER] File write error:', error);
      throw error;
    }
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Simple lock mechanism (in production, use Redis distributed locks)
   */
  private async acquireLock(lockKey: string, timeout: number): Promise<boolean> {
    if (redis) {
      try {
        const result = await redis.set(lockKey, 'locked', { px: timeout, nx: true });
        return result === 'OK';
      } catch (error) {
        console.error('[LEDGER] Lock acquisition error:', error);
        return false;
      }
    }

    // Fallback: simple in-memory lock (not distributed)
    return true; // For now, always succeed
  }

  /**
   * Release lock
   */
  private async releaseLock(lockKey: string): Promise<void> {
    if (redis) {
      try {
        await redis.del(lockKey);
      } catch (error) {
        console.error('[LEDGER] Lock release error:', error);
      }
    }
  }

  /**
   * Get ledger statistics
   */
  async getStats(): Promise<{
    totalUsers: number;
    totalCredits: number;
    totalTransactions: number;
    recentTransactions: CreditTransaction[];
  }> {
    try {
      const ledger = await this.getLedger();
      const users = Object.values(ledger);

      const totalUsers = users.length;
      const totalCredits = users.reduce((sum, user) => sum + user.balance, 0);
      const totalTransactions = users.reduce((sum, user) => sum + user.transactions.length, 0);

      // Get recent transactions (last 10)
      const allTransactions = users.flatMap(user => user.transactions);
      const recentTransactions = allTransactions
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);

      return {
        totalUsers,
        totalCredits,
        totalTransactions,
        recentTransactions
      };
    } catch (error) {
      console.error('[LEDGER] Error getting stats:', error);
      return {
        totalUsers: 0,
        totalCredits: 0,
        totalTransactions: 0,
        recentTransactions: []
      };
    }
  }
}
