-- Archivos guardados en la base (demo online): de solo agregar, como el resto
-- de lo clínico. Un archivo no se cambia ni se borra; uno nuevo tiene otra huella.
CREATE TRIGGER archivos_inalterables BEFORE UPDATE OR DELETE ON archivos FOR EACH ROW EXECUTE FUNCTION impedir_modificacion();
--> statement-breakpoint
CREATE TRIGGER archivos_sin_truncate BEFORE TRUNCATE ON archivos FOR EACH STATEMENT EXECUTE FUNCTION impedir_truncate();
