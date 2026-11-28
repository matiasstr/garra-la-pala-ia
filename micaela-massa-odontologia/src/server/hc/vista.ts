import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { alertasMedicas, marcasOdontograma, pacientes, profesionalEspecialidades, profesionales, turnos, usuarios } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import type { ResultadoVerificacion } from '../../domain/firma/encadenamiento';
import { armarLineaDeTiempo, leerContenido, type ContenidoLegible, type Firmante } from '../../domain/historia-clinica/registros';
import { denticionSugerida } from '../../domain/odontograma/cambios';
import type { MarcaOdontograma } from '../../domain/odontograma/estado';
import type { VistaDenticion } from '../../domain/odontograma/piezas';
import { edad } from '../../domain/pacientes/identificacion';
import { puede, puedeFirmarRegistroClinico, type UsuarioConRoles } from '../../domain/permisos/permisos';
import type { Especialidad } from '../../domain/permisos/roles';
import { esFechaValida, fechaDe, hoyEnArgentina } from '../../lib/fechas';
import { ErrorDePermiso } from '../errores';
import { listarAdjuntosClinicos, type AdjuntoClinico } from './adjuntos';
import { UUID } from './comun';
import { borradorDeEvolucion, type Borrador } from './evoluciones';
import { abrirHistoriaClinica, obtenerOCrearHistoriaClinica, verificarHistoriaClinica, type ContextoAuditoria, type TipoRegistro } from './historia-clinica';
import { estadoPinDeFirma, type EstadoPinDeFirma } from './pin';

export interface RegistroParaMostrar {
  id: string;
  secuencia: number;
  tipo: TipoRegistro;
  firmadoEn: Date;
  autorId: string;
  /** Firmante tal como quedó en el registro firmado (o, en registros viejos, el actual). */
  firmante: Firmante;
  especialidad: Especialidad | null;
  contenido: ContenidoLegible;
  hash: string;
  enmiendaDe: string | null;
  turnoId: string | null;
  /** Lo firmó quien está mirando: puede enmendarlo. */
  propio: boolean;
  /** Para un registro de adjunto: si el adjunto guardado tiene la misma huella que cita el registro. */
  adjuntoCoincide: boolean | null;
}

export interface VistaHistoriaClinica {
  paciente: { id: string; nombre: string; apellido: string; documento: string; fechaNacimiento: string; edad: number; fotoKey: string | null };
  historia: { id: string; numero: number };
  alertas: string[];
  homonimos: { id: string; nombre: string; apellido: string; documento: string; fechaNacimiento: string }[];
  integridad: ResultadoVerificacion;
  cantidadRegistros: number;
  lineaDeTiempo: { registro: RegistroParaMostrar; enmiendas: RegistroParaMostrar[]; corrige: RegistroParaMostrar | null }[];
  /** Todas las marcas firmadas (también las reemplazadas): con ellas se calcula el odontograma a cualquier fecha. */
  marcas: MarcaOdontograma[];
  denticion: VistaDenticion;
  /** Días en que se firmaron cambios del odontograma, del más nuevo al más viejo. */
  fechasConCambios: string[];
  adjuntos: AdjuntoClinico[];
  borrador: Borrador | null;
  firma: EstadoPinDeFirma & { especialidades: Especialidad[] };
  /** Turno desde el que se abrió (si es de este paciente). */
  turno: { id: string; inicio: Date; motivo: string | null } | null;
}

/**
 * Todo lo que muestra la pantalla de la historia clínica. Solo profesionales,
 * y cada apertura queda en la auditoría.
 */
export async function verHistoriaClinica(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  pacienteId: string,
  opciones: { fecha?: string | null; turnoId?: string | null } = {},
  contexto: ContextoAuditoria = {},
): Promise<VistaHistoriaClinica | null> {
  if (!puede(usuario, 'hc.ver')) throw new ErrorDePermiso('No tenés acceso a la historia clínica.');
  if (!UUID.test(pacienteId)) return null;
  const [paciente] = await db.select().from(pacientes).where(eq(pacientes.id, pacienteId));
  if (!paciente) return null;

  const historia = await obtenerOCrearHistoriaClinica(db, pacienteId);
  const fecha = opciones.fecha && esFechaValida(opciones.fecha) ? opciones.fecha : null;
  const registros = await abrirHistoriaClinica(db, usuario, historia.id, { ...contexto, detalle: fecha ? { odontogramaAFecha: fecha } : undefined });

  const autorIds = [...new Set(registros.map((r) => r.autorId))];
  const turnoId = opciones.turnoId && UUID.test(opciones.turnoId) ? opciones.turnoId : null;
  const [integridad, marcas, autores, adjuntos, alertas, homonimos, borrador, pin, especialidades, [turno]] = await Promise.all([
    verificarHistoriaClinica(db, historia.id),
    db.select().from(marcasOdontograma).where(eq(marcasOdontograma.historiaClinicaId, historia.id)).orderBy(asc(marcasOdontograma.registradaEn)),
    autorIds.length
      ? db
          .select({ id: usuarios.id, nombre: usuarios.nombre, apellido: usuarios.apellido, matricula: profesionales.matricula })
          .from(usuarios)
          .innerJoin(profesionales, eq(profesionales.usuarioId, usuarios.id))
          .where(inArray(usuarios.id, autorIds))
      : Promise.resolve([]),
    listarAdjuntosClinicos(db, usuario, historia.id),
    db
      .select({ descripcion: alertasMedicas.descripcion })
      .from(alertasMedicas)
      .where(and(eq(alertasMedicas.pacienteId, pacienteId), eq(alertasMedicas.activa, true)))
      .orderBy(asc(alertasMedicas.creadoEn)),
    db
      .select({ id: pacientes.id, nombre: pacientes.nombre, apellido: pacientes.apellido, documento: pacientes.numeroDocumento, fechaNacimiento: pacientes.fechaNacimiento })
      .from(pacientes)
      .where(and(eq(pacientes.nombreNormalizado, paciente.nombreNormalizado ?? ''), ne(pacientes.id, pacienteId))),
    borradorDeEvolucion(db, usuario, historia.id),
    estadoPinDeFirma(db, usuario),
    puedeFirmarRegistroClinico(usuario)
      ? db.select({ e: profesionalEspecialidades.especialidad }).from(profesionalEspecialidades).where(eq(profesionalEspecialidades.usuarioId, usuario.id))
      : Promise.resolve([]),
    turnoId
      ? db.select({ id: turnos.id, inicio: turnos.inicio, motivo: turnos.motivo }).from(turnos).where(and(eq(turnos.id, turnoId), eq(turnos.pacienteId, pacienteId)))
      : Promise.resolve([]),
  ]);

  const autorPorId = new Map(autores.map((a) => [a.id, a]));
  const adjuntoPorId = new Map(adjuntos.map((a) => [a.id, a]));
  const mostrar = (r: (typeof registros)[number]): RegistroParaMostrar => {
    const contenido = leerContenido(r.contenido);
    const actual = autorPorId.get(r.autorId);
    return {
      id: r.id,
      secuencia: r.secuencia,
      tipo: r.tipo,
      firmadoEn: r.firmadoEn,
      autorId: r.autorId,
      firmante: contenido.firmante ?? { nombre: actual?.nombre ?? '', apellido: actual?.apellido ?? '', matricula: actual?.matricula ?? '' },
      especialidad: r.especialidad,
      contenido,
      hash: r.hash,
      enmiendaDe: r.enmiendaDe,
      turnoId: r.turnoId,
      propio: r.autorId === usuario.id,
      adjuntoCoincide: contenido.adjunto ? adjuntoPorId.get(contenido.adjunto.id)?.sha256 === contenido.adjunto.sha256 : null,
    };
  };

  const vistos = registros.map(mostrar);
  const marcasDominio: MarcaOdontograma[] = marcas.map((m) => ({
    id: m.id,
    pieza: m.pieza,
    cara: m.cara ?? null,
    hallazgo: m.hallazgo,
    estado: m.estado,
    registradaEn: m.registradaEn,
    reemplazaA: m.reemplazaA,
    anulacion: m.anulacion,
    prestacionCodigo: m.prestacionCodigo,
  }));
  const anios = edad(paciente.fechaNacimiento, hoyEnArgentina());

  return {
    paciente: {
      id: paciente.id,
      nombre: paciente.nombre,
      apellido: paciente.apellido,
      documento: `${paciente.tipoDocumento} ${paciente.numeroDocumento}`,
      fechaNacimiento: paciente.fechaNacimiento,
      edad: anios,
      fotoKey: paciente.fotoKey,
    },
    historia,
    alertas: alertas.map((a) => a.descripcion),
    homonimos,
    integridad,
    cantidadRegistros: registros.length,
    lineaDeTiempo: armarLineaDeTiempo(vistos),
    marcas: marcasDominio,
    denticion: denticionSugerida(anios, marcasDominio.map((m) => m.pieza)),
    fechasConCambios: [...new Set(registros.filter((r) => leerContenido(r.contenido).marcas.length > 0).map((r) => fechaDe(r.firmadoEn)))].toSorted().toReversed(),
    adjuntos,
    borrador,
    firma: { ...pin, especialidades: especialidades.map((e) => e.e) },
    turno: turno ?? null,
  };
}
