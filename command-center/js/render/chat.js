// Chat tab (§6.2): Phase-2 stub. Markup ported verbatim from the approved mockup — context bar,
// static sample bubbles, model selector, input + Send. Send only toasts; no retrieval / network /
// postAction. Phase 2 swaps the static body + send handler for the real Assistant-agent retrieval.

import { toast } from './agents.js';

export function renderChat(state, panelArg) {
  const panel = panelArg || document.getElementById('chat');
  if (!panel) return;

  panel.innerHTML = `<div class="ctxbar"><span class="lab">In context:</span>
  <span class="ctxchip">Obsidian memory</span><span class="ctxchip">Notion tasks + calendar</span>
  <span class="ctxchip">Recent agent runs</span><span class="ctxchip">This week's schedule</span><span class="ctxchip">iMessage thread</span></div>
<div class="chatwrap grow">
  <div class="chat-head"><span class="dot ok"></span><b>Assistant</b><span class="spacer"></span>
    <select style="width:auto"><optgroup label="Claude · Max"><option>Sonnet</option><option>Opus</option></optgroup><optgroup label="Open · gateway"><option>DeepSeek V3.2</option></optgroup></select></div>
  <div class="chat-body">
    <div class="bubble ai"><div class="who">Assistant · Sonnet</div>Morning Eddie. Today: 3 calendar blocks, DCF practice at 2pm, and the finance thesis is waiting on your approval. Health agent is erroring on an expired Zepp token — want me to refresh it?</div>
    <div class="bubble me"><div class="who">You</div>What did the SpaceX IPO report find on valuation?</div>
    <div class="bubble ai"><div class="who">Assistant · Sonnet</div>Your Research agent ran that Tuesday (medium depth) and saved it to Notion Resources. Headline: implied valuation ~$350B, driven mostly by Starlink ARR, not launch. It flagged the 2027 Starship cadence as the main swing factor.<span class="cite">↳ source: Notion › Resources › "SpaceX pre-IPO teardown" (ran Tue, DeepSeek R1)</span></div>
    <div class="bubble me"><div class="who">You</div>Queue a refresh and add the latest funding round.</div>
    <div class="bubble ai"><div class="who">Assistant · Sonnet</div>Done — queued "SpaceX pre-IPO refresh + latest round" to Research (waiting for downtime). Tweak it in the Queue tab before it runs; I'll text you when it posts.</div>
  </div>
  <div class="chat-input"><input placeholder="Ask about your day, a report, a task… or queue a job"><button class="btn">Send</button></div>
</div>
<div class="note">Not a blank LLM — your Assistant agent with retrieval over your second brain. Same brain as your iMessage bridge.</div>`;

  wireChat(panel);
}

function wireChat(panel) {
  if (panel.__chatWired) return;
  panel.__chatWired = true;
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('.chat-input .btn');
    if (btn) toast('Sent (Phase 2)');
  });
}
