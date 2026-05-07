import puppeteer, { Browser, Page } from 'puppeteer';
import { WebSocket } from 'ws';
import { SwarmLogEvent } from '../types';

let browserInstance: Browser | null = null;
let activePage: Page | null = null;
let streamInterval: NodeJS.Timeout | null = null;

/**
 * Launch a visible Chromium browser.
 * headless: false so we can see it (and optionally record it).
 * For demo: run headless:'new' on server, stream screenshots.
 */
export async function launchBrowser(): Promise<{ browser: Browser; page: Page }> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
  }

  browserInstance = await puppeteer.launch({
    headless: true,           // true headless — still renders, can screenshot
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browserInstance.newPage();
  activePage = page;

  // Set a realistic user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  return { browser: browserInstance, page };
}

/**
 * Start streaming screenshots to all connected WebSocket clients.
 * Sends a base64 JPEG every 200ms (5 fps — enough for demo).
 */
export function startScreenStream(
  page: Page,
  broadcastScreen: (base64Jpeg: string) => void
): void {
  if (streamInterval) clearInterval(streamInterval);

  streamInterval = setInterval(async () => {
    try {
      if (!page.isClosed()) {
        const screenshot = await page.screenshot({
          type:    'jpeg',
          quality: 60,        // lower quality = faster streaming
          encoding: 'base64',
        });
        broadcastScreen(screenshot as string);
      }
    } catch {
      // page might close mid-stream — ignore
    }
  }, 200);
}

export function stopScreenStream(): void {
  if (streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
  }
}

export async function closeBrowser(): Promise<void> {
  stopScreenStream();
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    activePage = null;
  }
}

// ── High-level browser actions used by agents ────────────────────────

/**
 * Navigate to a URL with a human-like delay and scroll
 */
export async function navigateTo(
  page: Page,
  url: string,
  broadcast: (e: SwarmLogEvent) => void,
  agentName: string
): Promise<void> {
  broadcast({
    type: 'browser_navigate', agent: agentName as any,
    message: `Navigating to ${url}`,
    timestamp: Date.now(),
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
  } catch (err: any) {
    console.warn(`Navigation to ${url} warning:`, err.message);
  }
  await humanDelay(800, 1400);
}

/**
 * Scroll down slowly like a human reading
 */
export async function humanScroll(page: Page, times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    try {
      await page.evaluate(() => (window as any).scrollBy({ top: 400, behavior: 'smooth' }));
      await humanDelay(500, 900);
    } catch { break; }
  }
}

/**
 * Type into a search box like a human (character by character)
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string
): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    await page.click(selector);
    await humanDelay(200, 400);
    await page.type(selector, text, { delay: 60 + Math.random() * 40 });
  } catch {
    // selector not found — skip
  }
}

/**
 * Extract visible page text for LLM processing
 */
export async function extractPageText(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      // Remove scripts, styles, nav elements
      const clone = (document as any).body.cloneNode(true) as any;
      clone.querySelectorAll('script,style,nav,header,footer,noscript').forEach((el: any) => el.remove());
      return clone.innerText.slice(0, 8000); // cap at 8k chars
    });
  } catch {
    return '';
  }
}

/**
 * Take a labeled screenshot for the report
 */
export async function takeScreenshot(page: Page): Promise<string> {
  try {
    const shot = await page.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64' });
    return `data:image/jpeg;base64,${shot}`;
  } catch {
    return '';
  }
}

function humanDelay(min: number, max: number): Promise<void> {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}
