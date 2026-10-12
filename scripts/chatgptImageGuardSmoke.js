const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  visuallyMatchesReference,
  normalizedImageDifference
} = require('../src/main/chatgptGeneratedImageGuardPatch');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeropod-chatgpt-imageguard-'));
  const referencePath = path.join(root, 'reference.png');

  try {
    const reference = await sharp({
      create: {
        width: 800,
        height: 1000,
        channels: 4,
        background: { r: 20, g: 24, b: 28, alpha: 1 }
      }
    })
      .composite([
        {
          input: Buffer.from('<svg width="500" height="180" xmlns="http://www.w3.org/2000/svg"><rect width="500" height="180" fill="#111827"/><text x="250" y="115" text-anchor="middle" font-size="86" font-family="Arial" fill="#ffffff">REFERENCE</text></svg>'),
          left: 150,
          top: 380
        }
      ])
      .png()
      .toBuffer();

    fs.writeFileSync(referencePath, reference);

    // Same visual image, resized and JPEG-compressed: this mimics ChatGPT/Akamai
    // returning a thumbnail/transcoded copy of the uploaded reference.
    const transcodedReference = await sharp(reference)
      .resize(400, 500)
      .jpeg({ quality: 82 })
      .toBuffer();

    const same = await visuallyMatchesReference(transcodedReference, referencePath);
    assert(same.match, `transcoded reference should be rejected (difference ${same.difference})`);

    // A clearly different generated design must remain eligible.
    const generated = await sharp({
      create: {
        width: 800,
        height: 1000,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      }
    })
      .composite([
        {
          input: Buffer.from('<svg width="700" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="700" height="500" fill="none"/><text x="350" y="250" text-anchor="middle" font-size="110" font-family="Arial" fill="#ff7a00">NEW DESIGN</text><circle cx="350" cy="350" r="70" fill="#22c55e"/></svg>'),
          left: 50,
          top: 250
        }
      ])
      .png()
      .toBuffer();

    const different = await visuallyMatchesReference(generated, referencePath);
    assert(!different.match, `different generated image should not be rejected (difference ${different.difference})`);

    const diff = await normalizedImageDifference(reference, generated);
    assert(Number.isFinite(diff) && diff > 7.5, `expected a meaningful visual difference, got ${diff}`);

    console.log('ChatGPT generated-image guard smoke check passed.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(`ChatGPT generated-image guard smoke check failed: ${error.message || error}`);
  process.exitCode = 1;
});
