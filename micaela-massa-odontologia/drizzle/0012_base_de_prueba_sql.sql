-- Marca de base de prueba: una vez puesta, no se cambia ni se borra.
-- Así una base sembrada con usuarios de credenciales públicas no puede
-- "pasar" por una base real (el modo real se niega a usarla). Reiniciar la
-- demo descarta el esquema entero, que no dispara estos triggers.
CREATE TRIGGER base_de_prueba_inalterable BEFORE UPDATE OR DELETE ON base_de_prueba FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint
CREATE TRIGGER base_de_prueba_sin_truncate BEFORE TRUNCATE ON base_de_prueba FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
