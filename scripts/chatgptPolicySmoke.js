const { isPolicyText } = require('../src/main/chatgptPolicyRejectionPatch');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const refusal = "We’re so sorry, but the prompt may violate our content policies. If you think we got it wrong, please retry or edit your prompt.";
assert(isPolicyText(refusal), 'Expected the real ChatGPT policy refusal text to be detected.');
assert(isPolicyText('This request may violate our content policy.'), 'Expected policy warning variant to be detected.');
assert(!isPolicyText('Your image is ready. I created a clean transparent POD design.'), 'Normal assistant text must not be classified as a policy refusal.');
assert(!isPolicyText('Please retry the download if the image did not load.'), 'Generic retry text must not be classified as a policy refusal.');

console.log('ChatGPT policy rejection smoke check passed.');
