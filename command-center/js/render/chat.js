// Chat tab: shell only (§6.2). Static context chips + sample/empty bubbles + model selector +
// input + Send. Send is a Phase-2 stub → toast, no retrieval / network / postAction. Markup is
// kept intact so Phase 2 only swaps the send handler.

import { esc, safe } from '../util.js';
import { modelSelectHtml } from './agents.js';
import { toast } from './agents.js';

const CONTEXT_CHIPS = ['Agents', 'Schedule', 'Spend', 'Queue'];

function bubbleHtml(b) {
  return `<div class="bubble bubble-${esc(b.role || 'assistant')}">${esc(b.text || '')}</div>`;
}

export function renderChat(state, panelArg) {
  const panel = panelArg || document.getElementById('chat');
  if (!panel) return;
  const msgs = safe(state.chat && state.chat.messages, []);
  const bubbles = Array.isArray(msgs) && msgs.length
    ? msgs.map(bubbleHtml).join('')
    : '<div class="empty-state">Ask the command center anything (Phase 2).</div>';

  panel.innerHTML = `<div class="chat-context">${CONTEXT_CHIPS.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>`
    + `<div class="chat-log">${bubbles}</div>`
    + '<div class="chat-input">'
    + `<select id="chat-model">${modelSelectHtml('Auto')}</select>`
    + '<input id="chat-text" type="text" placeholder="Message the command center…">'
    + '<button class="btn btn-primary" data-action="chatSend">Send</button></div>';
  wireChat(panel);
}

function wireChat(panel) {
  if (panel.__chatWired) return;
  panel.__chatWired = true;
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="chatSend"]')) toast('Chat is Phase 2');
  });
}
