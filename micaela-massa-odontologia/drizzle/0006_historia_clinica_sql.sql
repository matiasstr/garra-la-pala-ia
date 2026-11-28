-- Historia clínica conectada: reglas que defiende la base, para que nada
-- clínico quede cargado en el paciente equivocado.

-- 1. Un adjunto clínico pertenece a la historia clínica de su mismo paciente.
CREATE OR REPLACE FUNCTION verificar_adjunto_clinico() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.historia_clinica_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM historias_clinicas WHERE id = NEW.historia_clinica_id AND paciente_id = NEW.paciente_id
  ) THEN
    RAISE EXCEPTION 'El adjunto no corresponde a la historia clínica de ese paciente.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER adjuntos_verificados BEFORE INSERT ON adjuntos FOR EACH ROW EXECUTE FUNCTION verificar_adjunto_clinico();
--> statement-breakpoint

-- 2. Un registro clínico vinculado a un turno solo puede ser de un turno del mismo paciente.
--    Un registro de tipo `adjunto` tiene que citar un adjunto de la misma historia clínica, con su huella.
CREATE OR REPLACE FUNCTION verificar_vinculos_registro() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.turno_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM turnos t
      JOIN historias_clinicas hc ON hc.paciente_id = t.paciente_id
     WHERE t.id = NEW.turno_id AND hc.id = NEW.historia_clinica_id
  ) THEN
    RAISE EXCEPTION 'El turno no es del paciente de esta historia clínica.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.tipo = 'adjunto' AND NOT EXISTS (
    SELECT 1
      FROM adjuntos a
     WHERE a.id::text = NEW.contenido -> 'adjunto' ->> 'id'
       AND a.historia_clinica_id = NEW.historia_clinica_id
       AND a.sha256 = NEW.contenido -> 'adjunto' ->> 'sha256'
  ) THEN
    RAISE EXCEPTION 'Un registro de adjunto tiene que citar un archivo de esta historia clínica y su huella SHA-256.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER registros_clinicos_vinculos BEFORE INSERT ON registros_clinicos FOR EACH ROW EXECUTE FUNCTION verificar_vinculos_registro();
