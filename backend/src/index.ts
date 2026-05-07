import 'dotenv/config';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { launchBrowser, startScreenStream, stopScreenStream, closeBrowser } from './browser/browserAgent';
import { decomposeTask } from './orchestrator';
import { fetchMarketDataBrowser } from './agents/marketDataBrowser';
import { fetchSentimentBrowser } from './agents/sentimentBrowser';
import { synthesizeReport } from './agents/synthesizer';
import { resolveTaskOnChain } from './solana/client';
import { checkOllamaHealth } from './llm/client';
import { SwarmLogEvent } from './types';

const app = express();
app.use(express.json());
app.use((_, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

const server = createServer(app);

// ── Two WebSocket channels ──────────────────────────────────────────────────
// /swarm-logs  → structured JSON log events (agent status, x402, etc.)
// /screen-feed → raw base64 JPEG frames of the browser viewport

const logsWss   = new WebSocketServer({ noServer: true });
const screenWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/swarm-logs') {
    logsWss.handleUpgrade(request, socket, head, (ws) => {
      logsWss.emit('connection', ws, request);
    });
  } else if (pathname === '/screen-feed') {
    screenWss.handleUpgrade(request, socket, head, (ws) => {
      screenWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const logClients    = new Set<WebSocket>();
const screenClients = new Set<WebSocket>();

logsWss.on('connection', ws => {
  logClients.add(ws);
  ws.on('close', () => logClients.delete(ws));
});

screenWss.on('connection', ws => {
  screenClients.add(ws);
  ws.on('close', () => screenClients.delete(ws));
});

function broadcast(event: SwarmLogEvent) {
  const msg = JSON.stringify(event);
  logClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

function broadcastScreen(base64Jpeg: string) {
  const msg = JSON.stringify({ type: 'frame', data: base64Jpeg });
  screenClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

// ── Main execute endpoint ───────────────────────────────────────────────────

app.post('/api/swarm/execute', async (req, res) => {
  const { prompt, taskId, userWallet } = req.body as {
    prompt: string; taskId: string; userWallet?: string;
  };
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });

  res.json({ status: 'swarm_started', taskId });

  try {
    broadcast({ type: 'task_created', message: `Swarm activated: "${prompt.slice(0,60)}..."`, timestamp: Date.now() });

    // ── Launch browser ────────────────────────────────────────────────
    const { browser, page } = await launchBrowser();

    // Start streaming the browser viewport to all connected clients
    startScreenStream(page, broadcastScreen);

    broadcast({ type: 'browser_launched', agent: 'Orchestrator', message: 'Browser launched — agents taking control...', timestamp: Date.now() });

    // ── Orchestrator decomposes the task ──────────────────────────────
    const subTasks = await decomposeTask(prompt, broadcast);

    const taskA = subTasks.find(t => t.agent === 'MarketDataAgent')!;
    const taskB = subTasks.find(t => t.agent === 'SentimentAgent')!;
    const taskC = subTasks.find(t => t.agent === 'SynthesizerAgent')!;

    // ── MarketData agent controls browser ────────────────────────────
    // NOTE: Agents run SEQUENTIALLY to share the same browser page
    // so the user sees a single continuous browsing session.
    const marketData = await fetchMarketDataBrowser(
      taskA.description, taskA.query, page, broadcast
    );

    // ── Sentiment agent continues in the same browser ─────────────────
    const sentimentData = await fetchSentimentBrowser(
      taskB.description, taskB.query, page, broadcast
    );

    // ── Browser goes to report-style page while synthesizer works ─────
    await page.goto('about:blank');
    await page.setContent(`
      <html>
        <body style="background:#05050F;color:#14F195;font-family:monospace;padding:40px;font-size:16px;">
          <div style="color:#9945FF;font-size:24px;margin-bottom:20px;">⬡ SwarmX Synthesizer</div>
          <div>Generating report from collected data...</div>
          <div style="margin-top:20px;color:#555577;">MarketDataAgent: ${(marketData.tokens as any[])?.length || 0} tokens collected</div>
          <div style="color:#555577;">SentimentAgent: analysis complete</div>
          <div style="margin-top:30px;color:#FFB800;animation:pulse 1s infinite;">● Synthesizing...</div>
        </body>
      </html>
    `);

    // ── Synthesizer generates the report ─────────────────────────────
    const report = await synthesizeReport(
      marketData, sentimentData, prompt, taskC.description, broadcast
    );

    // ── Render the report IN the browser viewport ─────────────────────
    const reportHtml = renderReportToHtml(report, prompt);
    await page.setContent(reportHtml);
    await page.evaluate(() => (window as any).scrollTo({ top: 0 }));

    broadcast({
      type: 'report_rendered', agent: 'SynthesizerAgent',
      message: 'Report rendered in browser viewport ✓',
      timestamp: Date.now(),
    });

    // Give UI time to show the report in the browser viewport
    await new Promise(r => setTimeout(r, 2000));

    // ── Resolve on-chain ──────────────────────────────────────────────
    let resolveSignature = '';
    try {
      const resolved = await resolveTaskOnChain(parseInt(taskId), [
        { agentPubkey: process.env.AGENT_A_PUBKEY!, amountUsdc: taskA.fee_usdc, label: taskA.agent },
        { agentPubkey: process.env.AGENT_B_PUBKEY!, amountUsdc: taskB.fee_usdc, label: taskB.agent },
        { agentPubkey: process.env.AGENT_C_PUBKEY!, amountUsdc: taskC.fee_usdc, label: taskC.agent },
      ]);
      resolveSignature = resolved.signature;
    } catch (err) {
      console.error('[Solana] resolve_task failed:', err);
    }

    // Stop screen stream — browser done
    stopScreenStream();

    broadcast({
      type: 'task_resolved', agent: 'Orchestrator',
      message: `✅ Task complete | USDC distributed | ${resolveSignature ? `tx: ${resolveSignature.slice(0,16)}...` : ''}`,
      data: {
        report,
        prompt,
        resolveSignature,
        resolveExplorerUrl: resolveSignature
          ? `https://explorer.solana.com/tx/${resolveSignature}?cluster=devnet`
          : null,
        payouts: [
          { agent: taskA.agent, usdc: taskA.fee_usdc },
          { agent: taskB.agent, usdc: taskB.fee_usdc },
          { agent: taskC.agent, usdc: taskC.fee_usdc },
        ],
      },
      timestamp: Date.now(),
    });

  } catch (err: any) {
    console.error('[SwarmX] Execution error:', err);
    stopScreenStream();
    await closeBrowser();
    broadcast({ type: 'task_error', message: `Swarm failed: ${err.message}`, timestamp: Date.now() });
  }
});

/**
 * Renders the markdown report as a beautiful dark HTML page
 * that will be displayed IN the Puppeteer browser viewport
 */
function renderReportToHtml(markdownReport: string, prompt: string): string {
  // Convert basic markdown to HTML (headings, bold, tables)
  const html = markdownReport
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^\|(.+)\|$/gm, (row) => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #05050F;
    color: #F0F0FF;
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.7;
    padding: 40px 48px;
    max-width: 900px;
  }
  .header {
    border-bottom: 1px solid #1E1E3A;
    padding-bottom: 20px;
    margin-bottom: 28px;
  }
  .badge {
    display: inline-block;
    background: #9945FF22;
    border: 1px solid #9945FF;
    color: #9945FF;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-family: monospace;
    margin-bottom: 12px;
  }
  .prompt-label {
    color: #555577;
    font-size: 11px;
    font-family: monospace;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
  .prompt-text {
    color: #8888AA;
    font-style: italic;
    font-size: 13px;
    margin-bottom: 0;
  }
  h1 { color: #F0F0FF; font-size: 22px; font-weight: 700; margin: 24px 0 12px; }
  h2 { color: #F0F0FF; font-size: 17px; font-weight: 600; margin: 20px 0 10px; border-left: 3px solid #9945FF; padding-left: 10px; }
  h3 { color: #14F195; font-size: 14px; font-weight: 600; margin: 16px 0 8px; }
  p  { color: #C0C0D0; margin: 8px 0; }
  strong { color: #14F195; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th { background: #141428; color: #9945FF; padding: 8px 12px; text-align: left; border-bottom: 1px solid #1E1E3A; }
  td { padding: 7px 12px; border-bottom: 1px solid #0D0D1A; color: #C0C0D0; }
  tr:hover td { background: #0D0D1A; }
  .footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid #1E1E3A;
    color: #333355;
    font-size: 11px;
    font-family: monospace;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="badge">⬡ SwarmX Research Report</div>
    <div class="prompt-label">Research Prompt</div>
    <div class="prompt-text">"${prompt}"</div>
  </div>
  ${html}
  <div class="footer">
    <span>Generated by SwarmX Agentic Swarm</span>
    <span>${new Date().toUTCString()}</span>
  </div>
</body>
</html>`;
}

// ── Health endpoint for frontend status display ──────────────────────────────
app.get('/health', async (_, res) => {
  const ollama = await checkOllamaHealth();
  res.json({
    status: 'ok',
    llm: {
      primary:   ollama.running ? 'ollama' : 'anthropic',
      ollama:    ollama,
      use_local: process.env.USE_LOCAL_LLM !== 'false',
    },
    browser: 'puppeteer',
  });
});

// ── Startup health check ─────────────────────────────────────────────────────
(async () => {
  const health = await checkOllamaHealth();
  if (health.running) {
    console.log(`[LLM] Ollama running ✓ | Models: ${health.models.join(', ')}`);
    if (health.recommended_missing.length > 0) {
      console.warn(`[LLM] Missing recommended models. Run:`);
      health.recommended_missing.forEach(m => console.warn(`  ollama pull ${m}`));
    }
  } else {
    console.warn('[LLM] Ollama not running — will use Anthropic API fallback');
    console.warn('[LLM] Start it with: ollama serve');
  }
})();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SwarmX backend :${PORT} | /swarm-logs ws | /screen-feed ws`);
});
