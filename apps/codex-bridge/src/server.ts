import type { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { MessageDecoder, encodeMessage } from './protocol';
import type { BridgeResponse } from './protocol';

export async function serve(input: Readable, output: Writable,
  handle: (request: unknown) => Promise<BridgeResponse>): Promise<void> {
  const decoder = new MessageDecoder();
  const send = async (response: BridgeResponse) => {
    if (!output.write(encodeMessage(response))) await once(output, 'drain');
  };
  try {
    for await (const chunk of input) {
      for (const value of decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
        await send(await handle(value));
      }
    }
    decoder.finish();
  } catch {
    await send({ ok: false, code: 'UNKNOWN', error: 'El mensaje del puente es inválido o está incompleto.' });
  }
}
