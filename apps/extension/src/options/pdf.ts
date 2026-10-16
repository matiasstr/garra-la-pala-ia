import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import { normalizeWhitespace } from '@garra/core';

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');

/** Texto de un PDF, página por página. No hace OCR: un PDF escaneado devuelve vacío. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  // pdf.js se queda con el buffer: le pasamos una copia.
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(text);
    }
    return normalizeWhitespace(pages.join('\n\n'));
  } finally {
    await task.destroy();
  }
}
