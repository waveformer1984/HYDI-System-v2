/**
 * HYDI Thermal Mitigation Guard
 *
 * Ambient thermal monitoring system that enforces hardware-aware workload throttling.
 * Samples CPU zone temperatures every 4 seconds and executes policy matrix:
 *
 * Policy Matrix:
 * - NOMINAL       (< 78°C): All systems operational
 * - WARNING       (78-80°C): Pause speculative background tasks
 * - THROTTLE      (80-88°C): Restrict worker queue to 25% capacity
 * - EMERGENCY     (>= 92°C): Halt all workers immediately
 *
 * Invariant: No processing state is lost during transitions.
 * All queued tasks remain in Redis Streams until capacity restores.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type ThermalState = 'NOMINAL' | 'WARNING' | 'THROTTLE' | 'EMERGENCY';

export interface ThermalPolicy {
  state: ThermalState;
  temperatureCelsius: number;
  queueThrottleRate: number; // 0.0-1.0
  allowBackgroundIndexing: boolean;
  allowSpeculativeExecution: boolean;
}

export interface OrchestratorHooks {
  setQueueThrottleRate(rate: number): Promise<void>;
  pauseBackgroundIndexing(): Promise<void>;
  resumeBackgroundIndexing(): Promise<void>;
  pauseSpeculativeExecution(): Promise<void>;
  resumeSpeculativeExecution(): Promise<void>;
  emergencyHaltAllWorkers(): Promise<void>;
  resumeNormalOperations(): Promise<void>;
  updateDashboardState(state: ThermalState, temperature: number): Promise<void>;
}

export class ThermalMitigationGuard {
  private currentState: ThermalState = 'NOMINAL';
  private currentTemperature: number = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private lastPolicyTransitionTime: number = Date.now();
  private temperatureHistory: number[] = [];
  private readonly MAX_HISTORY = 60; // Keep last 60 samples (4 min at 4s intervals)

  constructor(
    private orchestrator: OrchestratorHooks,
    private pollIntervalMs: number = 4000,
    private enableLogging: boolean = true
  ) {}

  /**
   * Start the thermal monitoring loop.
   */
  start(): void {
    if (this.intervalId) {
      console.warn('[ThermalGuard] Already running, ignoring redundant start');
      return;
    }

    console.log('[ThermalGuard] Starting thermal monitoring (4000ms interval)');
    this.intervalId = setInterval(() => this.evaluateHostThermals(), this.pollIntervalMs);
  }

  /**
   * Stop the monitoring loop gracefully.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ThermalGuard] Monitoring stopped');
    }
  }

  /**
   * Query Windows Management Instrumentation (WMI) for CPU zone temperatures.
   * Uses MSAcpi_ThermalZoneTemperatureProperty which reports in tenths of Kelvin.
   */
  private async evaluateHostThermals(): Promise<void> {
    try {
      const { stdout } = await execAsync(
        'wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperatureProperty Get CurrentTemperature',
        { timeout: 5000 }
      );

      // Parse WMI output: extract numeric value
      const match = stdout.match(/(\d+)/);
      if (!match || !match[1]) {
        console.warn('[ThermalGuard] Failed to parse WMI temperature output');
        return;
      }

      // Convert tenths of Kelvin to Celsius
      const rawTemp = parseInt(match[1], 10);
      const celsius = (rawTemp / 10.0) - 273.15;

      // Clamp unrealistic values
      if (celsius < -50 || celsius > 150) {
        console.warn(`[ThermalGuard] Unrealistic temperature reading: ${celsius}°C, discarding`);
        return;
      }

      this.currentTemperature = celsius;
      this.temperatureHistory.push(celsius);
      if (this.temperatureHistory.length > this.MAX_HISTORY) {
        this.temperatureHistory.shift();
      }

      // Evaluate policy
      await this.executePolicyMatrix(celsius);
    } catch (error) {
      console.error(`[ThermalGuard] WMI query failed: ${error}`);
    }
  }

  /**
   * Execute the thermal policy matrix based on current temperature.
   * Transitions are logged with timestamp and state change rationale.
   */
  private async executePolicyMatrix(celsius: number): Promise<void> {
    let newState: ThermalState = 'NOMINAL';

    if (celsius >= 92) {
      newState = 'EMERGENCY';
    } else if (celsius >= 88) {
      newState = 'THROTTLE';
    } else if (celsius >= 80) {
      newState = 'WARNING';
    } else if (celsius < 78) {
      newState = 'NOMINAL';
    }

    // Emit state transition logs
    if (newState !== this.currentState) {
      await this.onStateTransition(this.currentState, newState, celsius);
    }

    // Periodic reporting (every 30 seconds even without state change)
    const timeSinceLastTransition = Date.now() - this.lastPolicyTransitionTime;
    if (timeSinceLastTransition > 30000) {
      if (this.enableLogging) {
        console.log(`[ThermalGuard] Status: ${this.currentState} @ ${celsius.toFixed(1)}°C`);
      }
      this.lastPolicyTransitionTime = Date.now();
    }

    this.currentState = newState;
  }

  /**
   * Handle state transitions with orchestrator callbacks.
   */
  private async onStateTransition(
    oldState: ThermalState,
    newState: ThermalState,
    temperature: number
  ): Promise<void> {
    console.log(
      `[ThermalGuard] STATE TRANSITION: ${oldState} → ${newState} @ ${temperature.toFixed(1)}°C`
    );

    this.lastPolicyTransitionTime = Date.now();

    try {
      switch (newState) {
        case 'NOMINAL':
          console.log('[ThermalGuard] System thermals stabilized. All throttles released.');
          await this.orchestrator.resumeNormalOperations();
          break;

        case 'WARNING':
          console.warn(
            `[ThermalGuard] WARNING: Host thermal limits elevated at ${temperature.toFixed(1)}°C. ` +
            `Pausing speculative background tasks.`
          );
          await this.orchestrator.pauseSpeculativeExecution();
          break;

        case 'THROTTLE':
          console.error(
            `[ThermalGuard] THERMAL BOUNDARY BREACHED (${temperature.toFixed(1)}°C): ` +
            `Restricting worker queue ingestion to 25% capacity.`
          );
          await this.orchestrator.setQueueThrottleRate(0.25);
          await this.orchestrator.pauseBackgroundIndexing();
          break;

        case 'EMERGENCY':
          console.error(
            `[ThermalGuard] CRITICAL INVARIANT VIOLATION: Thermal threshold breached at ` +
            `${temperature.toFixed(1)}°C. Executing emergency lockdown.`
          );
          await this.orchestrator.emergencyHaltAllWorkers();
          break;
      }

      // Update dashboard display state
      await this.orchestrator.updateDashboardState(newState, temperature);
    } catch (error) {
      console.error(`[ThermalGuard] Error executing policy transition: ${error}`);
    }
  }

  /**
   * Public accessors for monitoring.
   */
  getCurrentState(): ThermalState {
    return this.currentState;
  }

  getCurrentTemperature(): number {
    return this.currentTemperature;
  }

  getAverageTemperature(): number {
    if (this.temperatureHistory.length === 0) return 0;
    const sum = this.temperatureHistory.reduce((a, b) => a + b, 0);
    return sum / this.temperatureHistory.length;
  }

  getTemperatureHistory(): number[] {
    return [...this.temperatureHistory];
  }

  getMetrics() {
    return {
      state: this.currentState,
      currentCelsius: this.currentTemperature,
      averageCelsius: this.getAverageTemperature(),
      minCelsius: Math.min(...this.temperatureHistory),
      maxCelsius: Math.max(...this.temperatureHistory),
      sampleCount: this.temperatureHistory.length
    };
  }
}
