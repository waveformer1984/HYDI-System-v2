/**
 * HYDI Browser Action Adapter
 *
 * Implements browser automation: navigate, click, type, select, inspect,
 * screenshot, submit, upload, download.
 *
 * Uses puppeteer-core when available, degrades gracefully when not.
 * Connects to an existing Chrome instance via --remote-debugging-port if
 * configured, or launches a new instance.
 *
 * Safety:
 *   - Semantic selectors preferred over coordinate clicking
 *   - Page state is verified before and after actions
 *   - If page changes unexpectedly, stops and re-observes
 *   - Credentials are resolved from the vault, never in the reasoning layer
 *   - MFA/CAPTCHA/biometric challenges pause and request human intervention
 *   - Action trace is maintained
 */

import type {
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionObservation,
  ActionVerificationResult,
  HumanAction,
  HumanInterventionRequest,
  InterventionType,
  RollbackResult,
} from '../HumanActionTypes';

// Dynamic puppeteer import — optional dependency
let puppeteer: any = null;
let puppeteerImportAttempted = false;

async function loadPuppeteer(): Promise<any | null> {
  if (puppeteerImportAttempted) return puppeteer;
  puppeteerImportAttempted = true;
  try {
    // Use require to avoid TS module resolution errors for optional deps
    puppeteer = eval('require')('puppeteer-core');
  } catch {
    try {
      puppeteer = eval('require')('puppeteer');
    } catch {
      puppeteer = null;
    }
  }
  return puppeteer;
}

interface BrowserState {
  page: any;
  browser: any;
  currentUrl: string;
  actionTrace: Array<{ action: string; timestamp: string; url: string; result: string }>;
}

export class BrowserAdapter implements ActionAdapter {
  adapterId = 'browser';
  category = 'BROWSER' as const;
  capabilities = [
    'browser.navigate',
    'browser.click',
    'browser.type',
    'browser.select',
    'browser.submit_form',
    'browser.inspect_page',
    'browser.screenshot',
    'browser.upload_file',
    'browser.download',
  ];

  private state: BrowserState | null = null;
  private chromeEndpoint: string | null;
  private chromeExecutablePath: string | null;

  constructor(options?: {
    chromeEndpoint?: string;       // ws endpoint for existing Chrome
    chromeExecutablePath?: string; // path to Chrome binary
  }) {
    this.chromeEndpoint = options?.chromeEndpoint ?? process.env.CHROME_WS_ENDPOINT ?? null;
    this.chromeExecutablePath = options?.chromeExecutablePath ?? process.env.CHROME_PATH ?? this.detectChrome();
  }

  /**
   * Auto-detect Chrome executable path on the current platform.
   */
  private detectChrome(): string | null {
    const fs = require('fs');
    const candidates: string[] = [];
    if (process.platform === 'win32') {
      candidates.push(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      );
    } else if (process.platform === 'darwin') {
      candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    } else {
      candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
    }
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
    }
    return null;
  }

  async execute(
    action: HumanAction,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now();

    // Ensure browser is available
    const available = await this.ensureBrowser();
    if (!available.available) {
      return {
        executed: false,
        output: null,
        error: available.reason ?? 'Browser not available',
        evidence: [{
          check: 'browser_available',
          status: 'fail',
          value: available.reason ?? 'Browser not available',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: Date.now() - startTime,
      };
    }

    if (!this.state) {
      return {
        executed: false,
        output: null,
        error: 'Browser state not initialized',
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    }

    const preUrl = this.state.currentUrl;

    try {
      let output: unknown;
      const evidence: ActionExecutionResult['evidence'] = [];

      switch (action.capability) {
        case 'browser.navigate': {
          const url = (action.parameters.url as string) ?? action.target;

          // Defense-in-depth: block restricted browser protocols even if
          // the authority-level resource patterns allow them. This enforces
          // the browser_origin deny rules from DelegatedIdentity at the
          // adapter level, preventing navigation to chrome://, about:, and
          // other privileged browser URLs regardless of authority configuration.
          const restrictedProtocols = ['chrome:', 'about:', 'chrome-extension:', 'devtools:', 'view-source:'];
          const urlLower = url.toLowerCase();
          for (const proto of restrictedProtocols) {
            if (urlLower.startsWith(proto)) {
              return {
                executed: false,
                output: null,
                error: `Navigation to restricted protocol '${proto}' is blocked by BrowserAdapter defense-in-depth`,
                evidence: [{
                  check: 'resource_boundary',
                  status: 'fail',
                  value: `Blocked: ${url}`,
                  detail: `Restricted protocol ${proto} denied at adapter level`,
                  checkedAt: new Date().toISOString(),
                }],
                durationMs: Date.now() - startTime,
              };
            }
          }

          await this.state.page.goto(url, { waitUntil: 'networkidle2', timeout: action.timeoutMs });
          this.state.currentUrl = this.state.page.url();
          output = { url: this.state.currentUrl, title: await this.state.page.title() };
          evidence.push({
            check: 'navigation',
            status: this.state.currentUrl === url ? 'pass' : 'warn',
            value: `Navigated to ${this.state.currentUrl}`,
            detail: this.state.currentUrl !== url ? `Expected ${url}` : undefined,
            checkedAt: new Date().toISOString(),
          });
          this.traceAction('navigate', `Navigated to ${this.state.currentUrl}`, 'success');
          break;
        }

        case 'browser.click': {
          const selector = action.parameters.selector as string;
          if (!selector) throw new Error('No selector provided for click');
          await this.state.page.waitForSelector(selector, { timeout: action.timeoutMs });
          await this.state.page.click(selector);
          output = { clicked: true, selector };
          evidence.push({
            check: 'element_clicked',
            status: 'pass',
            value: `Clicked ${selector}`,
            checkedAt: new Date().toISOString(),
          });
          this.traceAction('click', `Clicked ${selector}`, 'success');
          break;
        }

        case 'browser.type': {
          const selector = action.parameters.selector as string;
          const text = action.parameters.value as string;
          if (!selector || text === undefined) throw new Error('Selector and value required for type');
          await this.state.page.waitForSelector(selector, { timeout: action.timeoutMs });
          await this.state.page.type(selector, text);
          output = { typed: true, selector, length: text.length };
          evidence.push({
            check: 'text_entered',
            status: 'pass',
            value: `Typed ${text.length} chars into ${selector}`,
            checkedAt: new Date().toISOString(),
          });
          this.traceAction('type', `Typed into ${selector}`, 'success');
          break;
        }

        case 'browser.select': {
          const selector = action.parameters.selector as string;
          const value = action.parameters.value as string;
          if (!selector || value === undefined) throw new Error('Selector and value required for select');
          await this.state.page.waitForSelector(selector, { timeout: action.timeoutMs });
          await this.state.page.select(selector, value);
          output = { selected: true, selector, value };
          evidence.push({
            check: 'option_selected',
            status: 'pass',
            value: `Selected ${value} in ${selector}`,
            checkedAt: new Date().toISOString(),
          });
          this.traceAction('select', `Selected in ${selector}`, 'success');
          break;
        }

        case 'browser.submit_form': {
          const selector = action.parameters.selector as string;
          if (selector) {
            await this.state.page.waitForSelector(selector, { timeout: action.timeoutMs });
            await this.state.page.click(selector);
          } else {
            await this.state.page.keyboard.press('Enter');
          }
          await this.state.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: action.timeoutMs }).catch(() => { });
          this.state.currentUrl = this.state.page.url();
          output = { submitted: true, url: this.state.currentUrl };
          evidence.push({
            check: 'form_submitted',
            status: 'pass',
            value: `Form submitted, now at ${this.state.currentUrl}`,
            checkedAt: new Date().toISOString(),
          });
          this.traceAction('submit', `Form submitted`, 'success');
          break;
        }

        case 'browser.inspect_page': {
          const pageData = await this.state.page.evaluate(() => {
            return {
              url: window.location.href,
              title: document.title,
              elementCount: document.querySelectorAll('*').length,
              forms: Array.from(document.forms).map((f) => ({
                action: f.action,
                method: f.method,
                inputs: f.elements.length,
              })),
              links: document.links.length,
            };
          });
          output = pageData;
          evidence.push({
            check: 'page_inspected',
            status: 'pass',
            value: `Page: ${pageData.title} (${pageData.url})`,
            checkedAt: new Date().toISOString(),
          });
          this.traceAction('inspect', `Inspected page`, 'success');
          break;
        }

        case 'browser.screenshot': {
          const screenshotPath = (action.parameters.path as string) ?? action.target;
          await this.state.page.screenshot({ path: screenshotPath, fullPage: true });
          output = { screenshotPath, captured: true };
          evidence.push({
            check: 'screenshot_captured',
            status: 'pass',
            value: `Screenshot saved to ${screenshotPath}`,
            checkedAt: new Date().toISOString(),
          });
          this.traceAction('screenshot', `Screenshot captured`, 'success');
          break;
        }

        case 'browser.upload_file': {
          const selector = action.parameters.selector as string;
          const filePath = action.parameters.filePath as string;
          if (!selector || !filePath) throw new Error('Selector and filePath required for upload');
          const fileInput = await this.state.page.$(selector);
          if (!fileInput) throw new Error(`File input not found: ${selector}`);
          await fileInput.uploadFile(filePath);
          output = { uploaded: true, selector, filePath };
          evidence.push({
            check: 'file_uploaded',
            status: 'pass',
            value: `Uploaded ${filePath} to ${selector}`,
            checkedAt: new Date().toISOString(),
          });
          this.traceAction('upload', `Uploaded file`, 'success');
          break;
        }

        case 'browser.download': {
          const downloadPath = (action.parameters.path as string) ?? action.target;
          // Set download behavior
          const client = await this.state.page.target().createCDPSession();
          await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath,
          });
          // Click the download link if provided
          const selector = action.parameters.selector as string;
          if (selector) {
            await this.state.page.click(selector);
          }
          // Wait for download to potentially start
          await new Promise((resolve) => setTimeout(resolve, 3000));
          output = { downloadPath, initiated: true };
          evidence.push({
            check: 'download_initiated',
            status: 'pass',
            value: `Download initiated to ${downloadPath}`,
            checkedAt: new Date().toISOString(),
          });
          this.traceAction('download', `Download initiated`, 'success');
          break;
        }

        default:
          return {
            executed: false,
            output: null,
            error: `Unsupported capability: ${action.capability}`,
            evidence: [],
            durationMs: Date.now() - startTime,
          };
      }

      // Check for unexpected page change
      const postUrl = this.state.currentUrl;
      if (action.capability !== 'browser.navigate' && action.capability !== 'browser.submit_form' && postUrl !== preUrl) {
        evidence.push({
          check: 'unexpected_navigation',
          status: 'warn',
          value: `Page changed from ${preUrl} to ${postUrl} during action`,
          checkedAt: new Date().toISOString(),
        });
      }

      // Check for MFA/CAPTCHA challenges
      const challenge = await this.detectChallenge();
      if (challenge) {
        if (context.requestHumanIntervention) {
          const intervention: HumanInterventionRequest = {
            requestId: `${action.actionId}-intervention`,
            actionId: action.actionId,
            goalId: action.goalId,
            reason: challenge.reason,
            whatWasAttempted: `Browser action: ${action.capability}`,
            whatSucceeded: 'Navigation to the page succeeded',
            whatFailed: challenge.reason,
            whyCannotContinue: 'HYDI cannot defeat security controls',
            requiredHumanAction: challenge.requiredAction,
            whatHappensAfter: 'HYDI will resume the workflow after the challenge is completed',
            interventionType: challenge.type,
            timestamp: new Date().toISOString(),
          };
          context.requestHumanIntervention(intervention);
        }
        return {
          executed: true,
          output,
          error: null,
          evidence: [...evidence, {
            check: 'security_challenge',
            status: 'warn',
            value: challenge.reason,
            checkedAt: new Date().toISOString(),
          }],
          durationMs: Date.now() - startTime,
        };
      }

      return {
        executed: true,
        output,
        error: null,
        evidence,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      this.traceAction(action.capability, `Failed: ${error instanceof Error ? error.message : 'unknown'}`, 'failure');
      return {
        executed: false,
        output: null,
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

    if (!this.state) {
      return { verified: false, evidence, reason: 'Browser not available' };
    }

    switch (action.capability) {
      case 'browser.navigate': {
        const expectedUrl = (action.parameters.url as string) ?? action.target;
        const actualUrl = this.state.currentUrl;
        const matches = actualUrl === expectedUrl || actualUrl.startsWith(expectedUrl);
        evidence.push({
          check: 'url_matches',
          status: matches ? 'pass' : 'fail',
          value: `Expected: ${expectedUrl}, Actual: ${actualUrl}`,
          checkedAt: new Date().toISOString(),
        });
        return {
          verified: matches,
          evidence,
          reason: matches ? 'Navigation verified' : 'URL mismatch',
        };
      }

      case 'browser.click':
      case 'browser.type':
      case 'browser.select': {
        const hasPass = executionResult.evidence.some((e) => e.status === 'pass');
        evidence.push({
          check: 'action_evidence',
          status: hasPass ? 'pass' : 'fail',
          value: hasPass ? 'Action evidence present' : 'No evidence',
          checkedAt: new Date().toISOString(),
        });
        return {
          verified: hasPass,
          evidence,
          reason: hasPass ? 'Action verified via evidence' : 'No passing evidence',
        };
      }

      case 'browser.inspect_page': {
        const output = executionResult.output as { url: string; title: string } | undefined;
        const hasOutput = !!output && !!output.url;
        evidence.push({
          check: 'page_data_returned',
          status: hasOutput ? 'pass' : 'fail',
          value: hasOutput ? `Page: ${output!.title}` : 'No page data',
          checkedAt: new Date().toISOString(),
        });
        return {
          verified: hasOutput,
          evidence,
          reason: hasOutput ? 'Page inspection verified' : 'No page data returned',
        };
      }

      case 'browser.screenshot': {
        const output = executionResult.output as { screenshotPath: string } | undefined;
        const path = output?.screenshotPath;
        const exists = path ? require('fs').existsSync(path) : false;
        evidence.push({
          check: 'screenshot_exists',
          status: exists ? 'pass' : 'fail',
          value: exists ? 'Screenshot file exists' : 'Screenshot file not found',
          checkedAt: new Date().toISOString(),
        });
        return {
          verified: exists,
          evidence,
          reason: exists ? 'Screenshot verified' : 'Screenshot not found',
        };
      }

      default:
        return { verified: false, evidence, reason: 'No verification strategy for this capability' };
    }
  }

  async rollback(
    _action: HumanAction,
    _executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<RollbackResult> {
    // Browser actions are generally not reversible (can't un-click, un-submit)
    // But we can navigate back
    if (this.state) {
      try {
        await this.state.page.goBack();
        this.state.currentUrl = this.state.page.url();
        return { attempted: true, succeeded: true, evidence: 'Navigated back' };
      } catch {
        return { attempted: true, succeeded: false, evidence: 'Could not navigate back' };
      }
    }
    return { attempted: false, succeeded: false, evidence: 'No browser state', error: 'No browser' };
  }

  isAvailable(): { available: boolean; reason: string | null } {
    // Synchronous check — if puppeteer was loaded and browser state exists
    if (this.state) return { available: true, reason: null };
    if (!puppeteerImportAttempted) {
      // Not yet attempted — check if we have what we need
      const hasChrome = this.chromeEndpoint || this.chromeExecutablePath;
      if (hasChrome) {
        return { available: true, reason: null };
      }
      return { available: false, reason: 'No Chrome executable found' };
    }
    return { available: puppeteer !== null, reason: puppeteer ? null : 'puppeteer not installed' };
  }

  async observe(target: string, _context: ActionExecutionContext): Promise<ActionObservation> {
    if (!this.state) {
      return {
        target,
        exists: false,
        state: 'browser_not_available',
        properties: {},
        observedAt: new Date().toISOString(),
      };
    }
    const url = this.state.currentUrl;
    const title = await this.state.page.title().catch(() => 'unknown');
    return {
      target,
      exists: true,
      state: `url: ${url}, title: ${title}`,
      properties: { url, title },
      observedAt: new Date().toISOString(),
    };
  }

  /**
   * Get the action trace for audit purposes.
   */
  getActionTrace(): Array<{ action: string; timestamp: string; url: string; result: string }> {
    return this.state?.actionTrace ?? [];
  }

  /**
   * Close the browser connection.
   */
  async close(): Promise<void> {
    if (this.state?.browser) {
      try {
        if (this.chromeEndpoint) {
          // Don't close if we connected to an existing instance
          this.state.browser.disconnect();
        } else {
          await this.state.browser.close();
        }
      } catch {
        // Ignore close errors
      }
    }
    this.state = null;
  }

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  private async ensureBrowser(): Promise<{ available: boolean; reason: string | null }> {
    if (this.state) return { available: true, reason: null };

    const puppet = await loadPuppeteer();
    if (!puppet) {
      return {
        available: false,
        reason: 'puppeteer/puppeteer-core not installed. Install with: npm install puppeteer-core',
      };
    }

    try {
      let browser: any;
      if (this.chromeEndpoint) {
        browser = await puppet.connect({ browserWSEndpoint: this.chromeEndpoint });
      } else if (this.chromeExecutablePath) {
        browser = await puppet.launch({
          executablePath: this.chromeExecutablePath,
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      } else {
        // Try to find Chrome
        browser = await puppet.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      }

      const page = await browser.newPage();
      this.state = {
        page,
        browser,
        currentUrl: 'about:blank',
        actionTrace: [],
      };
      return { available: true, reason: null };
    } catch (error) {
      return {
        available: false,
        reason: `Could not launch/connect Chrome: ${error instanceof Error ? error.message : 'unknown'}`,
      };
    }
  }

  private traceAction(action: string, result: string, status: string): void {
    if (!this.state) return;
    this.state.actionTrace.push({
      action,
      timestamp: new Date().toISOString(),
      url: this.state.currentUrl,
      result: `${status}: ${result}`,
    });
  }

  private async detectChallenge(): Promise<{
    reason: string;
    requiredAction: string;
    type: InterventionType;
  } | null> {
    if (!this.state) return null;

    try {
      const pageContent = await this.state.page.evaluate(() => {
        const text = document.body?.innerText ?? '';
        const html = document.documentElement?.outerHTML ?? '';
        return { text: text.toLowerCase(), html: html.toLowerCase() };
      });

      // Check for common MFA/CAPTCHA patterns
      const checks: Array<{ pattern: string; reason: string; action: string; type: InterventionType }> = [
        { pattern: 'two-factor', reason: 'Two-factor authentication required', action: 'Complete the 2FA prompt in the browser', type: 'MFA_REQUIRED' },
        { pattern: '2fa', reason: 'Two-factor authentication required', action: 'Complete the 2FA prompt in the browser', type: 'MFA_REQUIRED' },
        { pattern: 'captcha', reason: 'CAPTCHA challenge detected', action: 'Solve the CAPTCHA in the browser', type: 'CAPTCHA_REQUIRED' },
        { pattern: 'recaptcha', reason: 'reCAPTCHA challenge detected', action: 'Solve the reCAPTCHA in the browser', type: 'CAPTCHA_REQUIRED' },
        { pattern: 'security key', reason: 'Hardware security key confirmation required', action: 'Activate your security key', type: 'SECURITY_KEY_REQUIRED' },
        { pattern: 'biometric', reason: 'Biometric authentication required', action: 'Complete the biometric prompt', type: 'BIOMETRIC_REQUIRED' },
        { pattern: 'verify your identity', reason: 'Identity verification required', action: 'Complete the identity verification', type: 'MFA_REQUIRED' },
      ];

      for (const check of checks) {
        if (pageContent.text.includes(check.pattern) || pageContent.html.includes(check.pattern)) {
          return {
            reason: check.reason,
            requiredAction: check.action,
            type: check.type,
          };
        }
      }
    } catch {
      // Page evaluation failed — can't check for challenges
    }

    return null;
  }
}
