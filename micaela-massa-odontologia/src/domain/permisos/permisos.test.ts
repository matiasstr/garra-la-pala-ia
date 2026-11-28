import { describe, expect, it } from 'vitest';
import { PERMISOS, permisosDe, puede, puedeEnmendar, puedeFirmarRegistroClinico, zonaDe, type UsuarioConRoles } from './permisos';

const secretaria: UsuarioConRoles = { id: 's1', roles: ['secretaria'], activo: true };
const odontologa: UsuarioConRoles = { id: 'p1', roles: ['profesional'], activo: true, matricula: 'MP 1234' };
const admin: UsuarioConRoles = { id: 'a1', roles: ['administrador'], activo: true };
const duena: UsuarioConRoles = { id: 'm1', roles: ['administrador', 'profesional'], activo: true, matricula: 'MP 999' };

describe('permisos por rol', () => {
  it('la secretaria gestiona agenda y ficha pero no ve la historia clínica', () => {
    expect(puede(secretaria, 'turnos.gestionar')).toBe(true);
    expect(puede(secretaria, 'paciente.editar_ficha')).toBe(true);
    expect(puede(secretaria, 'paciente.ver_alertas_medicas')).toBe(true);
    expect(puede(secretaria, 'hc.ver')).toBe(false);
    expect(puede(secretaria, 'hc.registrar')).toBe(false);
    expect(puede(secretaria, 'adjuntos_clinicos.subir')).toBe(false);
  });

  it('ningún permiso de la secretaria pertenece a la zona clínica', () => {
    const zonas = [...permisosDe(secretaria)].map(zonaDe);
    expect(zonas).not.toContain('historia_clinica');
  });

  it('el administrador que no es profesional no ve la historia clínica', () => {
    expect(puede(admin, 'usuarios.administrar')).toBe(true);
    expect(puede(admin, 'auditoria.ver')).toBe(true);
    expect(puede(admin, 'hc.ver')).toBe(false);
  });

  it('los roles se combinan: administradora y odontóloga a la vez', () => {
    expect(puede(duena, 'usuarios.administrar')).toBe(true);
    expect(puede(duena, 'hc.registrar')).toBe(true);
  });

  it('un usuario inactivo no tiene ningún permiso', () => {
    const baja = { ...odontologa, activo: false };
    for (const permiso of PERMISOS) expect(puede(baja, permiso)).toBe(false);
  });
});

describe('firma y enmiendas', () => {
  it('firma solo un profesional con matrícula', () => {
    expect(puedeFirmarRegistroClinico(odontologa)).toBe(true);
    expect(puedeFirmarRegistroClinico({ ...odontologa, matricula: '  ' })).toBe(false);
    expect(puedeFirmarRegistroClinico(secretaria)).toBe(false);
  });

  it('solo el autor puede enmendar su registro', () => {
    expect(puedeEnmendar(odontologa, { autorId: 'p1' })).toBe(true);
    expect(puedeEnmendar(duena, { autorId: 'p1' })).toBe(false);
  });
});
