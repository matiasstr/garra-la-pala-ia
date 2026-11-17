import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema';
import { HASH_GENESIS } from '../../src/domain/firma/encadenamiento';
import {
  ErrorDePermiso,
  ErrorDeValidacion,
  abrirHistoriaClinica,
  firmarRegistro,
  obtenerOCrearHistoriaClinica,
  odontogramaDe,
  verificarHistoriaClinica,
} from '../../src/server/hc/historia-clinica';
import { crearBaseDePrueba, sembrarConsultorio } from './base-de-prueba';

let base: Awaited<ReturnType<typeof crearBaseDePrueba>>;
let datos: Awaited<ReturnType<typeof sembrarConsultorio>>;
let hcId: string;

beforeAll(async () => {
  base = await crearBaseDePrueba();
  datos = await sembrarConsultorio(base.db);
  hcId = (await obtenerOCrearHistoriaClinica(base.db, datos.paciente.id)).id;
});

afterAll(async () => {
  await base.cliente.close();
});

const dia = (d: number) => new Date(Date.UTC(2026, 10, d, 13));

describe('historia clínica', () => {
  it('hay una sola historia clínica por paciente', async () => {
    const otraVez = await obtenerOCrearHistoriaClinica(base.db, datos.paciente.id);
    expect(otraVez.id).toBe(hcId);
    await expect(base.db.insert(schema.historiasClinicas).values({ pacienteId: datos.paciente.id })).rejects.toThrow();
  });

  it('la secretaria no puede abrir ni firmar la historia clínica', async () => {
    await expect(abrirHistoriaClinica(base.db, datos.secretaria, hcId)).rejects.toBeInstanceOf(ErrorDePermiso);
    await expect(firmarRegistro(base.db, datos.secretaria, { historiaClinicaId: hcId, tipo: 'evolucion', contenido: { texto: 'x' } })).rejects.toBeInstanceOf(
      ErrorDePermiso,
    );
  });

  it('una profesional firma registros encadenados con su odontograma', async () => {
    const primero = await firmarRegistro(
      base.db,
      datos.mica,
      {
        historiaClinicaId: hcId,
        tipo: 'odontograma',
        contenido: { texto: 'Odontograma inicial' },
        marcas: [
          { pieza: 36, cara: 'O', hallazgo: 'caries', estado: 'pendiente' },
          { pieza: 11, cara: null, hallazgo: 'corona', estado: 'preexistente' },
        ],
      },
      dia(1),
    );
    expect(primero.secuencia).toBe(1);
    expect(primero.hashAnterior).toBe(HASH_GENESIS);

    const marcaCaries = (await base.db.select().from(schema.marcasOdontograma).where(eq(schema.marcasOdontograma.pieza, 36)))[0];
    const segundo = await firmarRegistro(
      base.db,
      datos.otra,
      {
        historiaClinicaId: hcId,
        tipo: 'evolucion',
        contenido: { texto: 'Obturación de la 36 oclusal con resina.' },
        especialidad: 'odontologia_general',
        marcas: [{ pieza: 36, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', reemplazaA: marcaCaries?.id }],
      },
      dia(10),
    );
    expect(segundo.secuencia).toBe(2);
    expect(segundo.hashAnterior).toBe(primero.hash);

    expect(await verificarHistoriaClinica(base.db, hcId)).toEqual({ valida: true });

    const hoy = await odontogramaDe(base.db, hcId);
    expect(hoy.get(36)?.caras.O?.map((m) => m.hallazgo)).toEqual(['restauracion']);
    const antes = await odontogramaDe(base.db, hcId, dia(5));
    expect(antes.get(36)?.caras.O?.map((m) => m.hallazgo)).toEqual(['caries']);
  });

  it('rechaza marcas inválidas sin guardar nada', async () => {
    const antes = await base.db.$count(schema.registrosClinicos);
    await expect(
      firmarRegistro(base.db, datos.mica, {
        historiaClinicaId: hcId,
        tipo: 'odontograma',
        contenido: {},
        marcas: [{ pieza: 19, cara: null, hallazgo: 'corona', estado: 'pendiente' }],
      }),
    ).rejects.toBeInstanceOf(ErrorDeValidacion);
    expect(await base.db.$count(schema.registrosClinicos)).toBe(antes);
  });

  it('solo el autor enmienda su registro', async () => {
    const [primero] = await base.db.select().from(schema.registrosClinicos).where(eq(schema.registrosClinicos.secuencia, 1));
    if (!primero) throw new Error('falta el registro 1');
    await expect(
      firmarRegistro(base.db, datos.otra, { historiaClinicaId: hcId, tipo: 'enmienda', enmiendaDe: primero.id, contenido: { texto: 'corrijo' } }),
    ).rejects.toBeInstanceOf(ErrorDePermiso);
    const enmienda = await firmarRegistro(base.db, datos.mica, {
      historiaClinicaId: hcId,
      tipo: 'enmienda',
      enmiendaDe: primero.id,
      contenido: { texto: 'La corona de la 11 es de porcelana.' },
    });
    expect(enmienda.enmiendaDe).toBe(primero.id);
    expect(await verificarHistoriaClinica(base.db, hcId)).toEqual({ valida: true });
  });

  it('cada apertura de la historia clínica queda auditada', async () => {
    const registros = await abrirHistoriaClinica(base.db, datos.otra, hcId);
    expect(registros.map((r) => r.secuencia)).toEqual([1, 2, 3]);
    const aperturas = await base.db.select().from(schema.auditoriaAccesos).where(eq(schema.auditoriaAccesos.accion, 'hc.ver'));
    expect(aperturas).toEqual([expect.objectContaining({ usuarioId: datos.otra.id, pacienteId: datos.paciente.id })]);
  });
});

describe('inalterabilidad en la base de datos', () => {
  it('impide modificar un registro firmado', async () => {
    await expect(base.db.update(schema.registrosClinicos).set({ contenido: { texto: 'alterado' } })).rejects.toThrow();
  });

  it('impide borrar registros, marcas, auditoría o pacientes', async () => {
    await expect(base.db.delete(schema.registrosClinicos)).rejects.toThrow();
    await expect(base.db.delete(schema.marcasOdontograma)).rejects.toThrow();
    await expect(base.db.delete(schema.auditoriaAccesos)).rejects.toThrow();
    await expect(base.db.delete(schema.pacientes)).rejects.toThrow();
    await expect(base.db.execute(sql`truncate registros_clinicos cascade`)).rejects.toThrow();
  });

  it('impide insertar un registro fuera de secuencia o mal encadenado', async () => {
    const base_ = {
      historiaClinicaId: hcId,
      tipo: 'evolucion' as const,
      contenido: {},
      autorId: datos.mica.id,
      firmadoEn: new Date(),
      hash: 'a'.repeat(64),
    };
    await expect(base.db.insert(schema.registrosClinicos).values({ ...base_, secuencia: 9, hashAnterior: HASH_GENESIS })).rejects.toThrow();
    await expect(base.db.insert(schema.registrosClinicos).values({ ...base_, secuencia: 4, hashAnterior: 'b'.repeat(64) })).rejects.toThrow();
  });

  it('detecta una alteración aunque alguien desactive los triggers', async () => {
    await base.cliente.exec(`
      alter table registros_clinicos disable trigger registros_clinicos_inalterables;
      update registros_clinicos set contenido = '{"texto":"alterado"}' where secuencia = 2;
      alter table registros_clinicos enable trigger registros_clinicos_inalterables;
    `);
    expect(await verificarHistoriaClinica(base.db, hcId)).toMatchObject({ valida: false, secuencia: 2 });
  });

  it('rechaza piezas que no existen en notación FDI', async () => {
    const [registro] = await base.db.select().from(schema.registrosClinicos).where(eq(schema.registrosClinicos.secuencia, 1));
    await expect(
      base.db.insert(schema.marcasOdontograma).values({
        registroId: registro!.id,
        historiaClinicaId: hcId,
        pieza: 19,
        cara: null,
        hallazgo: 'corona',
        estado: 'pendiente',
        registradaEn: new Date(),
      }),
    ).rejects.toThrow();
  });
});
