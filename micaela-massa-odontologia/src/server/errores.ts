export class ErrorDePermiso extends Error {
  override name = 'ErrorDePermiso';
}

export class ErrorDeValidacion extends Error {
  override name = 'ErrorDeValidacion';
  constructor(readonly errores: string[]) {
    super(errores.join(' '));
  }
}
