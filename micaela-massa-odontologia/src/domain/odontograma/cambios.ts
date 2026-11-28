import { HALLAZGOS, NOMBRE_ESTADO } from './catalogo';
import type { MarcaNueva, MarcaOdontograma } from './estado';
import { denticionDe, esPiezaValida, nombreCara, type VistaDenticion } from './piezas';

/** "36 oclusal: Caries (a realizar)". Una anulación se describe como lo que se quita. */
export function describirMarca(marca: Pick<MarcaOdontograma, 'pieza' | 'cara' | 'hallazgo' | 'estado' | 'anulacion'>): string {
  const lugar = marca.cara && esPiezaValida(marca.pieza) ? `${marca.pieza} ${nombreCara(marca.pieza, marca.cara).toLowerCase()}` : `${marca.pieza}`;
  const que = `${HALLAZGOS[marca.hallazgo]?.nombre ?? marca.hallazgo} (${NOMBRE_ESTADO[marca.estado]?.toLowerCase() ?? marca.estado})`;
  return marca.anulacion ? `${lugar}: se quita ${que} (estaba cargado por error)` : `${lugar}: ${que}`;
}

/**
 * Cambios marcados en la pantalla, listos para firmar.
 *
 * Mientras el profesional marca, una marca nueva puede reemplazar a otra que
 * también es un borrador (por ejemplo, tocó "caries" y después
 * "restauración" en la misma cara). Al firmar solo importa el resultado: la
 * marca intermedia se descarta y la final reemplaza directamente a la marca
 * firmada que había antes. Una anulación de algo que nunca se firmó no se
 * envía.
 */
export function consolidarCambios(cambios: readonly MarcaOdontograma[]): MarcaNueva[] {
  const porId = new Map(cambios.map((c) => [c.id, c]));
  const reemplazadas = new Set(cambios.flatMap((c) => (c.reemplazaA && porId.has(c.reemplazaA) ? [c.reemplazaA] : [])));

  /** La marca firmada (fuera de los borradores) a la que reemplaza la cadena, si hay. */
  const origen = (cambio: MarcaOdontograma): string | null => {
    let actual = cambio;
    const vistas = new Set<string>();
    while (actual.reemplazaA && porId.has(actual.reemplazaA) && !vistas.has(actual.id)) {
      vistas.add(actual.id);
      actual = porId.get(actual.reemplazaA)!;
    }
    return actual.reemplazaA && !porId.has(actual.reemplazaA) ? actual.reemplazaA : null;
  };

  return cambios
    .filter((c) => !reemplazadas.has(c.id))
    .map((c) => ({
      pieza: c.pieza,
      cara: c.cara,
      hallazgo: c.hallazgo,
      estado: c.estado,
      reemplazaA: origen(c),
      anulacion: c.anulacion ?? false,
      prestacionCodigo: c.prestacionCodigo ?? null,
    }))
    .filter((c) => !c.anulacion || c.reemplazaA);
}

/**
 * Dentición que conviene mostrar según la edad: temporal hasta los 5 años,
 * mixta de 6 a 12 y permanente desde los 13. Si hay marcas en piezas de la
 * otra dentición (por ejemplo, un temporal retenido en un adulto), se muestra
 * la mixta para que ninguna marca quede fuera del dibujo.
 */
export function denticionSugerida(edad: number, piezasConMarcas: Iterable<number> = []): VistaDenticion {
  const base: VistaDenticion = edad < 6 ? 'temporal' : edad <= 12 ? 'mixta' : 'permanente';
  if (base === 'mixta') return base;
  for (const pieza of piezasConMarcas) {
    if (esPiezaValida(pieza) && denticionDe(pieza) !== base) return 'mixta';
  }
  return base;
}
