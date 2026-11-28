import { and, eq, gte, lt } from 'drizzle-orm';
import type { MarcaNueva } from '../domain/odontograma/estado';
import { fechaHoraArgentina, rangoDelDia, sumarDias } from '../lib/fechas';
import { firmarRegistro, obtenerOCrearHistoriaClinica, type NuevoRegistro } from '../server/hc/historia-clinica';
import { hashearPin } from '../server/hc/pin';
import { marcasOdontograma, profesionales, turnos, usuarios } from './schema';
import type { BaseDeDatos } from './tipos';

/** PIN de firma de las profesionales de prueba. Solo para desarrollo y demos. */
export const PIN_DE_PRUEBA = '1234';

/**
 * Historias clínicas de ejemplo (todo inventado): odontograma inicial,
 * evoluciones firmadas, una enmienda y cambios del odontograma, para que la
 * pantalla de la historia clínica se pueda mostrar con contenido.
 */
export async function sembrarHistoriasClinicas(
  db: BaseDeDatos,
  hoy: string,
  profesionalesDePrueba: { mica: string; laura: string },
  pacientesDePrueba: { juanPerez: string; ana: string; martina: string; diego: string },
): Promise<void> {
  for (const id of [profesionalesDePrueba.mica, profesionalesDePrueba.laura]) {
    await db.update(profesionales).set({ pinFirmaHash: await hashearPin(PIN_DE_PRUEBA), pinFirmaActualizadoEn: new Date() }).where(eq(profesionales.usuarioId, id));
  }

  const autor = async (id: string) => {
    const [fila] = await db
      .select({ nombre: usuarios.nombre, apellido: usuarios.apellido, matricula: profesionales.matricula })
      .from(profesionales)
      .innerJoin(usuarios, eq(usuarios.id, profesionales.usuarioId))
      .where(eq(profesionales.usuarioId, id));
    if (!fila) throw new Error('Semilla: falta la profesional.');
    return { usuario: { id, roles: ['profesional'] as const, activo: true, matricula: fila.matricula }, firmante: fila };
  };
  const mica = await autor(profesionalesDePrueba.mica);
  const laura = await autor(profesionalesDePrueba.laura);

  /** Momento de firma: un día y una hora, nunca en el futuro. */
  const momento = (dias: number, hora: string) => {
    const instante = fechaHoraArgentina(sumarDias(hoy, dias), hora);
    return instante.getTime() > Date.now() ? new Date() : instante;
  };
  const turnoDelDia = async (pacienteId: string, dias: number) => {
    const { desde, hasta } = rangoDelDia(sumarDias(hoy, dias));
    const [turno] = await db.select({ id: turnos.id }).from(turnos).where(and(eq(turnos.pacienteId, pacienteId), gte(turnos.inicio, desde), lt(turnos.inicio, hasta)));
    return turno?.id ?? null;
  };
  const firmar = (quien: typeof mica, hcId: string, cuando: Date, datos: Omit<NuevoRegistro, 'historiaClinicaId' | 'contenido'> & { texto?: string; contenido?: Record<string, unknown> }) =>
    firmarRegistro(
      db,
      quien.usuario,
      { ...datos, historiaClinicaId: hcId, contenido: { ...(datos.texto ? { texto: datos.texto } : {}), ...datos.contenido, firmante: quien.firmante } },
      cuando,
    );
  const marcaDe = async (registroId: string, pieza: number) => {
    const [marca] = await db.select({ id: marcasOdontograma.id }).from(marcasOdontograma).where(and(eq(marcasOdontograma.registroId, registroId), eq(marcasOdontograma.pieza, pieza)));
    if (!marca) throw new Error(`Semilla: falta la marca de la pieza ${pieza}.`);
    return marca.id;
  };
  const preexistente = (pieza: number, hallazgo: MarcaNueva['hallazgo'], cara: MarcaNueva['cara'] = null): MarcaNueva => ({ pieza, cara, hallazgo, estado: 'preexistente' });
  const pendiente = (pieza: number, hallazgo: MarcaNueva['hallazgo'], cara: MarcaNueva['cara'] = null): MarcaNueva => ({ pieza, cara, hallazgo, estado: 'pendiente' });

  // Juan Pérez: primera consulta hace un mes; hoy viene a obturar la 36.
  {
    const hc = await obtenerOCrearHistoriaClinica(db, pacientesDePrueba.juanPerez);
    const turnoId = await turnoDelDia(pacientesDePrueba.juanPerez, -30);
    await firmar(mica, hc.id, momento(-30, '17:50'), {
      tipo: 'odontograma',
      texto: 'Odontograma inicial.',
      especialidad: 'odontologia_general',
      turnoId,
      marcas: [
        preexistente(18, 'ausente'),
        preexistente(11, 'corona'),
        preexistente(26, 'restauracion', 'O'),
        preexistente(26, 'restauracion', 'M'),
        pendiente(36, 'caries', 'O'),
        pendiente(37, 'caries', 'O'),
      ],
    });
    await firmar(mica, hc.id, momento(-30, '17:55'), {
      tipo: 'evolucion',
      especialidad: 'odontologia_general',
      turnoId,
      texto:
        'Primera consulta. Viene a control, sin dolor.\nSe observan caries oclusales en 36 y 37. Corona en 11 y restauraciones en 26 (hechas en otro consultorio).\nIndico obturación de 36 y 37. Higiene regular: se explica técnica de cepillado e hilo dental.',
    });
  }

  // Ana Rodríguez: anticoagulada; una enmienda corrige el nombre del medicamento.
  {
    const hc = await obtenerOCrearHistoriaClinica(db, pacientesDePrueba.ana);
    const inicial = await firmar(mica, hc.id, momento(-120, '10:10'), {
      tipo: 'odontograma',
      texto: 'Odontograma inicial.',
      especialidad: 'odontologia_general',
      marcas: [preexistente(16, 'endodoncia'), preexistente(16, 'corona'), preexistente(24, 'restauracion', 'O'), preexistente(24, 'restauracion', 'D'), preexistente(38, 'ausente'), pendiente(46, 'caries', 'O')],
    });
    const evolucion = await firmar(mica, hc.id, momento(-120, '10:20'), {
      tipo: 'evolucion',
      especialidad: 'odontologia_general',
      texto:
        'Primera consulta. Alergia a la penicilina. Toma acenocumarol: antes de cualquier extracción o cirugía, pedir interconsulta con su hematólogo.\nCaries oclusal en 46: se indica obturación.',
    });
    await firmar(mica, hc.id, momento(-119, '09:05'), {
      tipo: 'enmienda',
      enmiendaDe: evolucion.id,
      especialidad: 'odontologia_general',
      texto: 'Corrijo: el anticoagulante que toma es warfarina, no acenocumarol. Lo confirmó por teléfono.',
    });
    await firmar(mica, hc.id, momento(-90, '11:40'), {
      tipo: 'odontograma',
      texto: 'Obturación de la 46 oclusal con resina compuesta. Sin complicaciones.',
      especialidad: 'odontologia_general',
      marcas: [{ pieza: 46, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', reemplazaA: await marcaDe(inicial.id, 46) }],
    });
    await firmar(mica, hc.id, momento(0, '09:50'), {
      tipo: 'evolucion',
      especialidad: 'odontologia_general',
      turnoId: await turnoDelDia(pacientesDePrueba.ana, 0),
      texto: 'Control y limpieza. Tartrectomía supragingival con ultrasonido, sin sangrado. Restauración de la 46 en buen estado.\nPróximo control en 6 meses.',
    });
  }

  // Martina López (10 años): dentición mixta, selladores indicados.
  {
    const hc = await obtenerOCrearHistoriaClinica(db, pacientesDePrueba.martina);
    await firmar(mica, hc.id, momento(-60, '16:45'), {
      tipo: 'odontograma',
      texto: 'Odontograma inicial (dentición mixta).',
      especialidad: 'odontopediatria',
      marcas: [pendiente(36, 'sellador', 'O'), pendiente(46, 'sellador', 'O'), pendiente(75, 'caries', 'O'), preexistente(84, 'restauracion', 'O'), preexistente(55, 'ausente')],
    });
    await firmar(mica, hc.id, momento(-60, '16:55'), {
      tipo: 'evolucion',
      especialidad: 'odontopediatria',
      texto:
        'Control de odontopediatría. Viene con la mamá. Primeros molares permanentes erupcionados por completo: se indican selladores en 36 y 46.\nCaries oclusal en 75, a tratar en el próximo turno. Se refuerza higiene con la mamá.',
    });
  }

  // Diego Sosa: endodoncia de la 46 con Laura, primera sesión hace una semana.
  {
    const hc = await obtenerOCrearHistoriaClinica(db, pacientesDePrueba.diego);
    await firmar(laura, hc.id, momento(-7, '10:40'), {
      tipo: 'odontograma',
      especialidad: 'endodoncia',
      marcas: [pendiente(46, 'endodoncia'), pendiente(46, 'corona')],
    });
    await firmar(laura, hc.id, momento(-7, '10:55'), {
      tipo: 'evolucion',
      especialidad: 'endodoncia',
      texto:
        'Endodoncia de la 46, primera sesión. Pulpitis irreversible. Anestesia troncular, aislamiento absoluto, apertura y conductometría (3 conductos). Medicación con hidróxido de calcio y obturación provisoria.\nSegunda sesión en una semana. Después, corona.',
    });
  }
}
