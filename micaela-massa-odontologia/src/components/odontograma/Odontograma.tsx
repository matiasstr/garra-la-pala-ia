import { Fragment } from 'react';
import { COLOR_ESTADO, HALLAZGOS } from '@/domain/odontograma/catalogo';
import type { EstadoPieza, MarcaOdontograma } from '@/domain/odontograma/estado';
import { filasOdontograma, nombreCara, posicion, ubicacionCaras, type Cara, type VistaDenticion } from '@/domain/odontograma/piezas';

/** Medidas del dibujo, en unidades del viewBox. */
const PIEZA = 44;
const SEPARACION = 6;
const LINEA_MEDIA = 24;
const MARGEN = 16;
const CENTRO = MARGEN + 8 * PIEZA + 7 * SEPARACION + LINEA_MEDIA / 2;
const ANCHO = 2 * CENTRO;
const ALTO_FILA = 92;

const COLOR = { rojo: 'var(--rojo)', azul: 'var(--azul)' } as const;
const colorDe = (marca: MarcaOdontograma) => COLOR[COLOR_ESTADO[marca.estado]];

function xDePieza(pieza: number, lado: 'izquierda' | 'derecha'): number {
  const p = posicion(pieza);
  return lado === 'izquierda' ? CENTRO - LINEA_MEDIA / 2 - p * PIEZA - (p - 1) * SEPARACION : CENTRO + LINEA_MEDIA / 2 + (p - 1) * (PIEZA + SEPARACION);
}

type Zona = 'arriba' | 'abajo' | 'izquierda' | 'derecha' | 'centro';

/** Polígonos del dibujo clásico de cinco sectores. */
function puntosDeZona(zona: Exclude<Zona, 'centro'>, x: number, y: number): string {
  const s = PIEZA;
  const a = 0.3 * s;
  const b = 0.7 * s;
  const puntos: Record<typeof zona, [number, number][]> = {
    arriba: [[0, 0], [s, 0], [b, a], [a, a]],
    abajo: [[0, s], [s, s], [b, b], [a, b]],
    izquierda: [[0, 0], [a, a], [a, b], [0, s]],
    derecha: [[s, 0], [b, a], [b, b], [s, s]],
  };
  return puntos[zona].map(([px, py]) => `${x + px},${y + py}`).join(' ');
}

interface PropsPieza {
  pieza: number;
  x: number;
  y: number;
  estado?: EstadoPieza;
  onTocar?: (pieza: number, cara: Cara) => void;
}

function Pieza({ pieza, x, y, estado, onTocar }: PropsPieza) {
  const ubicacion = ubicacionCaras(pieza);
  const completa = estado?.completa ?? [];
  const cruz = completa.findLast((m) => m.hallazgo === 'ausente' || m.hallazgo === 'extraccion');
  const corona = completa.findLast((m) => m.hallazgo === 'corona');
  const centroX = x + PIEZA / 2;
  const centroY = y + PIEZA / 2;

  const propsCara = (zona: Zona) => {
    const cara = ubicacion[zona];
    const marca = estado?.caras[cara]?.at(-1);
    const interactiva = Boolean(onTocar);
    return {
      className: 'cara',
      fill: marca ? colorDe(marca) : 'var(--pieza)',
      fillOpacity: marca ? 0.85 : 1,
      ...(interactiva && {
        role: 'button',
        tabIndex: 0,
        'aria-label': `Pieza ${pieza}, cara ${nombreCara(pieza, cara).toLowerCase()}${marca ? `: ${HALLAZGOS[marca.hallazgo].nombre.toLowerCase()}` : ''}`,
        onClick: () => onTocar?.(pieza, cara),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTocar?.(pieza, cara);
          }
        },
      }),
    };
  };

  return (
    <g>
      <text x={centroX} y={y - 8} textAnchor="middle" fontSize="12" fill="var(--texto-suave)">
        {pieza}
      </text>
      <polygon points={puntosDeZona('arriba', x, y)} {...propsCara('arriba')} />
      <polygon points={puntosDeZona('abajo', x, y)} {...propsCara('abajo')} />
      <polygon points={puntosDeZona('izquierda', x, y)} {...propsCara('izquierda')} />
      <polygon points={puntosDeZona('derecha', x, y)} {...propsCara('derecha')} />
      <rect x={x + 0.3 * PIEZA} y={y + 0.3 * PIEZA} width={0.4 * PIEZA} height={0.4 * PIEZA} {...propsCara('centro')} />
      {corona && <circle cx={centroX} cy={centroY} r={PIEZA * 0.62} fill="none" stroke={colorDe(corona)} strokeWidth="2.5" pointerEvents="none" />}
      {cruz && (
        <g stroke={colorDe(cruz)} strokeWidth="3.5" strokeLinecap="round" pointerEvents="none">
          <line x1={x + 4} y1={y + 4} x2={x + PIEZA - 4} y2={y + PIEZA - 4} />
          <line x1={x + PIEZA - 4} y1={y + 4} x2={x + 4} y2={y + PIEZA - 4} />
        </g>
      )}
      {completa.length > 0 && (
        <text x={centroX} y={y + PIEZA + 17} textAnchor="middle" fontSize="12" fontWeight="600">
          {completa.map((m, i) => (
            <tspan key={m.id} fill={colorDe(m)}>
              {i > 0 ? ' ' : ''}
              {HALLAZGOS[m.hallazgo].abreviatura}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}

interface PropsOdontograma {
  vista: VistaDenticion;
  estado: ReadonlyMap<number, EstadoPieza>;
  /** Sin `onTocar` el odontograma es de solo lectura. */
  onTocar?: (pieza: number, cara: Cara) => void;
}

export function Odontograma({ vista, estado, onTocar }: PropsOdontograma) {
  const filas = filasOdontograma(vista);
  const alto = filas.length * ALTO_FILA + MARGEN;
  const mitad = filas.length / 2;

  return (
    <svg className="odontograma" viewBox={`0 0 ${ANCHO} ${alto}`} role="group" aria-label={`Odontograma, dentición ${vista}`}>
      <line x1={CENTRO} x2={CENTRO} y1={MARGEN} y2={alto - MARGEN} stroke="var(--borde)" strokeDasharray="4 4" />
      <line x1={MARGEN} x2={ANCHO - MARGEN} y1={MARGEN + mitad * ALTO_FILA - 6} y2={MARGEN + mitad * ALTO_FILA - 6} stroke="var(--borde)" strokeDasharray="4 4" />
      {filas.map((fila, i) => {
        const y = MARGEN + i * ALTO_FILA + 22;
        return (
          <Fragment key={fila.clave}>
            {fila.izquierda.map((pieza) => (
              <Pieza key={pieza} pieza={pieza} x={xDePieza(pieza, 'izquierda')} y={y} estado={estado.get(pieza)} onTocar={onTocar} />
            ))}
            {fila.derecha.map((pieza) => (
              <Pieza key={pieza} pieza={pieza} x={xDePieza(pieza, 'derecha')} y={y} estado={estado.get(pieza)} onTocar={onTocar} />
            ))}
          </Fragment>
        );
      })}
    </svg>
  );
}
