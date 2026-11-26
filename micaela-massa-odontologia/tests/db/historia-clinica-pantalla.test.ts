import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema';
import { sembrarDatosDePrueba } from '../../src/db/semilla';
import { almacenLocal } from '../../src/server/archivos';
import { ErrorDePermiso } from '../../src/server/errores';
import { TAMANIO_MAXIMO_ADJUNTO, leerAdjuntoClinico, subirAdjuntoClinico } from '../../src/server/hc/adjuntos';
import {
  borradorDeEvolucion,
  descartarBorradorEvolucion,
  firmarCambiosOdontograma,
  firmarEnmienda,
  firmarEvolucion,
  guardarBorradorEvolucion,
} from '../../src/server/hc/evoluciones';
import { obtenerOCrearHistoriaClinica, odontogramaDe, verificarHistoriaClinica } from '../../src/server/hc/historia-clinica';
import { comprobarPinDeFirma, estadoPinDeFirma, guardarPinDeFirma, restablecerPinDeFirma } from '../../src/server/hc/pin';
import { verHistoriaClinica } from '../../src/server/hc/vista';
import { cargarUsuario } from '../../src/server/usuarios';
import { crearBaseDePrueba, sembrarConsultorio } from './base-de-prueba';

let base: Awaited<ReturnType<typeof crearBaseDePrueba>>;
let datos: Awaited<ReturnType<typeof sembrarConsultorio>>;
let raiz: string;
let almacen: ReturnType<typeof almacenLocal>;
let otroPaciente: string;
const PIN = '2580';
const PIN_OTRA = '7391';
const contexto = { ip: '10.0.0.7', userAgent: 'Tablet del consultorio' };

beforeAll(async () => {
  base = await crearBaseDePrueba();
  datos = await sembrarConsultorio(base.db);
  raiz = await mkdtemp(path.join(tmpdir(), 'hc-adjuntos-'));
  almacen = almacenLocal(raiz);
  const [otro] = await base.db
    .insert(schema.pacientes)
    .values({ numeroDocumento: '41222333', nombre: 'Rosa', apellido: 'Díaz', fechaNacimiento: '2019-04-02', creadoPor: datos.secretaria.id })
    .returning();
  otroPaciente = otro!.id;
});

afterAll(async () => {
  await base.cliente.close();
  await rm(raiz, { recursive: true, force: true });
});

const auditadas = async (accion: string) => base.db.select().from(schema.auditoriaAccesos).where(eq(schema.auditoriaAccesos.accion, accion));
const registrosDe = async (pacienteId: string) => {
  const hc = await obtenerOCrearHistoriaClinica(base.db, pacienteId);
  return base.db.select().from(schema.registrosClinicos).where(eq(schema.registrosClinicos.historiaClinicaId, hc.id));
};

describe('PIN de firma', () => {
  it('la secretaria no tiene PIN de firma', async () => {
    expect((await estadoPinDeFirma(base.db, datos.secretaria)).firma).toBe(false);
    await expect(guardarPinDeFirma(base.db, datos.secretaria, { nuevo: PIN, repeticion: PIN })).rejects.toBeInstanceOf(ErrorDePermiso);
  });

  it('se crea guardando solo su huella, nunca el PIN', async () => {
    expect(await guardarPinDeFirma(base.db, datos.mica, { nuevo: '1234', repeticion: '1234' })).toMatchObject({ errores: [expect.stringContaining('fácil')] });
    expect(await guardarPinDeFirma(base.db, datos.mica, { nuevo: PIN, repeticion: PIN }, contexto)).toEqual({ errores: [] });
    const [fila] = await base.db.select().from(schema.profesionales).where(eq(schema.profesionales.usuarioId, datos.mica.id));
    expect(fila?.pinFirmaHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(fila?.pinFirmaHash).not.toContain(PIN);
    expect(await estadoPinDeFirma(base.db, datos.mica)).toMatchObject({ firma: true, tienePin: true, bloqueadoHasta: null });
    expect((await auditadas('firma.pin_creado')).map((a) => a.usuarioId)).toEqual([datos.mica.id]);
  });

  it('para cambiarlo pide el PIN actual', async () => {
    expect(await guardarPinDeFirma(base.db, datos.otra, { nuevo: '9999', repeticion: '9999' })).toMatchObject({ errores: [expect.any(String)] });
    expect(await guardarPinDeFirma(base.db, datos.otra, { nuevo: '4826', repeticion: '4826' })).toEqual({ errores: [] });
    expect((await guardarPinDeFirma(base.db, datos.otra, { nuevo: PIN_OTRA, repeticion: PIN_OTRA })).errores).toEqual(['Escribí tu PIN actual.']);
    expect((await guardarPinDeFirma(base.db, datos.otra, { actual: '0000', nuevo: PIN_OTRA, repeticion: PIN_OTRA })).errores[0]).toContain('El PIN actual no es correcto');
    expect(await guardarPinDeFirma(base.db, datos.otra, { actual: '4826', nuevo: PIN_OTRA, repeticion: PIN_OTRA })).toEqual({ errores: [] });
    expect(await comprobarPinDeFirma(base.db, datos.otra, PIN_OTRA)).toEqual({ ok: true });
    expect((await auditadas('firma.pin_cambiado')).map((a) => a.usuarioId)).toEqual([datos.otra.id]);
  });

  it('se bloquea 15 minutos después de 5 intentos fallidos', async () => {
    const ahora = new Date('2026-11-20T13:00:00Z');
    const minutos = (m: number) => new Date(ahora.getTime() + m * 60_000);
    for (let i = 1; i <= 4; i++) {
      const intento = await comprobarPinDeFirma(base.db, datos.otra, '1111', contexto, ahora);
      expect(intento).toMatchObject({ ok: false, errores: [expect.stringContaining(i === 4 ? 'Te queda 1 intento' : `Te quedan ${5 - i}`)] });
    }
    expect(await comprobarPinDeFirma(base.db, datos.otra, '1111', contexto, ahora)).toMatchObject({ ok: false, errores: [expect.stringContaining('bloqueado')] });
    // Bloqueado: ni el PIN correcto sirve, y no se puede firmar.
    expect(await comprobarPinDeFirma(base.db, datos.otra, PIN_OTRA, contexto, minutos(10))).toMatchObject({ ok: false, errores: [expect.stringContaining('bloqueado')] });
    expect((await estadoPinDeFirma(base.db, datos.otra, minutos(10))).bloqueadoHasta).toEqual(minutos(15));
    expect(await comprobarPinDeFirma(base.db, datos.otra, PIN_OTRA, contexto, minutos(16))).toEqual({ ok: true });
    // 4 de acá y 1 del PIN actual equivocado al querer cambiarlo: también cuenta.
    expect(await auditadas('firma.pin_incorrecto')).toHaveLength(5);
    expect(await auditadas('firma.pin_bloqueado')).toEqual([expect.objectContaining({ usuarioId: datos.otra.id, ip: contexto.ip })]);
  });

  it('solo la administración lo restablece', async () => {
    await expect(restablecerPinDeFirma(base.db, datos.otra, datos.mica.id)).rejects.toBeInstanceOf(ErrorDePermiso);
    const soloAdmin = { ...datos.mica, roles: ['administrador'] as const };
    await guardarPinDeFirma(base.db, datos.mica, { actual: PIN, nuevo: '3691', repeticion: '3691' });
    await restablecerPinDeFirma(base.db, soloAdmin, datos.mica.id);
    expect((await estadoPinDeFirma(base.db, datos.mica)).tienePin).toBe(false);
    expect(await guardarPinDeFirma(base.db, datos.mica, { nuevo: PIN, repeticion: PIN })).toEqual({ errores: [] });
  });
});

describe('evoluciones firmadas', () => {
  it('el borrador se guarda, se edita y se descarta, y solo lo ve su autora', async () => {
    const hc = await obtenerOCrearHistoriaClinica(base.db, datos.paciente.id);
    expect((await guardarBorradorEvolucion(base.db, datos.mica, datos.paciente.id, 'Control')).errores).toEqual([]);
    expect((await guardarBorradorEvolucion(base.db, datos.mica, datos.paciente.id, 'Control sin novedades')).errores).toEqual([]);
    expect((await borradorDeEvolucion(base.db, datos.mica, hc.id))?.texto).toBe('Control sin novedades');
    expect(await borradorDeEvolucion(base.db, datos.otra, hc.id)).toBeNull();
    expect(await base.db.$count(schema.borradoresClinicos)).toBe(1);
    await descartarBorradorEvolucion(base.db, datos.mica, datos.paciente.id);
    expect(await borradorDeEvolucion(base.db, datos.mica, hc.id)).toBeNull();
    await expect(guardarBorradorEvolucion(base.db, datos.secretaria, datos.paciente.id, 'x')).rejects.toBeInstanceOf(ErrorDePermiso);
  });

  it('sin el PIN correcto no se firma nada', async () => {
    const antes = await base.db.$count(schema.registrosClinicos);
    const resultado = await firmarEvolucion(base.db, datos.mica, { pacienteId: datos.paciente.id, texto: 'Control', pin: '0000' });
    expect(resultado).toMatchObject({ ok: false, errores: [expect.stringContaining('no es correcto')] });
    expect(await base.db.$count(schema.registrosClinicos)).toBe(antes);
    await expect(firmarEvolucion(base.db, datos.secretaria, { pacienteId: datos.paciente.id, texto: 'x', pin: PIN })).rejects.toBeInstanceOf(ErrorDePermiso);
  });

  it('firma con PIN, con fecha, profesional y matrícula, y borra el borrador', async () => {
    await guardarBorradorEvolucion(base.db, datos.mica, datos.paciente.id, 'Obturación 36');
    const [turno] = await base.db
      .insert(schema.turnos)
      .values({ pacienteId: datos.paciente.id, profesionalId: datos.mica.id, inicio: new Date('2026-11-20T13:00:00Z'), fin: new Date('2026-11-20T13:30:00Z'), creadoPor: datos.secretaria.id })
      .returning();
    const resultado = await firmarEvolucion(base.db, datos.mica, { pacienteId: datos.paciente.id, texto: '  Obturación 36 oclusal con resina.  ', pin: PIN, turnoId: turno!.id }, contexto);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.registro).toMatchObject({
      tipo: 'evolucion',
      autorId: datos.mica.id,
      turnoId: turno!.id,
      contenido: { texto: 'Obturación 36 oclusal con resina.', firmante: { nombre: 'Micaela', apellido: 'Massa', matricula: 'MP 0001' } },
    });
    expect(resultado.registro.firmadoEn).toBeInstanceOf(Date);
    expect(await base.db.$count(schema.borradoresClinicos)).toBe(0);
    expect(await auditadas('registro.firmar')).toEqual([expect.objectContaining({ usuarioId: datos.mica.id, ip: contexto.ip, userAgent: contexto.userAgent })]);
    await expect(base.db.update(schema.registrosClinicos).set({ contenido: { texto: 'otro' } }).where(eq(schema.registrosClinicos.id, resultado.registro.id))).rejects.toThrow();
  });

  it('no vincula la evolución a un turno de otro paciente', async () => {
    const [turno] = await base.db
      .insert(schema.turnos)
      .values({ pacienteId: otroPaciente, profesionalId: datos.mica.id, inicio: new Date('2026-11-21T13:00:00Z'), fin: new Date('2026-11-21T13:30:00Z'), creadoPor: datos.secretaria.id })
      .returning();
    expect(await firmarEvolucion(base.db, datos.mica, { pacienteId: datos.paciente.id, texto: 'x', pin: PIN, turnoId: turno!.id })).toEqual({ ok: false, errores: ['El turno no es de este paciente.'] });
    // La base también lo impide.
    const hc = await obtenerOCrearHistoriaClinica(base.db, datos.paciente.id);
    const [ultimo] = (await registrosDe(datos.paciente.id)).toSorted((a, b) => b.secuencia - a.secuencia);
    await expect(
      base.db.insert(schema.registrosClinicos).values({
        historiaClinicaId: hc.id,
        secuencia: ultimo!.secuencia + 1,
        tipo: 'evolucion',
        contenido: {},
        autorId: datos.mica.id,
        firmadoEn: new Date(),
        hashAnterior: ultimo!.hash,
        hash: 'c'.repeat(64),
        turnoId: turno!.id,
      }),
    ).rejects.toThrow();
  });

  it('solo la autora enmienda su registro, como un registro nuevo vinculado', async () => {
    const [original] = (await registrosDe(datos.paciente.id)).filter((r) => r.tipo === 'evolucion');
    await expect(firmarEnmienda(base.db, datos.otra, { pacienteId: datos.paciente.id, registroId: original!.id, texto: 'corrijo', pin: PIN_OTRA })).rejects.toBeInstanceOf(ErrorDePermiso);
    const enmienda = await firmarEnmienda(base.db, datos.mica, { pacienteId: datos.paciente.id, registroId: original!.id, texto: 'Fue la 36 distal, no oclusal.', pin: PIN });
    expect(enmienda).toMatchObject({ ok: true, registro: { tipo: 'enmienda', enmiendaDe: original!.id } });
    if (!enmienda.ok) return;
    expect(await firmarEnmienda(base.db, datos.mica, { pacienteId: datos.paciente.id, registroId: enmienda.registro.id, texto: 'x', pin: PIN })).toMatchObject({ ok: false });
    expect(await firmarEnmienda(base.db, datos.mica, { pacienteId: otroPaciente, registroId: original!.id, texto: 'x', pin: PIN })).toMatchObject({ ok: false });
    const [sigueIgual] = await base.db.select().from(schema.registrosClinicos).where(eq(schema.registrosClinicos.id, original!.id));
    expect(sigueIgual?.contenido).toEqual(original!.contenido);
  });
});

describe('odontograma que guarda', () => {
  it('firma los cambios como un registro de odontograma', async () => {
    const resultado = await firmarCambiosOdontograma(
      base.db,
      datos.mica,
      {
        pacienteId: datos.paciente.id,
        pin: PIN,
        nota: 'Odontograma inicial',
        marcas: [
          { pieza: 36, cara: 'D', hallazgo: 'caries', estado: 'pendiente' },
          { pieza: 18, cara: null, hallazgo: 'ausente', estado: 'preexistente' },
        ],
      },
      {},
      new Date('2026-11-22T13:00:00Z'),
    );
    expect(resultado).toMatchObject({ ok: true, registro: { tipo: 'odontograma', contenido: { texto: 'Odontograma inicial' } } });
    const hc = await obtenerOCrearHistoriaClinica(base.db, datos.paciente.id);
    const hoy = await odontogramaDe(base.db, hc.id);
    expect(hoy.get(36)?.caras.D?.map((m) => m.hallazgo)).toEqual(['caries']);
    expect(hoy.get(18)?.completa.map((m) => m.hallazgo)).toEqual(['ausente']);
  });

  it('reemplaza y anula marcas firmadas sin borrar nada', async () => {
    const hc = await obtenerOCrearHistoriaClinica(base.db, datos.paciente.id);
    const marcas = await base.db.select().from(schema.marcasOdontograma).where(eq(schema.marcasOdontograma.historiaClinicaId, hc.id));
    const caries = marcas.find((m) => m.pieza === 36)!;
    const ausente = marcas.find((m) => m.pieza === 18)!;
    const resultado = await firmarCambiosOdontograma(
      base.db,
      datos.mica,
      {
        pacienteId: datos.paciente.id,
        pin: PIN,
        marcas: [
          { pieza: 36, cara: 'D', hallazgo: 'restauracion', estado: 'realizado', reemplazaA: caries.id },
          { pieza: 18, cara: null, hallazgo: 'ausente', estado: 'preexistente', reemplazaA: ausente.id, anulacion: true },
        ],
      },
      {},
      new Date('2026-11-24T13:00:00Z'),
    );
    expect(resultado.ok).toBe(true);
    const hoy = await odontogramaDe(base.db, hc.id);
    expect(hoy.get(36)?.caras.D?.map((m) => m.hallazgo)).toEqual(['restauracion']);
    expect(hoy.has(18)).toBe(false);
    const antes = await odontogramaDe(base.db, hc.id, new Date('2026-11-23T03:00:00Z'));
    expect(antes.get(36)?.caras.D?.map((m) => m.hallazgo)).toEqual(['caries']);
    expect(await base.db.$count(schema.marcasOdontograma, eq(schema.marcasOdontograma.historiaClinicaId, hc.id))).toBe(4);
  });

  it('rechaza cambios inválidos sin firmar nada', async () => {
    const antes = await base.db.$count(schema.registrosClinicos);
    expect(
      await firmarCambiosOdontograma(base.db, datos.mica, { pacienteId: datos.paciente.id, pin: PIN, marcas: [{ pieza: 19, cara: null, hallazgo: 'corona', estado: 'pendiente' }] }),
    ).toMatchObject({ ok: false, errores: [expect.stringContaining('19')] });
    expect(await firmarCambiosOdontograma(base.db, datos.mica, { pacienteId: datos.paciente.id, pin: PIN, marcas: [{ pieza: 36, cara: 'X', hallazgo: 'caries' }] })).toMatchObject({ ok: false });
    expect(await firmarCambiosOdontograma(base.db, datos.mica, { pacienteId: datos.paciente.id, pin: PIN, marcas: [] })).toEqual({ ok: false, errores: ['No hay cambios para firmar.'] });
    expect(await base.db.$count(schema.registrosClinicos)).toBe(antes);
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('adjuntos clínicos', () => {
  let adjuntoPng = '';

  it('sube una radiografía asociada a una pieza, con un registro firmado que cita su huella', async () => {
    const resultado = await subirAdjuntoClinico(
      base.db,
      almacen,
      datos.mica,
      { pacienteId: datos.paciente.id, bytes: PNG, nombreOriginal: 'C:\\fotos\\rx 36.png', descripcion: 'Radiografía periapical', pieza: 36, pin: PIN, sha256Declarado: sha(PNG) },
      contexto,
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    adjuntoPng = resultado.adjuntoId;
    const [adjunto] = await base.db.select().from(schema.adjuntos).where(eq(schema.adjuntos.id, resultado.adjuntoId));
    expect(adjunto).toMatchObject({ ambito: 'clinico', pieza: 36, sha256: sha(PNG), tipoMime: 'image/png', nombreOriginal: 'rx 36.png', descripcion: 'Radiografía periapical' });
    expect(resultado.registro).toMatchObject({ tipo: 'adjunto', contenido: { adjunto: { id: resultado.adjuntoId, sha256: sha(PNG), pieza: 36 } } });
    const hc = await obtenerOCrearHistoriaClinica(base.db, datos.paciente.id);
    expect(adjunto?.storageKey).toBe(`hc-${hc.id}/${sha(PNG)}.png`);
    expect(await verificarHistoriaClinica(base.db, hc.id)).toEqual({ valida: true });
  });

  it('sube un PDF y rechaza lo que no es imagen ni PDF', async () => {
    const pdf = await subirAdjuntoClinico(base.db, almacen, datos.mica, { pacienteId: datos.paciente.id, bytes: PDF, nombreOriginal: 'informe.pdf', descripcion: 'Informe tomografía', pin: PIN });
    expect(pdf.ok).toBe(true);
    const base_ = { pacienteId: datos.paciente.id, nombreOriginal: 'x.pdf', descripcion: 'x', pin: PIN };
    const disfrazado = await subirAdjuntoClinico(base.db, almacen, datos.mica, { ...base_, bytes: new TextEncoder().encode('<script>alert(1)</script>') });
    expect(disfrazado).toMatchObject({ ok: false, errores: [expect.stringContaining('ni un PDF')] });
    const grande = new Uint8Array(TAMANIO_MAXIMO_ADJUNTO + 1);
    grande.set(PDF);
    expect(await subirAdjuntoClinico(base.db, almacen, datos.mica, { ...base_, bytes: grande })).toMatchObject({ ok: false, errores: [expect.stringContaining('10 MB')] });
    expect(await subirAdjuntoClinico(base.db, almacen, datos.mica, { ...base_, bytes: PNG, descripcion: ' ' })).toMatchObject({ ok: false });
    expect(await subirAdjuntoClinico(base.db, almacen, datos.mica, { ...base_, bytes: PNG, pieza: 19 })).toMatchObject({ ok: false });
    expect(await subirAdjuntoClinico(base.db, almacen, datos.mica, { ...base_, bytes: PDF.slice(0, 10), sha256Declarado: sha(PDF) })).toEqual({
      ok: false,
      errores: ['El archivo no llegó completo. Probá de nuevo.'],
    });
    expect(await subirAdjuntoClinico(base.db, almacen, datos.mica, { ...base_, bytes: PNG })).toMatchObject({ ok: false, errores: [expect.stringContaining('ya está')] });
    await expect(subirAdjuntoClinico(base.db, almacen, datos.secretaria, { ...base_, bytes: PNG })).rejects.toBeInstanceOf(ErrorDePermiso);
    expect(await base.db.$count(schema.adjuntos)).toBe(2);
  });

  it('el mismo archivo en otro paciente es otro adjunto', async () => {
    expect((await subirAdjuntoClinico(base.db, almacen, datos.mica, { pacienteId: otroPaciente, bytes: PNG, nombreOriginal: 'rx.png', descripcion: 'Rx', pin: PIN })).ok).toBe(true);
  });

  it('verlo y descargarlo queda auditado, y la secretaria no puede', async () => {
    await expect(leerAdjuntoClinico(base.db, almacen, datos.secretaria, { pacienteId: datos.paciente.id, adjuntoId: adjuntoPng, modo: 'ver' })).rejects.toBeInstanceOf(ErrorDePermiso);
    const visto = await leerAdjuntoClinico(base.db, almacen, datos.otra, { pacienteId: datos.paciente.id, adjuntoId: adjuntoPng, modo: 'ver' }, contexto);
    expect(visto).toMatchObject({ estado: 'ok', tipo: 'image/png', nombre: 'rx 36.png' });
    await leerAdjuntoClinico(base.db, almacen, datos.otra, { pacienteId: datos.paciente.id, adjuntoId: adjuntoPng, modo: 'descargar' });
    expect(await auditadas('adjunto.ver')).toEqual([expect.objectContaining({ usuarioId: datos.otra.id, entidadId: adjuntoPng, pacienteId: datos.paciente.id, ip: contexto.ip })]);
    expect(await auditadas('adjunto.descargar')).toHaveLength(1);
    // Con el id de otro paciente no se encuentra.
    expect(await leerAdjuntoClinico(base.db, almacen, datos.otra, { pacienteId: otroPaciente, adjuntoId: adjuntoPng, modo: 'ver' })).toEqual({ estado: 'no_existe' });
  });

  it('detecta un archivo alterado en el almacenamiento', async () => {
    const [adjunto] = await base.db.select().from(schema.adjuntos).where(eq(schema.adjuntos.id, adjuntoPng));
    await writeFile(path.join(raiz, adjunto!.storageKey), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]));
    expect(await leerAdjuntoClinico(base.db, almacen, datos.mica, { pacienteId: datos.paciente.id, adjuntoId: adjuntoPng, modo: 'ver' })).toEqual({ estado: 'alterado' });
    expect(await readdir(raiz)).toHaveLength(2);
  });

  it('la base no acepta un adjunto en la historia clínica de otro paciente ni un registro que cite otra huella', async () => {
    const hcOtro = await obtenerOCrearHistoriaClinica(base.db, otroPaciente);
    await expect(
      base.db.insert(schema.adjuntos).values({
        pacienteId: datos.paciente.id,
        ambito: 'clinico',
        historiaClinicaId: hcOtro.id,
        storageKey: 'hc-x/y.png',
        sha256: 'd'.repeat(64),
        tipoMime: 'image/png',
        bytes: 1,
        nombreOriginal: 'y.png',
        subidoPor: datos.mica.id,
      }),
    ).rejects.toThrow();
    const [ultimo] = (await registrosDe(otroPaciente)).toSorted((a, b) => b.secuencia - a.secuencia);
    const [adjunto] = await base.db.select().from(schema.adjuntos).where(eq(schema.adjuntos.historiaClinicaId, hcOtro.id));
    await expect(
      base.db.insert(schema.registrosClinicos).values({
        historiaClinicaId: hcOtro.id,
        secuencia: ultimo!.secuencia + 1,
        tipo: 'adjunto',
        contenido: { adjunto: { id: adjunto!.id, sha256: 'e'.repeat(64) } },
        autorId: datos.mica.id,
        firmadoEn: new Date(),
        hashAnterior: ultimo!.hash,
        hash: 'b'.repeat(64),
      }),
    ).rejects.toThrow();
  });
});

describe('pantalla de la historia clínica', () => {
  it('la secretaria no la abre y no queda nada registrado a su nombre', async () => {
    await expect(verHistoriaClinica(base.db, datos.secretaria, datos.paciente.id)).rejects.toBeInstanceOf(ErrorDePermiso);
    expect((await auditadas('hc.ver')).filter((a) => a.usuarioId === datos.secretaria.id)).toEqual([]);
  });

  it('muestra la línea de tiempo con enmiendas, integridad y odontograma, y audita la apertura', async () => {
    const vista = await verHistoriaClinica(base.db, datos.otra, datos.paciente.id, { fecha: '2026-11-23' }, contexto);
    expect(vista).not.toBeNull();
    if (!vista) return;
    expect(vista.integridad).toEqual({ valida: true });
    expect(vista.paciente).toMatchObject({ nombre: 'Juan', apellido: 'Pérez', documento: 'DNI 30123456' });
    const secuencias = vista.lineaDeTiempo.map((e) => e.registro.secuencia);
    expect(secuencias).toEqual(secuencias.toSorted((a, b) => b - a));
    const conEnmienda = vista.lineaDeTiempo.find((e) => e.enmiendas.length > 0);
    expect(conEnmienda?.registro.tipo).toBe('evolucion');
    expect(conEnmienda?.registro.propio).toBe(false);
    expect(conEnmienda?.registro.firmante.matricula).toBe('MP 0001');
    expect(vista.lineaDeTiempo.find((e) => e.registro.tipo === 'adjunto')?.registro.adjuntoCoincide).toBe(true);
    expect(vista.fechasConCambios).toEqual(['2026-11-24', '2026-11-22']);
    expect(vista.adjuntos).toHaveLength(2);
    expect(vista.firma).toMatchObject({ firma: true, tienePin: true });
    const [apertura] = (await auditadas('hc.ver')).filter((a) => a.usuarioId === datos.otra.id);
    expect(apertura).toMatchObject({ pacienteId: datos.paciente.id, ip: contexto.ip, userAgent: contexto.userAgent, detalle: { odontogramaAFecha: '2026-11-23' } });
  });

  it('a un chico le sugiere la dentición mixta', async () => {
    const vista = await verHistoriaClinica(base.db, datos.mica, otroPaciente);
    expect(vista?.denticion).toBe('mixta');
    expect(await verHistoriaClinica(base.db, datos.mica, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('datos de prueba', () => {
  it('cargan historias clínicas válidas, con PIN 1234 para las profesionales', async () => {
    const otra = await crearBaseDePrueba();
    try {
      expect(await sembrarDatosDePrueba(otra.db, '2026-11-18')).toBe(true);
      const hcs = await otra.db.select().from(schema.historiasClinicas);
      expect(hcs.length).toBeGreaterThanOrEqual(3);
      for (const hc of hcs) expect(await verificarHistoriaClinica(otra.db, hc.id)).toEqual({ valida: true });

      const usuarios = await otra.db.select().from(schema.usuarios);
      const mica = (await cargarUsuario(otra.db, usuarios.find((u) => u.nombre === 'Micaela')!.id))!;
      const laura = (await cargarUsuario(otra.db, usuarios.find((u) => u.nombre === 'Laura')!.id))!;
      expect(await comprobarPinDeFirma(otra.db, mica, '1234')).toEqual({ ok: true });
      expect(await comprobarPinDeFirma(otra.db, laura, '1234')).toEqual({ ok: true });

      const [ana] = await otra.db.select().from(schema.pacientes).where(eq(schema.pacientes.apellido, 'Rodríguez'));
      const vistaAna = await verHistoriaClinica(otra.db, laura, ana!.id);
      expect(vistaAna?.lineaDeTiempo.some((e) => e.enmiendas.length === 1)).toBe(true);
      expect(vistaAna?.alertas).toContain('Alergia a la penicilina');

      const [martina] = await otra.db.select().from(schema.pacientes).where(and(eq(schema.pacientes.apellido, 'López'), eq(schema.pacientes.nombre, 'Martina')));
      expect((await verHistoriaClinica(otra.db, mica, martina!.id))?.denticion).toBe('mixta');

      const [juan] = await otra.db.select().from(schema.pacientes).where(eq(schema.pacientes.numeroDocumento, '30123456'));
      const vistaJuan = await verHistoriaClinica(otra.db, mica, juan!.id);
      expect(vistaJuan?.homonimos).toHaveLength(1);
      expect(vistaJuan?.lineaDeTiempo.every((e) => e.registro.turnoId)).toBe(true);
    } finally {
      await otra.cliente.close();
    }
  });
});
