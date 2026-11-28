-- TRUNCATE saltea los triggers por fila (BEFORE DELETE), así que una tabla que
-- no deja borrar filas se podía vaciar entera de un golpe. Mismo criterio que
-- 0001: toda tabla de solo agregar o sin borrado también impide TRUNCATE
-- (también en cascada, porque el trigger corre en cada tabla alcanzada).
-- Reiniciar la demo descarta el esquema entero, que no dispara estos triggers.
CREATE TRIGGER turno_eventos_sin_truncate BEFORE TRUNCATE ON turno_eventos FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER codigos_recuperacion_sin_truncate BEFORE TRUNCATE ON codigos_recuperacion FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER enlaces_acceso_sin_truncate BEFORE TRUNCATE ON enlaces_acceso FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER consultorio_miembros_sin_truncate BEFORE TRUNCATE ON consultorio_miembros FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
-- Las demás tablas que no dejan borrar filas y todavía se podían vaciar.
CREATE TRIGGER usuarios_sin_truncate BEFORE TRUNCATE ON usuarios FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER profesionales_sin_truncate BEFORE TRUNCATE ON profesionales FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER alertas_medicas_sin_truncate BEFORE TRUNCATE ON alertas_medicas FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint
CREATE TRIGGER plantillas_consentimiento_sin_truncate BEFORE TRUNCATE ON plantillas_consentimiento FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
