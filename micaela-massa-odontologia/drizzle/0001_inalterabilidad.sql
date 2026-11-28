-- Inalterabilidad de la historia clínica (Ley 26.529 art. 13 y 18, Ley 27.706).
-- La base de datos misma impide modificar o borrar lo registrado, aunque la
-- aplicación tuviera un error o alguien accediera directo a la base.

-- 1. Tablas de solo agregar: ni UPDATE ni DELETE.
CREATE OR REPLACE FUNCTION impedir_modificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es inalterable: no se permite %. Las correcciones se agregan como registros nuevos.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER registros_clinicos_inalterables BEFORE UPDATE OR DELETE ON registros_clinicos FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint
CREATE TRIGGER marcas_odontograma_inalterables BEFORE UPDATE OR DELETE ON marcas_odontograma FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint
CREATE TRIGGER historias_clinicas_inalterables BEFORE UPDATE OR DELETE ON historias_clinicas FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint
CREATE TRIGGER adjuntos_inalterables BEFORE UPDATE OR DELETE ON adjuntos FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint
CREATE TRIGGER turno_eventos_inalterables BEFORE UPDATE OR DELETE ON turno_eventos FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint
CREATE TRIGGER pendiente_acciones_inalterables BEFORE UPDATE OR DELETE ON pendiente_acciones FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint
CREATE TRIGGER auditoria_accesos_inalterable BEFORE UPDATE OR DELETE ON auditoria_accesos FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint

-- 2. Nada se borra de verdad: pacientes, usuarios y alertas se desactivan.
CREATE OR REPLACE FUNCTION impedir_borrado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'No se pueden borrar filas de %: desactivalas.', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pacientes_sin_borrado BEFORE DELETE ON pacientes FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
--> statement-breakpoint
CREATE TRIGGER usuarios_sin_borrado BEFORE DELETE ON usuarios FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
--> statement-breakpoint
CREATE TRIGGER profesionales_sin_borrado BEFORE DELETE ON profesionales FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
--> statement-breakpoint
CREATE TRIGGER alertas_medicas_sin_borrado BEFORE DELETE ON alertas_medicas FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
--> statement-breakpoint
CREATE TRIGGER plantillas_consentimiento_sin_borrado BEFORE DELETE ON plantillas_consentimiento FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
--> statement-breakpoint

-- 3. TRUNCATE saltea los triggers por fila: también se bloquea.
CREATE OR REPLACE FUNCTION impedir_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'No se permite TRUNCATE sobre %.', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER registros_clinicos_sin_truncate BEFORE TRUNCATE ON registros_clinicos FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER marcas_odontograma_sin_truncate BEFORE TRUNCATE ON marcas_odontograma FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER historias_clinicas_sin_truncate BEFORE TRUNCATE ON historias_clinicas FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER adjuntos_sin_truncate BEFORE TRUNCATE ON adjuntos FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER pacientes_sin_truncate BEFORE TRUNCATE ON pacientes FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER auditoria_accesos_sin_truncate BEFORE TRUNCATE ON auditoria_accesos FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint

-- 4. Un modelo de consentimiento publicado no cambia de texto: se crea una versión nueva.
CREATE OR REPLACE FUNCTION plantilla_consentimiento_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.texto IS DISTINCT FROM OLD.texto OR NEW.version IS DISTINCT FROM OLD.version OR NEW.procedimiento IS DISTINCT FROM OLD.procedimiento THEN
    RAISE EXCEPTION 'El texto de un consentimiento publicado no se modifica: creá una versión nueva.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER plantillas_consentimiento_inmutables BEFORE UPDATE ON plantillas_consentimiento FOR EACH ROW EXECUTE FUNCTION plantilla_consentimiento_inmutable();
--> statement-breakpoint

-- 5. Encadenamiento de registros clínicos: cada registro sigue al anterior de su HC.
CREATE OR REPLACE FUNCTION verificar_encadenamiento_registro() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ultima_secuencia integer;
  ultimo_hash char(64);
  original record;
BEGIN
  -- Serializa las firmas concurrentes sobre la misma historia clínica.
  PERFORM 1 FROM historias_clinicas WHERE id = NEW.historia_clinica_id FOR UPDATE;

  SELECT secuencia, hash INTO ultima_secuencia, ultimo_hash
    FROM registros_clinicos
   WHERE historia_clinica_id = NEW.historia_clinica_id
   ORDER BY secuencia DESC
   LIMIT 1;

  IF NOT FOUND THEN
    IF NEW.secuencia <> 1 OR NEW.hash_anterior <> repeat('0', 64) THEN
      RAISE EXCEPTION 'El primer registro de la historia clínica debe tener secuencia 1 y hash anterior génesis.'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF NEW.secuencia <> ultima_secuencia + 1 OR NEW.hash_anterior <> ultimo_hash THEN
    RAISE EXCEPTION 'Registro fuera de secuencia: se esperaba la secuencia % encadenada al último registro.', ultima_secuencia + 1
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.enmienda_de IS NOT NULL THEN
    SELECT historia_clinica_id, autor_id INTO original FROM registros_clinicos WHERE id = NEW.enmienda_de;
    IF original.historia_clinica_id IS DISTINCT FROM NEW.historia_clinica_id OR original.autor_id IS DISTINCT FROM NEW.autor_id THEN
      RAISE EXCEPTION 'Solo el autor puede enmendar un registro, y dentro de la misma historia clínica.'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER registros_clinicos_encadenados BEFORE INSERT ON registros_clinicos FOR EACH ROW EXECUTE FUNCTION verificar_encadenamiento_registro();
--> statement-breakpoint

-- 6. Una marca del odontograma pertenece a la HC de su registro, y solo reemplaza marcas de la misma pieza.
CREATE OR REPLACE FUNCTION verificar_marca_odontograma() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  anterior record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM registros_clinicos WHERE id = NEW.registro_id AND historia_clinica_id = NEW.historia_clinica_id) THEN
    RAISE EXCEPTION 'La marca no corresponde a la historia clínica de su registro.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.reemplaza_a IS NOT NULL THEN
    SELECT historia_clinica_id, pieza INTO anterior FROM marcas_odontograma WHERE id = NEW.reemplaza_a;
    IF anterior.historia_clinica_id IS DISTINCT FROM NEW.historia_clinica_id OR anterior.pieza IS DISTINCT FROM NEW.pieza THEN
      RAISE EXCEPTION 'Solo se puede reemplazar una marca de la misma pieza y la misma historia clínica.'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER marcas_odontograma_verificadas BEFORE INSERT ON marcas_odontograma FOR EACH ROW EXECUTE FUNCTION verificar_marca_odontograma();
