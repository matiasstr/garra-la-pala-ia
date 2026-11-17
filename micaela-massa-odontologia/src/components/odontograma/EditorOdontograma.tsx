'use client';

import { useMemo, useRef, useState } from 'react';
import { CODIGOS_HALLAZGO, HALLAZGOS, NOMBRE_ESTADO, type CodigoHallazgo, type EstadoMarca } from '@/domain/odontograma/catalogo';
import { calcularOdontograma, validarMarca, type MarcaNueva, type MarcaOdontograma } from '@/domain/odontograma/estado';
import { nombreCara, type Cara, type VistaDenticion } from '@/domain/odontograma/piezas';
import { Odontograma } from './Odontograma';

/** Estado previo de ejemplo, como si viniera de la historia clínica ya firmada. */
const FECHA_PREVIA = new Date('2026-03-10T13:00:00Z');
const MARCAS_PREVIAS: MarcaOdontograma[] = [
  { id: 'p1', pieza: 18, cara: null, hallazgo: 'ausente', estado: 'preexistente', registradaEn: FECHA_PREVIA },
  { id: 'p2', pieza: 11, cara: null, hallazgo: 'corona', estado: 'preexistente', registradaEn: FECHA_PREVIA },
  { id: 'p3', pieza: 26, cara: 'O', hallazgo: 'restauracion', estado: 'preexistente', registradaEn: FECHA_PREVIA },
  { id: 'p4', pieza: 26, cara: 'M', hallazgo: 'restauracion', estado: 'preexistente', registradaEn: FECHA_PREVIA },
  { id: 'p5', pieza: 36, cara: 'O', hallazgo: 'caries', estado: 'pendiente', registradaEn: FECHA_PREVIA },
  { id: 'p6', pieza: 46, cara: null, hallazgo: 'extraccion', estado: 'pendiente', registradaEn: FECHA_PREVIA },
];

const VISTAS: { valor: VistaDenticion; nombre: string }[] = [
  { valor: 'permanente', nombre: 'Permanente' },
  { valor: 'mixta', nombre: 'Mixta' },
  { valor: 'temporal', nombre: 'Temporal' },
];

const ESTADOS: { valor: EstadoMarca; clase: 'rojo' | 'azul' }[] = [
  { valor: 'pendiente', clase: 'rojo' },
  { valor: 'realizado', clase: 'azul' },
  { valor: 'preexistente', clase: 'azul' },
];

function describir(marca: MarcaOdontograma): string {
  const lugar = marca.cara ? `${marca.pieza} ${nombreCara(marca.pieza, marca.cara).toLowerCase()}` : `${marca.pieza}`;
  return `${lugar}: ${HALLAZGOS[marca.hallazgo].nombre} (${NOMBRE_ESTADO[marca.estado].toLowerCase()})`;
}

export function EditorOdontograma() {
  const [vista, setVista] = useState<VistaDenticion>('permanente');
  const [hallazgo, setHallazgo] = useState<CodigoHallazgo>('caries');
  const [estadoMarca, setEstadoMarca] = useState<EstadoMarca>('pendiente');
  const [cambios, setCambios] = useState<MarcaOdontograma[]>([]);
  const [mensaje, setMensaje] = useState('');
  const contador = useRef(0);

  const todas = useMemo(() => [...MARCAS_PREVIAS, ...cambios], [cambios]);
  const estado = useMemo(() => calcularOdontograma(todas), [todas]);

  function elegirHallazgo(codigo: CodigoHallazgo) {
    setHallazgo(codigo);
    if (!HALLAZGOS[codigo].admitePendiente && estadoMarca === 'pendiente') setEstadoMarca('preexistente');
  }

  function tocar(pieza: number, caraTocada: Cara) {
    const definicion = HALLAZGOS[hallazgo];
    const cara = definicion.ambito === 'cara' ? caraTocada : null;
    const vigentes = cara ? (estado.get(pieza)?.caras[cara] ?? []) : (estado.get(pieza)?.completa ?? []);

    // Tocar de nuevo lo mismo deshace el cambio (todavía es un borrador sin firmar).
    const repetida = vigentes.find((m) => m.hallazgo === hallazgo && m.estado === estadoMarca && cambios.some((c) => c.id === m.id));
    if (repetida) {
      setCambios((actuales) => actuales.filter((c) => c.id !== repetida.id && c.reemplazaA !== repetida.id));
      setMensaje(`Se deshizo: ${describir(repetida)}.`);
      return;
    }

    // En una cara, la marca nueva reemplaza a la anterior (caries → restauración).
    // En la pieza completa, reemplaza a la del mismo hallazgo (extracción a realizar → realizada).
    const anterior = cara ? vigentes.at(-1) : vigentes.findLast((m) => m.hallazgo === hallazgo);
    if (anterior && anterior.hallazgo === hallazgo && anterior.estado === estadoMarca) {
      setMensaje(`Ya está registrado: ${describir(anterior)}. Para corregirlo, elegí otro hallazgo o estado.`);
      return;
    }
    const nueva: MarcaNueva = { pieza, cara, hallazgo, estado: estadoMarca, reemplazaA: anterior?.id ?? null };
    const errores = validarMarca(nueva, todas);
    if (errores.length) {
      setMensaje(errores.join(' '));
      return;
    }
    contador.current += 1;
    const marca: MarcaOdontograma = { ...nueva, id: `borrador-${contador.current}`, registradaEn: new Date() };
    setCambios((actuales) => [...actuales, marca]);
    setMensaje(`Agregado: ${describir(marca)}.`);
  }

  return (
    <div>
      <div className="grupo-herramientas">
        <span>Dentición</span>
        <div className="herramientas">
          {VISTAS.map((v) => (
            <button key={v.valor} type="button" className="boton" aria-pressed={vista === v.valor} onClick={() => setVista(v.valor)}>
              {v.nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="grupo-herramientas">
        <span>Qué marcar</span>
        <div className="herramientas">
          {CODIGOS_HALLAZGO.map((codigo) => (
            <button key={codigo} type="button" className="boton" aria-pressed={hallazgo === codigo} onClick={() => elegirHallazgo(codigo)}>
              {HALLAZGOS[codigo].nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="grupo-herramientas">
        <span>Estado</span>
        <div className="herramientas">
          {ESTADOS.map((e) => (
            <button
              key={e.valor}
              type="button"
              className={`boton ${e.clase}`}
              aria-pressed={estadoMarca === e.valor}
              disabled={e.valor === 'pendiente' && !HALLAZGOS[hallazgo].admitePendiente}
              onClick={() => setEstadoMarca(e.valor)}
            >
              {NOMBRE_ESTADO[e.valor]}
            </button>
          ))}
        </div>
      </div>

      <div className="tarjeta desplazable" style={{ padding: 8 }}>
        <Odontograma vista={vista} estado={estado} onTocar={tocar} />
      </div>

      <div className="leyenda">
        <span>
          <span className="punto" style={{ background: 'var(--rojo)' }} />A realizar
        </span>
        <span>
          <span className="punto" style={{ background: 'var(--azul)' }} />
          Realizado o preexistente
        </span>
        <span className="suave">Tocá una cara para marcarla. Tocá de nuevo para deshacer.</span>
      </div>

      <p role="status" aria-live="polite" className="suave" style={{ minHeight: '1.5em' }}>
        {mensaje}
      </p>

      <div className="tarjeta">
        <strong>Cambios sin firmar ({cambios.length})</strong>
        {cambios.length > 0 ? (
          <ol className="lista-cambios">
            {cambios.map((c) => (
              <li key={c.id}>{describir(c)}</li>
            ))}
          </ol>
        ) : (
          <p className="suave" style={{ margin: '8px 0 0' }}>
            Todavía no hay cambios.
          </p>
        )}
        <div className="herramientas" style={{ marginTop: 12, marginBottom: 0 }}>
          <button
            type="button"
            className="boton"
            disabled={cambios.length === 0}
            onClick={() => setMensaje('En el sistema, acá se pide el PIN de firma y los cambios quedan en la historia clínica sin poder modificarse. Esta demo no guarda nada.')}
          >
            Firmar cambios
          </button>
          <button
            type="button"
            className="boton"
            disabled={cambios.length === 0}
            onClick={() => {
              setCambios([]);
              setMensaje('Se descartaron los cambios sin firmar.');
            }}
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  );
}
