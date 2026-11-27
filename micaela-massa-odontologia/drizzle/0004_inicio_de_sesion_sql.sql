-- Inicio de sesión y consultorios: lo que no se puede expresar en el esquema de Drizzle.

-- 1. Los consultorios y la pertenencia de cada persona se desactivan, no se borran:
--    la auditoría y los registros firmados tienen que poder decir siempre quién era quién.
CREATE TRIGGER consultorios_sin_borrado BEFORE DELETE ON consultorios FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
--> statement-breakpoint
CREATE TRIGGER consultorio_miembros_sin_borrado BEFORE DELETE ON consultorio_miembros FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
--> statement-breakpoint
CREATE TRIGGER consultorios_sin_truncate BEFORE TRUNCATE ON consultorios FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint

-- 2. Los intentos de ingreso son un registro de seguridad: no se modifican.
--    (Se pueden borrar los viejos para que la tabla no crezca sin fin.)
CREATE TRIGGER intentos_ingreso_inalterables BEFORE UPDATE ON intentos_ingreso FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint

-- 3. Códigos de recuperación y enlaces de un solo uso: lo único que cambia es
--    cuándo se usaron o anularon, y una vez marcado no se desmarca. Así un
--    código usado no vuelve a valer aunque la aplicación tuviera un error.
CREATE OR REPLACE FUNCTION un_solo_uso() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'usado_en' - 'anulado_en') IS DISTINCT FROM (to_jsonb(OLD) - 'usado_en' - 'anulado_en')
     OR (OLD.usado_en IS NOT NULL AND NEW.usado_en IS DISTINCT FROM OLD.usado_en)
     OR (OLD.anulado_en IS NOT NULL AND NEW.anulado_en IS DISTINCT FROM OLD.anulado_en) THEN
    RAISE EXCEPTION 'En % solo se puede marcar cuándo se usó o se anuló, una sola vez.', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER codigos_recuperacion_un_solo_uso BEFORE UPDATE ON codigos_recuperacion FOR EACH ROW EXECUTE FUNCTION un_solo_uso();
--> statement-breakpoint
CREATE TRIGGER enlaces_acceso_un_solo_uso BEFORE UPDATE ON enlaces_acceso FOR EACH ROW EXECUTE FUNCTION un_solo_uso();
--> statement-breakpoint
CREATE TRIGGER codigos_recuperacion_sin_borrado BEFORE DELETE ON codigos_recuperacion FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
--> statement-breakpoint
CREATE TRIGGER enlaces_acceso_sin_borrado BEFORE DELETE ON enlaces_acceso FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
