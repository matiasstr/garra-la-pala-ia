'use client';

import { useMemo, useRef, useState } from 'react';
import { describirMarca } from '@/domain/odontograma/cambios';
import { CODIGOS_HALLAZGO, HALLAZGOS, NOMBRE_ESTADO, type CodigoHallazgo, type EstadoMarca } from '@/domain/odontograma/catalogo';
import { calcularOdontograma, validarMarca, type MarcaNueva, type MarcaOdontograma } from '@/domain/odontograma/estado';
import type { Cara, VistaDenticion } from '@/domain/odontograma/piezas';
import { Odontograma } from './Odontograma';

/** Estado previo de ejemplo para la demo, como si viniera de la historia clínica ya firmada. */
const FECHA_PREVIA = new Date('2026-03-10T13:00:00Z');
const MARCAS_DEMO: MarcaOdontograma[] = [
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

/** Qué hace el próximo toque: marcar un hallazgo o quitar una marca cargada por error. */
type Herramienta = CodigoHallazgo | 'quitar';

interface Props {
  /** Marcas ya firmadas (todas, también las reemplazadas). Sin esto se muestra el ejemplo de la demo. */
  marcasIniciales?: readonly MarcaOdontograma[];
  vistaInicial?: VistaDenticion;
  /**
   * Lo que se muestra debajo de la lista de cambios (por ejemplo, "Firmar
   * cambios" con PIN). Recibe los cambios sin firmar y una función para
   * vaciarlos (con el mensaje a mostrar). Sin esto, la demo muestra botones
   * que no guardan.
   */
  pieDeCambios?: (cambios: readonly MarcaOdontograma[], vaciar: (mensaje?: string) => void) => React.ReactNode;
}

export function EditorOdontograma({ marcasIniciales = MARCAS_DEMO, vistaInicial = 'permanente', pieDeCambios }: Props) {
  const [vista, setVista] = useState<VistaDenticion>(vistaInicial);
  const [herramienta, setHerramienta] = useState<Herramienta>('caries');
  const [estadoMarca, setEstadoMarca] = useState<EstadoMarca>('pendiente');
  const [cambios, setCambios] = useState<MarcaOdontograma[]>([]);
  const [mensaje, setMensaje] = useState('');
  const contador = useRef(0);

  const todas = useMemo(() => [...marcasIniciales, ...cambios], [marcasIniciales, cambios]);
  const estado = useMemo(() => calcularOdontograma(todas), [todas]);
  const esBorrador = (marca: MarcaOdontograma) => cambios.some((c) => c.id === marca.id);

  function elegirHerramienta(nueva: Herramienta) {
    setHerramienta(nueva);
    if (nueva !== 'quitar' && !HALLAZGOS[nueva].admitePendiente && estadoMarca === 'pendiente') setEstadoMarca('preexistente');
  }

  /** Saca un cambio sin firmar, y los que se apoyaban en él. */
  function deshacer(marca: MarcaOdontograma) {
    const sacar = new Set([marca.id]);
    for (const c of cambios) if (c.reemplazaA && sacar.has(c.reemplazaA)) sacar.add(c.id);
    setCambios((actuales) => actuales.filter((c) => !sacar.has(c.id)));
    setMensaje(`Se deshizo: ${describirMarca(marca)}.`);
  }

  function agregar(nueva: MarcaNueva, texto: string) {
    const errores = validarMarca(nueva, todas);
    if (errores.length) {
      setMensaje(errores.join(' '));
      return;
    }
    contador.current += 1;
    const marca: MarcaOdontograma = { ...nueva, id: `borrador-${contador.current}`, registradaEn: new Date() };
    setCambios((actuales) => [...actuales, marca]);
    setMensaje(texto.replace('{marca}', describirMarca({ ...marca, anulacion: false })));
  }

  function quitar(pieza: number, caraTocada: Cara) {
    const objetivo = estado.get(pieza)?.caras[caraTocada]?.at(-1) ?? estado.get(pieza)?.completa.at(-1);
    if (!objetivo) {
      setMensaje(`La pieza ${pieza} no tiene marcas para quitar.`);
      return;
    }
    if (esBorrador(objetivo)) {
      deshacer(objetivo);
      return;
    }
    // Lo firmado no se borra: se agrega una anulación que lo saca del dibujo.
    const { pieza: p, cara, hallazgo, estado: estadoAnterior } = objetivo;
    agregar({ pieza: p, cara, hallazgo, estado: estadoAnterior, reemplazaA: objetivo.id, anulacion: true }, 'Se va a quitar: {marca}.');
  }

  function tocar(pieza: number, caraTocada: Cara) {
    if (herramienta === 'quitar') {
      quitar(pieza, caraTocada);
      return;
    }
    const hallazgo = herramienta;
    const definicion = HALLAZGOS[hallazgo];
    const cara = definicion.ambito === 'cara' ? caraTocada : null;
    const vigentes = cara ? (estado.get(pieza)?.caras[cara] ?? []) : (estado.get(pieza)?.completa ?? []);

    // Tocar de nuevo lo mismo deshace el cambio (todavía es un borrador sin firmar).
    const repetida = vigentes.find((m) => m.hallazgo === hallazgo && m.estado === estadoMarca && esBorrador(m));
    if (repetida) {
      deshacer(repetida);
      return;
    }

    // En una cara, la marca nueva reemplaza a la anterior (caries → restauración).
    // En la pieza completa, reemplaza a la del mismo hallazgo (extracción a realizar → realizada).
    const anterior = cara ? vigentes.at(-1) : vigentes.findLast((m) => m.hallazgo === hallazgo);
    if (anterior && anterior.hallazgo === hallazgo && anterior.estado === estadoMarca) {
      setMensaje(`Ya está registrado: ${describirMarca(anterior)}. Para corregirlo, elegí otro hallazgo o estado, o "Quitar marca".`);
      return;
    }
    agregar({ pieza, cara, hallazgo, estado: estadoMarca, reemplazaA: anterior?.id ?? null }, 'Agregado: {marca}.');
  }

  const descartar = (texto = 'Se descartaron los cambios sin firmar.') => {
    setCambios([]);
    setMensaje(texto);
  };

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
            <button key={codigo} type="button" className="boton" aria-pressed={herramienta === codigo} onClick={() => elegirHerramienta(codigo)}>
              {HALLAZGOS[codigo].nombre}
            </button>
          ))}
          <button type="button" className="boton herramienta-quitar" aria-pressed={herramienta === 'quitar'} onClick={() => elegirHerramienta('quitar')}>
            Quitar marca
          </button>
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
              aria-pressed={herramienta !== 'quitar' && estadoMarca === e.valor}
              disabled={herramienta === 'quitar' || (e.valor === 'pendiente' && !HALLAZGOS[herramienta].admitePendiente)}
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
        <span className="suave">{herramienta === 'quitar' ? 'Tocá la marca que querés quitar.' : 'Tocá una cara para marcarla. Tocá de nuevo para deshacer.'}</span>
      </div>

      <p role="status" aria-live="polite" className="suave" style={{ minHeight: '1.5em' }}>
        {mensaje}
      </p>

      <div className="tarjeta">
        <strong>Cambios sin firmar ({cambios.length})</strong>
        {cambios.length > 0 ? (
          <ol className="lista-cambios">
            {cambios.map((c) => (
              <li key={c.id}>
                <span>{describirMarca(c)}</span>
                <button type="button" className="boton-texto" onClick={() => deshacer(c)} aria-label={`Deshacer: ${describirMarca(c)}`}>
                  Deshacer
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="suave" style={{ margin: '8px 0 0' }}>
            Todavía no hay cambios.
          </p>
        )}
        {pieDeCambios ? (
          pieDeCambios(cambios, descartar)
        ) : (
          <div className="herramientas" style={{ marginTop: 12, marginBottom: 0 }}>
            <button
              type="button"
              className="boton"
              disabled={cambios.length === 0}
              onClick={() => setMensaje('En la historia clínica de cada paciente, acá se pide el PIN de firma y los cambios quedan guardados sin poder modificarse. Esta demo no guarda nada.')}
            >
              Firmar cambios
            </button>
            <button type="button" className="boton" disabled={cambios.length === 0} onClick={() => descartar()}>
              Descartar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
