import { describe, expect, it } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { MAX_MESSAGE_BYTES, MessageDecoder, encodeMessage, parseRequest } from '../src/protocol';
import { serve } from '../src/server';

describe('protocolo Native Messaging', () => {
  it('usa longitud UTF-8 en little-endian y acepta un byte por lectura', () => {
    const value = { type: 'complete', system: 'Español', user: '¡Hola! 👋' };
    const frame = encodeMessage(value);
    expect(frame.readUInt32LE()).toBe(Buffer.byteLength(JSON.stringify(value)));
    const decoder = new MessageDecoder();
    const messages = [...frame].flatMap(byte => decoder.push(Buffer.from([byte])));
    expect(messages).toEqual([value]);
    expect(() => decoder.finish()).not.toThrow();
  });
  it('separa varios mensajes de una lectura', () => {
    expect(new MessageDecoder().push(Buffer.concat([encodeMessage({ type: 'ping' }), encodeMessage({ type: 'ping' })])))
      .toEqual([{ type: 'ping' }, { type: 'ping' }]);
  });
  it.each([0, MAX_MESSAGE_BYTES + 1, 0xffffffff])('rechaza longitud %s antes de recibir el cuerpo', length => {
    const header = Buffer.alloc(4); header.writeUInt32LE(length);
    expect(() => new MessageDecoder().push(header)).toThrow();
  });
  it('rechaza JSON, UTF-8 inválido y mensajes truncados', () => {
    expect(() => new MessageDecoder().push(Buffer.from([1, 0, 0, 0, 123]))).toThrow();
    expect(() => new MessageDecoder().push(Buffer.from([1, 0, 0, 0, 255]))).toThrow();
    const decoder = new MessageDecoder(); decoder.push(encodeMessage({ type: 'ping' }).subarray(0, 6));
    expect(() => decoder.finish()).toThrow('incompleto');
  });
  it('limita respuestas por bytes', () => {
    expect(() => encodeMessage({ text: 'á'.repeat(MAX_MESSAGE_BYTES) })).toThrow();
  });
  it.each([null, {}, { type: 'other' }, { type: 'complete', system: '', user: '' },
    { type: 'complete', system: '', user: 'hola', timeoutMs: 0 },
    { type: 'complete', system: '', user: 'hola', timeoutMs: 300001 },
    { type: 'complete', system: '', user: 'hola', model: '--help' }])('valida la solicitud %j', value => {
    expect(() => parseRequest(value)).toThrow();
  });
  it('sirve respuestas en orden sin texto adicional en stdout', async () => {
    const output: Buffer[] = [];
    const sink = new Writable({ write(chunk: Buffer, _encoding, callback) { output.push(chunk); callback(); } });
    await serve(Readable.from([encodeMessage({ type: 'ping' }), encodeMessage({ type: 'ping' })]), sink,
      async () => ({ ok: true, version: '0.1.0', codexVersion: 'test' }));
    expect(new MessageDecoder().push(Buffer.concat(output))).toHaveLength(2);
  });
  it('responde un error de protocolo a una entrada incompleta', async () => {
    const output: Buffer[] = [];
    const sink = new Writable({ write(chunk: Buffer, _encoding, callback) { output.push(chunk); callback(); } });
    await serve(Readable.from([Buffer.from([12, 0])]), sink, async () => { throw new Error('No debe invocarse'); });
    expect(new MessageDecoder().push(Buffer.concat(output))).toEqual([
      { ok: false, code: 'UNKNOWN', error: expect.stringContaining('incompleto') },
    ]);
  });
});
