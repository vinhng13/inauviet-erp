import { dirname, join } from 'node:path';
import pdfmake = require('pdfmake');
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

/** Roboto ships with pdfmake and covers every Vietnamese letter. */
const FONT_DIR = join(dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto');

let ready = false;
function setup(): void {
  if (ready) return;
  pdfmake.setFonts({
    Roboto: {
      normal: join(FONT_DIR, 'Roboto-Regular.ttf'),
      bold: join(FONT_DIR, 'Roboto-Medium.ttf'),
      italics: join(FONT_DIR, 'Roboto-Italic.ttf'),
      bolditalics: join(FONT_DIR, 'Roboto-MediumItalic.ttf'),
    },
  });
  // Documents only use the bundled fonts: no other file and no URL may be read.
  pdfmake.setLocalAccessPolicy((path) => path.startsWith(FONT_DIR));
  pdfmake.setUrlAccessPolicy(() => false);
  ready = true;
}

export async function renderPdf(doc: TDocumentDefinitions): Promise<Buffer> {
  setup();
  return pdfmake.createPdf(doc).getBuffer();
}
