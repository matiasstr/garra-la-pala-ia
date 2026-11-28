import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLAVE_DE_PRUEBA, SECRETO_TOTP_DE_PRUEBA } from '../../src/db/acceso-de-prueba';
import * as schema from '../../src/db/schema';
import { sembrarDatosDePrueba } from '../../src/db/semilla';
import { codigoTotp, desdeBase32 } from '../../src/domain/acceso/totp';
import { ErrorDePermiso } from '../../src/server/errores';
import { comprobarPinDeFirma, reponerPinOlvidado } from '../../src/server/hc/pin';
import { cargarUsuario, type UsuarioSesion } from '../../src/server/usuarios';
import { crearBaseDePrueba } from './base-de-prueba';

/**
 * "¿Te olvidaste el PIN?": la profesional pone un PIN nuevo sin el anterior,
 * confirmando con su contraseña y un código de la app del celular.
 */
const HOY = '2026-11-18';
const PEDIDO = { ip: '10.0.0.7', userAgent: 'prueba' };
const SECRETO = desdeBase32(SECRETO_TOTP_DE_PRUEBA);

let base: Awaited<ReturnType<typeof crearBaseDePrueba>>;
let mica: UsuarioSesion;
let laura: UsuarioSesion;
let sofia: UsuarioSesion;

/** Un instante distinto por prueba: cada código de la app sirve una sola vez. */
let minuto = 0;
const otroMomento = () => new Date(Date.UTC(2026, 10, 18, 13, (minuto += 2)));

beforeAll(async () => {
  base = await crearBaseDePrueba();
  await sembrarDatosDePrueba(base.db, HOY);
  const usuarios = await base.db.select().from(schema.usuarios);
  const cargar = async (nombre: string) => (await cargarUsuario(base.db, usuarios.find((u) => u.nombre === nombre)!.id))!;
  [mica, laura, sofia] = await Promise.all([cargar('Micaela'), cargar('Laura'), cargar('Sofía')]);
});

afterAll(async () => {
  await base.cliente.close();
});

const pinDe = async (usuarioId: string) => (await base.db.select().from(schema.profesionales).where(eq(schema.profesionales.usuarioId, usuarioId)))[0]!;

describe('PIN de firma olvidado', () => {
  it('una secretaria no tiene PIN de firma', async () => {
    const ahora = otroMomento();
    await expect(
      reponerPinOlvidado(base.db, sofia, { clave: CLAVE_DE_PRUEBA, codigo: codigoTotp(SECRETO, ahora), nuevo: '4826', repeticion: '4826' }, PEDIDO, ahora),
    ).rejects.toBeInstanceOf(ErrorDePermiso);
  });

  it('un PIN nuevo débil se rechaza antes de gastar el código de la app', async () => {
    const ahora = otroMomento();
    const codigo = codigoTotp(SECRETO, ahora);
    const debil = await reponerPinOlvidado(base.db, mica, { clave: CLAVE_DE_PRUEBA, codigo, nuevo: '1111', repeticion: '1111' }, PEDIDO, ahora);
    expect(debil.errores.length).toBeGreaterThan(0);
    // El mismo código sigue sirviendo.
    const bien = await reponerPinOlvidado(base.db, mica, { clave: CLAVE_DE_PRUEBA, codigo, nuevo: '4826', repeticion: '4826' }, PEDIDO, ahora);
    expect(bien.errores).toEqual([]);
  });

  it('con la contraseña o el código equivocados no cambia nada', async () => {
    const antes = await pinDe(laura.id);
    const ahora = otroMomento();
    const malaClave = await reponerPinOlvidado(base.db, laura, { clave: 'otra-cosa-cualquiera', codigo: codigoTotp(SECRETO, ahora), nuevo: '5937', repeticion: '5937' }, PEDIDO, ahora);
    expect(malaClave.errores).toEqual(['La contraseña no es correcta.']);
    const malCodigo = await reponerPinOlvidado(base.db, laura, { clave: CLAVE_DE_PRUEBA, codigo: '000000', nuevo: '5937', repeticion: '5937' }, PEDIDO, otroMomento());
    expect(malCodigo.errores).toHaveLength(1);
    expect((await pinDe(laura.id)).pinFirmaHash).toBe(antes.pinFirmaHash);
  });

  it('con contraseña y código pone el PIN nuevo, destraba el bloqueo y queda en la auditoría', async () => {
    await base.db
      .update(schema.profesionales)
      .set({ pinFirmaIntentosFallidos: 5, pinFirmaBloqueadoHasta: new Date(Date.UTC(2030, 0, 1)) })
      .where(eq(schema.profesionales.usuarioId, laura.id));
    const ahora = otroMomento();
    const codigo = codigoTotp(SECRETO, ahora);
    const resultado = await reponerPinOlvidado(base.db, laura, { clave: CLAVE_DE_PRUEBA, codigo, nuevo: '5937', repeticion: '5937' }, PEDIDO, ahora);
    expect(resultado.errores).toEqual([]);

    const fila = await pinDe(laura.id);
    expect(fila.pinFirmaIntentosFallidos).toBe(0);
    expect(fila.pinFirmaBloqueadoHasta).toBeNull();
    expect((await comprobarPinDeFirma(base.db, laura, '5937', {}, otroMomento())).ok).toBe(true);
    expect((await comprobarPinDeFirma(base.db, laura, '1234', {}, otroMomento())).ok).toBe(false);

    const [auditoria] = await base.db
      .select()
      .from(schema.auditoriaAccesos)
      .where(and(eq(schema.auditoriaAccesos.accion, 'firma.pin_repuesto'), eq(schema.auditoriaAccesos.usuarioId, laura.id)));
    expect(auditoria).toMatchObject({ entidadId: laura.id, ip: '10.0.0.7' });

    // El mismo código de la app no sirve dos veces.
    const repetido = await reponerPinOlvidado(base.db, laura, { clave: CLAVE_DE_PRUEBA, codigo, nuevo: '6048', repeticion: '6048' }, PEDIDO, ahora);
    expect(repetido.errores).toHaveLength(1);
    expect((await comprobarPinDeFirma(base.db, laura, '5937', {}, otroMomento())).ok).toBe(true);
  });

  it('después de 5 contraseñas equivocadas se bloquea, aunque después venga la correcta', async () => {
    for (let i = 0; i < 5; i++) {
      const ahora = otroMomento();
      await reponerPinOlvidado(base.db, mica, { clave: `equivocada-${i}`, codigo: codigoTotp(SECRETO, ahora), nuevo: '7159', repeticion: '7159' }, PEDIDO, ahora);
    }
    const ahora = otroMomento();
    const bloqueado = await reponerPinOlvidado(base.db, mica, { clave: CLAVE_DE_PRUEBA, codigo: codigoTotp(SECRETO, ahora), nuevo: '7159', repeticion: '7159' }, PEDIDO, ahora);
    expect(bloqueado.errores).toHaveLength(1);
    expect(bloqueado.errores[0]).not.toBe('La contraseña no es correcta.');
    expect((await comprobarPinDeFirma(base.db, mica, '7159', {}, otroMomento())).ok).toBe(false);
  });
});
