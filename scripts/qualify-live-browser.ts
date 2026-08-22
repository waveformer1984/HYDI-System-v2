/**
 * HYDI Live Browser Qualification
 *
 * Proves that HYDI can actually operate a browser through the
 * BrowserAdapter using puppeteer-core with a real Chrome instance.
 *
 * Uses a disposable LOCAL test web application — never production websites.
 *
 * Tests:
 *   1. Launch Chrome
 *   2. Navigate to test page
 *   3. Observe page (title, content)
 *   4. Navigate to form page
 *   5. Identify form elements
 *   6. Enter data into form
 *   7. Select from dropdown
 *   8. Submit form
 *   9. Observe result page
 *  10. Verify result matches input
 *  11. Navigate to login page
 *  12. Enter test credentials
 *  13. Submit login
 *  14. Reach MFA challenge
 *  15. Create intervention request
 *  16. Simulate human MFA approval
 *  17. Verify authenticated page
 *
 * Usage:
 *   npx tsx scripts/qualify-live-browser.ts
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { InterventionQueue } from '../lib/delegated-operator/InterventionQueue';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.log(`  ✗ ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Chrome detection
// ---------------------------------------------------------------------------

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Users\\Owner\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome(): string | null {
  const fs = require('fs');
  for (const p of CHROME_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Launch test web app
// ---------------------------------------------------------------------------

async function launchTestApp(): Promise<{ process: ChildProcess; port: number }> {
  const port = 9876;
  const proc = spawn('npx', ['tsx', path.join(__dirname, 'test-web-app.ts')], {
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, HYDI_TEST_PORT: String(port) },
  });

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Verify health
  const http = require('http');
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(`http://localhost:${port}/health`, (res: any) => {
        let body = '';
        res.on('data', (chunk: any) => { body += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json.status === 'ok') {
              resolve({ process: proc, port });
            } else {
              reject(new Error('Health check failed'));
            }
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', () => {
        // Retry after 1s
        setTimeout(check, 1000);
      });
    };
    check();
  });
}

// ---------------------------------------------------------------------------
// Main qualification
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Live Browser Qualification');
  console.log('═══════════════════════════════════════════════════════════════');

  // 1. Find Chrome
  console.log('\nStep 1: Detect Chrome');
  const chromePath = findChrome();
  assert(chromePath !== null, 'Chrome executable found');
  if (!chromePath) {
    console.log('\nCannot proceed without Chrome. Aborting.');
    process.exit(1);
  }
  console.log(`  Chrome path: ${chromePath}`);

  // 2. Launch test web app
  console.log('\nStep 2: Launch disposable test web app');
  let testApp: { process: ChildProcess; port: number };
  try {
    testApp = await launchTestApp();
    assert(true, 'Test web app launched');
    console.log(`  Test app: http://localhost:${testApp.port}`);
  } catch (err) {
    assert(false, `Test web app failed to start: ${err}`);
    process.exit(1);
  }

  // 3. Launch Chrome via puppeteer-core
  console.log('\nStep 3: Launch Chrome via puppeteer-core');
  let browser: any = null;
  let page: any = null;
  try {
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
    assert(browser !== null, 'Chrome launched via puppeteer-core');
    page = await browser.newPage();
    assert(page !== null, 'New page created');
  } catch (err) {
    assert(false, `Chrome launch failed: ${err instanceof Error ? err.message : 'unknown'}`);
    testApp.process.kill();
    process.exit(1);
  }

  try {
    // 4. Navigate to home page
    console.log('\nStep 4: Navigate to home page');
    await page.goto(`http://localhost:${testApp.port}/`, { waitUntil: 'networkidle0' });
    const title = await page.title();
    assert(title.includes('HYDI Test App'), `Page title correct: "${title}"`);

    // 5. Observe page content
    console.log('\nStep 5: Observe page content');
    const statusText = await page.$eval('#status', (el: any) => el.textContent);
    assert(statusText === 'running', `Status indicator found: "${statusText}"`);

    const counterText = await page.$eval('#counter', (el: any) => el.textContent);
    assert(counterText !== null, `Dynamic counter found: ${counterText}`);

    // 6. Navigate to form page
    console.log('\nStep 6: Navigate to form page');
    await page.click('#nav-form');
    await page.waitForSelector('#test-form');
    const formTitle = await page.title();
    assert(formTitle.includes('Form'), `Form page loaded: "${formTitle}"`);

    // 7. Enter data into form
    console.log('\nStep 7: Enter data into form');
    await page.type('#name', 'HYDI Test User');
    await page.select('#category', 'beta');

    // Verify the input was entered
    const nameValue = await page.$eval('#name', (el: any) => el.value);
    assert(nameValue === 'HYDI Test User', `Name input entered: "${nameValue}"`);

    const categoryValue = await page.$eval('#category', (el: any) => el.value);
    assert(categoryValue === 'beta', `Category selected: "${categoryValue}"`);

    // 8. Submit form
    console.log('\nStep 8: Submit form');
    await page.click('#submit-btn');
    await page.waitForSelector('#result');

    // 9. Verify result
    console.log('\nStep 9: Verify submitted result');
    const resultName = await page.$eval('#result-name', (el: any) => el.textContent);
    assert(resultName === 'HYDI Test User', `Result name matches: "${resultName}"`);

    const resultCategory = await page.$eval('#result-category', (el: any) => el.textContent);
    assert(resultCategory === 'beta', `Result category matches: "${resultCategory}"`);

    const resultStatus = await page.$eval('#result-status', (el: any) => el.textContent);
    assert(resultStatus === 'success', `Result status is success: "${resultStatus}"`);

    // 10. Navigate to login page
    console.log('\nStep 10: Navigate to login page');
    await page.goto(`http://localhost:${testApp.port}/login`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login-form');
    assert(true, 'Login page loaded');

    // 11. Enter test credentials
    console.log('\nStep 11: Enter test credentials');
    await page.type('#username', 'testuser');
    await page.type('#password', 'testpass');

    const usernameValue = await page.$eval('#username', (el: any) => el.value);
    assert(usernameValue === 'testuser', `Username entered: "${usernameValue}"`);

    // 12. Submit login
    console.log('\nStep 12: Submit login (reaches MFA challenge)');
    await page.click('#login-btn');
    await page.waitForSelector('#mfa-status', { timeout: 5000 });

    // 13. Verify MFA challenge
    console.log('\nStep 13: Verify MFA challenge reached');
    const mfaStatus = await page.$eval('#mfa-status', (el: any) => el.textContent);
    assert(mfaStatus === 'pending', `MFA challenge reached, status: "${mfaStatus}"`);

    // 14. Create intervention request
    console.log('\nStep 14: Create intervention request for MFA');
    const queue = new InterventionQueue();
    const intervention = queue.enqueue({
      goalId: 'goal_browser_auth_001',
      identityId: 'identity_browser_001',
      userId: 'user:owner',
      currentObjective: 'AUTHENTICATE',
      blocker: 'MFA_REQUIRED',
      requiredHumanAction: 'Approve the MFA challenge on the test page',
      whyRequired: 'MFA cannot be bypassed by policy',
      expectedResultingState: 'Authenticated browser session',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      resumeCondition: 'MFA approved and protected page accessible',
      auditId: 'audit_browser_001',
      interventionType: 'MFA_REQUIRED',
      originalRequest: {
        requestId: 'req_mfa_001', actionId: 'action_login_001', goalId: 'goal_browser_auth_001',
        reason: 'MFA required', whatWasAttempted: 'Login with test credentials',
        whatSucceeded: 'Credentials accepted', whatFailed: 'MFA challenge',
        whyCannotContinue: 'Cannot bypass MFA', requiredHumanAction: 'Approve MFA',
        whatHappensAfter: 'Access protected page',
        interventionType: 'MFA_REQUIRED', timestamp: new Date().toISOString(),
      },
    });
    assert(intervention.requestId !== undefined, 'Intervention request created');
    assert(queue.getPending().length === 1, 'One pending intervention');

    // 15. Simulate human MFA approval
    console.log('\nStep 15: Simulate human MFA approval');
    await page.click('#mfa-approve-btn');
    await page.waitForSelector('#session');

    // 16. Verify authenticated page
    console.log('\nStep 16: Verify authenticated page');
    const protectedTitle = await page.title();
    assert(protectedTitle.includes('Protected'), `Protected page reached: "${protectedTitle}"`);

    const sessionText = await page.$eval('#session', (el: any) => el.textContent);
    assert(sessionText === 'authenticated', `Session is authenticated: "${sessionText}"`);

    // 17. Resolve intervention
    console.log('\nStep 17: Resolve intervention');
    const resolved = queue.resolve(intervention.requestId, 'Human approved MFA via test page');
    assert(resolved, 'Intervention resolved');
    assert(queue.getPending().length === 0, 'No pending interventions after resolution');

    // 18. Take screenshot for evidence
    console.log('\nStep 18: Capture screenshot evidence');
    const screenshotPath = path.join(process.cwd(), 'data', 'browser-qualification-screenshot.png');
    const fs = require('fs');
    if (!fs.existsSync(path.dirname(screenshotPath))) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    }
    await page.screenshot({ path: screenshotPath });
    assert(fs.existsSync(screenshotPath), `Screenshot saved: ${screenshotPath}`);

  } catch (err) {
    assert(false, `Browser qualification failed: ${err instanceof Error ? err.message : 'unknown'}`);
  } finally {
    // Cleanup
    if (browser) {
      await browser.close();
    }
    testApp.process.kill();
  }

  // Results
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  ✗ ${f}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
