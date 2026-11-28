'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import type { EstadoFormulario } from '@/components/ui/estado-formulario';
import { tamanioLegible } from '@/domain/historia-clinica/registros';
import { TODAS_LAS_PIEZAS } from '@/domain/odontograma/piezas';
import { DialogoFirma, type FirmaDisponible, type PacienteParaFirmar } from './DialogoFirma';

/** Las imágenes más grandes que esto se achican: alcanza para ver una radiografía con detalle. */
const LADO_MAXIMO = 2400;
const PESO_PARA_ACHICAR = 4 * 1024 * 1024;

/** El máximo lo decide el servidor: 10 MB, o 4 MB en la demo online (Vercel). */
export interface LimiteDeAdjunto {
  bytes: number;
  texto: string;
  mensaje: string;
}
const TIPOS_ACEPTADOS = 'image/jpeg,image/png,image/webp,application/pdf';
const PIEZAS = TODAS_LAS_PIEZAS.toSorted((a, b) => a - b);

interface ArchivoListo {
  blob: Blob;
  nombre: string;
  tipo: string;
  pesoOriginal: number;
  sha256: string | null;
}

/** Achica las imágenes grandes en el navegador (también les saca los datos de ubicación de la cámara). */
async function preparar(archivo: File, pesoParaAchicar: number): Promise<ArchivoListo> {
  let blob: Blob = archivo;
  let nombre = archivo.name;
  let tipo = archivo.type;
  if (archivo.type.startsWith('image/')) {
    const imagen = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
    if (escala < 1 || archivo.size > pesoParaAchicar) {
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(imagen.width * escala);
      lienzo.height = Math.round(imagen.height * escala);
      lienzo.getContext('2d')?.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
      blob = await new Promise<Blob>((resolver, rechazar) => lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo procesar la imagen.'))), 'image/jpeg', 0.9));
      nombre = `${nombre.replace(/\.[^.]+$/, '')}.jpg`;
      tipo = 'image/jpeg';
    }
    imagen.close();
  }
  // La huella permite comprobar en el servidor que el archivo llegó completo.
  // `crypto.subtle` solo existe en conexiones seguras (https o la misma compu).
  const sha256 = globalThis.crypto?.subtle
    ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('')
    : null;
  return { blob, nombre, tipo, pesoOriginal: archivo.size, sha256 };
}

export function SubirAdjunto({ paciente, firma, limite }: { paciente: PacienteParaFirmar; firma: FirmaDisponible; limite: LimiteDeAdjunto }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<ArchivoListo | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [descripcion, setDescripcion] = useState('');
  const [pieza, setPieza] = useState('');
  const [mensaje, setMensaje] = useState<{ error: boolean; texto: string } | null>(null);
  const ids = { archivo: useId(), descripcion: useId(), pieza: useId() };

  async function enviar(pin: string): Promise<EstadoFormulario> {
    if (!archivo) return { ok: false, errores: ['Elegí un archivo.'] };
    try {
      const respuesta = await fetch(`/pacientes/${paciente.id}/historia-clinica/adjuntos`, {
        method: 'POST',
        headers: {
          'Content-Type': archivo.tipo || 'application/octet-stream',
          'X-Adjunto-Nombre': encodeURIComponent(archivo.nombre),
          'X-Adjunto-Descripcion': encodeURIComponent(descripcion.trim()),
          'X-Adjunto-Pieza': pieza,
          'X-Adjunto-Bytes': String(archivo.blob.size),
          ...(archivo.sha256 ? { 'X-Adjunto-Sha256': archivo.sha256 } : {}),
          'X-Pin-Firma': pin,
        },
        body: archivo.blob,
      });
      const resultado = (await respuesta.json().catch(() => null)) as EstadoFormulario | null;
      return resultado ?? { ok: false, errores: ['No se pudo subir el archivo. Probá de nuevo.'] };
    } catch {
      return { ok: false, errores: ['No hay conexión con el sistema. Probá de nuevo.'] };
    }
  }

  return (
    <div className="pila">
      <div className="fila-campos">
        <label className="campo" htmlFor={ids.archivo}>
          <span>Imagen (JPG, PNG, WebP) o PDF, hasta {limite.texto}</span>
          <input
            ref={entrada}
            id={ids.archivo}
            type="file"
            accept={TIPOS_ACEPTADOS}
            className="entrada-archivo"
            onChange={async (evento) => {
              const elegido = evento.target.files?.[0];
              setMensaje(null);
              setArchivo(null);
              if (!elegido) return;
              setPreparando(true);
              try {
                const listo = await preparar(elegido, Math.min(PESO_PARA_ACHICAR, limite.bytes));
                if (listo.blob.size > limite.bytes) setMensaje({ error: true, texto: limite.mensaje });
                else setArchivo(listo);
              } catch {
                setMensaje({ error: true, texto: 'No se pudo leer el archivo. Probá con otro.' });
              } finally {
                setPreparando(false);
              }
            }}
          />
        </label>
        <label className="campo" htmlFor={ids.pieza}>
          <span>Pieza (opcional)</span>
          <select id={ids.pieza} value={pieza} onChange={(e) => setPieza(e.target.value)}>
            <option value="">Sin pieza</option>
            <optgroup label="Permanentes">
              {PIEZAS.filter((p) => p < 50).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </optgroup>
            <optgroup label="Temporales">
              {PIEZAS.filter((p) => p > 50).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
      <label className="campo" htmlFor={ids.descripcion}>
        <span>Qué es</span>
        <input id={ids.descripcion} type="text" value={descripcion} maxLength={300} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: Radiografía periapical" />
      </label>
      {preparando && <p className="suave">Preparando el archivo…</p>}
      {archivo && (
        <p className="suave" style={{ margin: 0 }}>
          {archivo.nombre} · {tamanioLegible(archivo.blob.size)}
          {archivo.blob.size < archivo.pesoOriginal ? ` (se achicó de ${tamanioLegible(archivo.pesoOriginal)})` : ''}
        </p>
      )}
      {mensaje && (
        <div className={`aviso ${mensaje.error ? 'error' : 'ok'}`} role={mensaje.error ? 'alert' : 'status'}>
          {mensaje.texto}
        </div>
      )}
      <div>
        <DialogoFirma
          paciente={paciente}
          firma={firma}
          textoBoton="Adjuntar y firmar"
          deshabilitado={preparando}
          validar={() => [...(archivo ? [] : ['Elegí un archivo.']), ...(descripcion.trim() ? [] : ['Escribí qué es el archivo.'])]}
          resumen={
            <>
              <strong>Archivo adjunto{pieza ? ` · pieza ${pieza}` : ''}</strong>
              <p className="texto-firmado">
                {descripcion.trim()}
                <br />
                <span className="suave">
                  {archivo?.nombre} · {archivo ? tamanioLegible(archivo.blob.size) : ''}
                </span>
              </p>
            </>
          }
          firmar={enviar}
          alFirmar={(estado) => {
            setArchivo(null);
            setDescripcion('');
            setPieza('');
            if (entrada.current) entrada.current.value = '';
            setMensaje({ error: false, texto: estado.mensaje ?? 'Archivo adjuntado.' });
            router.refresh();
          }}
        />
      </div>
    </div>
  );
}
