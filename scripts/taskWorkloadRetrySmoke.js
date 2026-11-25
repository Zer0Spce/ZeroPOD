const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

async function waitUntil(predicate, timeoutMs = 4500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Task Workload job did not finish');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeropod-task-retry-'));
  const source = path.join(root, 'reference.png');
  const exported = path.join(root, 'export.png');
  const generated = path.join(root, 'generated.png');
  fs.writeFileSync(source, 'REFERENCE');
  fs.writeFileSync(generated, 'GENERATED');
  fs.writeFileSync(exported, 'PNG-FIRST');

  const mockSharp = input => ({
    png() {
      return {
        async toFile(file) {
          fs.writeFileSync(file, fs.readFileSync(input));
        }
      };
    },
    async metadata() {
      return { format: 'png', width: 4500, height: 5400, hasAlpha: true };
    },
    resize() {
      return {
        webp() {
          return {
            async toBuffer() {
              return Buffer.from('small-preview');
            }
          };
        }
      };
    }
  });
  const originalLoad = Module._load;
  let TaskWorkload;
  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') {
        return { app: { getPath: key => path.join(root, key) } };
      }
      if (request === 'sharp') return mockSharp;
      return originalLoad.call(this, request, parent, isMain);
    };
    TaskWorkload = require('../src/main/taskWorkload').TaskWorkload;
  } finally {
    Module._load = originalLoad;
  }

  try {
    let generationCount = 0;
    let vectorCount = 0;
    let failNextExport = false;
    const projects = {
      getProjectDir(id) {
        const dir = path.join(root, 'projects', id);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      },
      read(id) {
        return { id, status: 'awaiting-review', generatedImagePath: generated };
      },
      update(id, fields) {
        return { id, ...fields };
      }
    };
    const workload = new TaskWorkload({
      projects,
      chatgpt: {
        buildPrompt: () => 'Existing generation prompt',
        async start(payload) {
          assert.strictEqual(payload.referencePath, source);
          generationCount++;
          return { projectId: 'project-' + generationCount };
        }
      },
      vectorizer: {
        async start() {
          vectorCount++;
        }
      },
      exporter: {
        async exportPng() {
          if (failNextExport) {
            failNextExport = false;
            throw new Error('simulated vector/export failure');
          }
          return { path: exported };
        }
      }
    });
    workload.referenceImage = async () => source;

    workload.setRows([{ id: 'I-261028-15', niche: 'antlers', idea: 'antler design',
      text: 'EXACT WORDS', reference: '', difference: '' }]);
    workload.start();
    await waitUntil(() => !workload.running);
    const first = workload.rows[0];
    assert.strictEqual(first.status, 'completed');
    assert.strictEqual(generationCount, 1);
    assert.strictEqual(vectorCount, 1);
    assert.strictEqual(fs.readFileSync(first.output, 'utf8'), 'PNG-FIRST');
    assert.strictEqual(first.output.endsWith('I-261028-15_antlers.png'), true);
    const preview = await workload.preview(0);
    assert.strictEqual(preview.src, 'data:image/webp;base64,' + Buffer.from('small-preview').toString('base64'));

    // Updating design instructions must not sever the old PNG from its row.
    const edit = { ...workload.rows[0], difference: 'Use bolder antlers' };
    workload.setRows([edit]);
    assert.strictEqual(workload.rows[0].output, first.output);
    assert.strictEqual(workload.rows[0].status, 'pending');
    workload.appendRows([{ id: 'I-261028-16', niche: 'woodland', idea: 'forest poster' }]);
    assert.strictEqual(workload.rows[1].status, 'pending');

    fs.writeFileSync(exported, 'PNG-REPLACED');
    workload.retryRow(0);
    await waitUntil(() => !workload.running);
    assert.strictEqual(workload.rows[0].status, 'completed');
    assert.strictEqual(fs.readFileSync(first.output, 'utf8'), 'PNG-REPLACED');
    assert.strictEqual(generationCount, 2);
    assert.strictEqual(vectorCount, 2);
    assert.strictEqual(workload.rows[1].status, 'pending', 'retry must not process another row');
    assert.ok(workload.rows[0].completedAt, 'successful retry must update preview version');

    // Failing a retry should never corrupt the previously successful PNG.
    failNextExport = true;
    workload.retryRow(0);
    await waitUntil(() => !workload.running);
    assert.strictEqual(workload.rows[0].status, 'failed');
    assert.ok(workload.rows[0].error.includes('simulated vector/export failure'));
    assert.strictEqual(fs.readFileSync(first.output, 'utf8'), 'PNG-REPLACED');
    assert.strictEqual(workload.rows[0].output, first.output);
    assert.strictEqual(workload.rows[1].status, 'pending');

    // The user can retry that failed row again without manual deletion.
    fs.writeFileSync(exported, 'PNG-THIRD');
    workload.retryRow(0);
    await waitUntil(() => !workload.running);
    assert.strictEqual(workload.rows[0].status, 'completed');
    assert.strictEqual(fs.readFileSync(first.output, 'utf8'), 'PNG-THIRD');
    assert.strictEqual(generationCount, 4);
    assert.strictEqual(workload.rows[1].status, 'pending');
    assert.throws(() => workload.retryRow(99), /not found/i);
    assert.throws(() => workload.retryRow(-1), /not found/i);

    // Never allow the preview IPC to read an arbitrary file path.
    workload.rows[0].output = source;
    await assert.rejects(() => workload.preview(0), /Invalid Task Workload output path/);

    console.log('Task Workload retry isolation, image previews, atomic replacement, failed-retry preservation: OK');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
