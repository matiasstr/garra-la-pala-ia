-- Seguimiento de pacientes: los historiales son de solo agregar.
-- Usa las funciones de 0001_inalterabilidad (impedir_modificacion, impedir_borrado, impedir_truncate).
-- Importante: no usar acá el valor 'no_responde' de estado_pendiente: se agrega en la
-- migración anterior y Postgres no deja usarlo dentro de la misma transacción.

-- 1. "¿Cuándo debería volver?": para cambiarla se carga otra indicación.
CREATE TRIGGER indicaciones_regreso_inalterables BEFORE UPDATE OR DELETE ON indicaciones_regreso FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint
CREATE TRIGGER indicaciones_regreso_sin_truncate BEFORE TRUNCATE ON indicaciones_regreso FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint

-- 2. El historial de cada pendiente ya era de solo agregar (0001); se cierra también el TRUNCATE.
CREATE TRIGGER pendiente_acciones_sin_truncate BEFORE TRUNCATE ON pendiente_acciones FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
--> statement-breakpoint

-- 3. Un pendiente cambia de estado, pero no se borra: se resuelve o se descarta con motivo.
CREATE TRIGGER pendientes_sin_borrado BEFORE DELETE ON pendientes FOR EACH ROW EXECUTE FUNCTION impedir_borrado();
--> statement-breakpoint
CREATE TRIGGER pendientes_sin_truncate BEFORE TRUNCATE ON pendientes FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
