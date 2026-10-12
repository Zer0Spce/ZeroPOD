const { ChatGPTController } = require('./chatgptController');
const { AutomationQueueController } = require('./automationQueueController');

const policyState = new WeakMap();

const POLICY_PATTERNS = [
  /prompt may violate our content policies/i,
  /prompt may violate our content policy/i,
  /may violate our content policies/i,
  /may violate our content policy/i,
  /violates our content policies/i,
  /violates our content policy/i,
  /please retry or edit your prompt/i,
  /we(?:'|’)?re so sorry, but the prompt may violate/i,
  /this request may violate/i,
  /this request violates/i
];

function isPolicyText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return Boolean(text && POLICY_PATTERNS.some((pattern) => pattern.test(text)));
}

async function collectPolicyMessages(page) {
  return page.evaluate(() => {
    const patterns = [
      /prompt may violate our content policies/i,
      /prompt may violate our content policy/i,
      /may violate our content policies/i,
      /may violate our content policy/i,
      /violates our content policies/i,
      /violates our content policy/i,
      /please retry or edit your prompt/i,
      /we(?:'|’)?re so sorry, but the prompt may violate/i,
      /this request may violate/i,
      /this request violates/i
    ];
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const matches = [];
    const seen = new Set();
    const selectors = [
      '[data-message-author-role="assistant"]',
      '[role="alert"]',
      '[data-testid*="error" i]'
    ];
    const nodes = [...document.querySelectorAll(selectors.join(','))];
    nodes.forEach((node, index) => {
      const text = normalize(node.innerText || node.textContent || '');
      if (!text || !patterns.some((pattern) => pattern.test(text))) return;
      const messageNode = node.closest('[data-message-id]');
      const id = node.getAttribute('data-message-id') || messageNode?.getAttribute('data-message-id') || `${node.getAttribute('data-message-author-role') || 'node'}-${index}`;
      const key = `${id}|${text.slice(0, 700)}`;
      if (seen.has(key)) return;
      seen.add(key);
      matches.push({ key, text: text.slice(0, 1200) });
    });

    if (!matches.length) {
      const body = normalize(document.body?.innerText || '');
      const phrase = [
        'prompt may violate our content policies',
        'prompt may violate our content policy',
        'please retry or edit your prompt'
      ].find((value) => body.toLowerCase().includes(value));
      if (phrase) matches.push({ key: `body|${phrase}`, text: phrase });
    }
    return matches;
  }).catch(() => []);
}

function rejectionError(message) {
  const detail = String(message || '').replace(/\s+/g, ' ').trim();
  const error = new Error(detail
    ? `ChatGPT rejected this generation request: ${detail}`
    : 'ChatGPT rejected this generation request because it may violate content policies.');
  error.code = 'CHATGPT_POLICY_REJECTED';
  error.policyMessage = detail || null;
  return error;
}

const previousSendPrompt = ChatGPTController.prototype.sendPrompt;
ChatGPTController.prototype.sendPrompt = async function sendPromptWithPolicyBaseline(page, composer) {
  policyState.delete(page);
  const baseline = await collectPolicyMessages(page);
  const result = await previousSendPrompt.call(this, page, composer);
  policyState.set(page, {
    active: true,
    baseline: new Set(baseline.map((item) => item.key)),
    startedAt: Date.now()
  });
  return result;
};

const previousAssertNoHumanGate = ChatGPTController.prototype.assertNoHumanGate;
ChatGPTController.prototype.assertNoHumanGate = async function assertNoHumanGateWithPolicyCheck(page) {
  await previousAssertNoHumanGate.call(this, page);
  const state = policyState.get(page);
  if (!state?.active) return;

  const matches = await collectPolicyMessages(page);
  const fresh = matches.find((item) => !state.baseline.has(item.key) && isPolicyText(item.text));
  if (fresh) throw rejectionError(fresh.text);
};

const previousCaptureGeneratedImage = ChatGPTController.prototype.captureGeneratedImage;
ChatGPTController.prototype.captureGeneratedImage = async function captureGeneratedImageWithPolicyHandling(page, projectId, baseline, step) {
  try {
    const result = await previousCaptureGeneratedImage.call(this, page, projectId, baseline, step);
    policyState.delete(page);
    return result;
  } catch (error) {
    if (error?.code !== 'CHATGPT_POLICY_REJECTED') throw error;

    policyState.delete(page);
    const at = new Date().toISOString();
    const message = error.policyMessage || error.message || 'ChatGPT rejected this generation request because it may violate content policies.';
    const note = {
      service: 'ChatGPT',
      step: 'policy-rejection',
      code: 'CHATGPT_POLICY_REJECTED',
      message,
      at,
      recovery: 'This project was canceled because ChatGPT rejected the generation prompt. Review the reference/prompt before trying a new workflow.'
    };

    try {
      this.projects.update(projectId, {
        status: 'chatgpt-policy-rejected',
        automationStep: 'Rejected by ChatGPT policy',
        chatgptError: note
      });
      this.projects.addActivity(projectId, {
        type: 'chatgpt-policy',
        label: 'ChatGPT rejected the generation prompt; project canceled',
        details: message,
        at
      });
    } catch {}

    if (typeof step === 'function') step('Rejected by ChatGPT policy');
    throw error;
  }
};

const previousMapProjectToRow = AutomationQueueController.prototype.mapProjectToRow;
AutomationQueueController.prototype.mapProjectToRow = function mapProjectToRowWithPolicySkip(project) {
  if (project?.status === 'chatgpt-policy-rejected') {
    return {
      status: 'skipped',
      step: 'Skipped · ChatGPT rejected prompt',
      checkpoint: 'chatgpt-policy-rejected',
      lastError: project.chatgptError?.message || 'ChatGPT rejected this generation request because it may violate content policies.'
    };
  }
  return previousMapProjectToRow.call(this, project);
};

module.exports = { isPolicyText, collectPolicyMessages };
