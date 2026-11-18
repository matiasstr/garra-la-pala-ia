interface Props {
  pacienteId: string;
  nombre: string;
  apellido: string;
  fotoKey: string | null;
  tamanio?: number;
}

/** Foto del paciente, o sus iniciales si todavía no tiene. */
export function Avatar({ pacienteId, nombre, apellido, fotoKey, tamanio = 48 }: Props) {
  const estilo = { width: tamanio, height: tamanio, fontSize: Math.round(tamanio * 0.36) };
  if (fotoKey) {
    // La huella de la foto en la URL evita que el navegador muestre una foto vieja.
    const version = fotoKey.split('/').at(-1)?.slice(0, 12) ?? '';
    return (
      // Foto privada: la sirve la app con control de permisos, no un CDN.
      <img className="avatar" src={`/pacientes/${pacienteId}/foto?v=${version}`} alt={`Foto de ${nombre} ${apellido}`} width={tamanio} height={tamanio} style={estilo} />
    );
  }
  const iniciales = `${apellido.at(0) ?? ''}${nombre.at(0) ?? ''}`.toUpperCase();
  return (
    <span className="avatar" style={estilo} role="img" aria-label={`${nombre} ${apellido}, sin foto`}>
      {iniciales}
    </span>
  );
}
