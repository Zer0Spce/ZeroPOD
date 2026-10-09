const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class ExportController {
  constructor({ projects }) {
    this.projects = projects;
  }

  async exportPng(projectId) {
    const project = this.projects.read(projectId);
    if (!project.vectorPath || !fs.existsSync(project.vectorPath)) {
      throw new Error('Vector file is missing. Complete the Vectorizer.ai step first.');
    }

    const ext = path.extname(project.vectorPath).toLowerCase();
    if (ext !== '.svg') {
      throw new Error('ZeroPOD currently exports from SVG. Download the SVG version from Vectorizer.ai.');
    }

    const output = path.join(this.projects.getProjectDir(projectId), 'final-4500x5400.png');
    const svgBuffer = fs.readFileSync(project.vectorPath);

    await sharp(svgBuffer, { density: 600 })
      .resize(4500, 5400, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ compressionLevel: 9 })
      .toFile(output);

    const updated = this.projects.update(projectId, {
      status: 'export-ready',
      finalPngPath: output,
      export: {
        width: 4500,
        height: 5400,
        transparent: true,
        sourceVector: project.vectorPath
      }
    });

    return { ok: true, path: output, project: updated };
  }
}

module.exports = { ExportController };
