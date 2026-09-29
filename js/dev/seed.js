// Dev-only: creates a large conversation for performance work.
// kitsunai.debug.seed(500) → conversation id

import { transaction, promisify } from '../db.js';
import { createConversation } from '../data/conversations.js';
import { listModels } from '../data/models.js';
import { emit } from '../events.js';

const USER = [
  (i) => `Question ${i}: what is the damping ratio for $\\omega_0 = ${i}$ rad/s?`,
  (i) => `Can you show code for step ${i}?`,
  (i) => `Summarize point ${i} as a table.`,
  (i) => `Derive the Larmor radius for case ${i}.`,
];

const ASSISTANT = [
  (i) => `The system has natural frequency $\\omega_0 = ${i}$ and damping $\\zeta$. Its transfer function is\n\n$$\nH_{${i}}(s)=\\frac{\\omega_0^2}{s^2+2\\zeta\\omega_0 s+\\omega_0^2}\n$$\n\nFor $\\zeta < 1$ the response rings; for $\\zeta \\ge 1$ it does not.`,
  (i) => `Here is step ${i}:\n\n\`\`\`python\nimport numpy as np\n\ndef step_${i}(t, zeta=0.3, w0=${i}):\n    wd = w0 * np.sqrt(1 - zeta**2)\n    return 1 - np.exp(-zeta * w0 * t) * np.cos(wd * t)\n\`\`\`\n\nCall it with a time vector.`,
  (i) => `| Item | Value | Note |\n|---|---|---|\n| index | ${i} | $x_{${i}}$ |\n| square | ${i * i} | exact |\n| root | ${Math.sqrt(i).toFixed(3)} | approx. |\n\n1. First point.\n2. Second point with **emphasis**.`,
  (i) => `For an electron, $r_L = \\frac{m_e v_\\perp}{eB}$. With $B = ${(i % 9) + 1}\\,\\text{T}$:\n\n- Doubling $B$ halves $r_L$.\n- The cyclotron frequency is $\\omega_c = eB/m_e$.\n\n> Case ${i} is non-relativistic.`,
];

export async function seed(n = 500) {
  const [model] = await listModels();
  if (!model) throw new Error('Add a model first.');
  const conversation = await createConversation({ title: `Seeded ${n}-message conversation`, modelId: model.id, modelName: model.name });
  const start = Date.now() - n * 1000;
  await transaction('messages', 'readwrite', async (tx) => {
    const store = tx.objectStore('messages');
    for (let i = 0; i < n; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      const k = Math.floor(i / 2);
      const markdown = role === 'user' ? USER[k % USER.length](k) : ASSISTANT[k % ASSISTANT.length](k);
      store.put({ id: crypto.randomUUID(), conversationId: conversation.id, role, markdown, createdAt: start + i * 1000, metadata: role === 'assistant' ? { status: 'complete' } : {} });
    }
    await promisify(store.count());
  });
  emit('conversations:changed', { id: conversation.id });
  return conversation.id;
}
