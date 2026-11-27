CREATE TYPE "public"."ambito_intento" AS ENUM('ingreso', 'cuenta');--> statement-breakpoint
ALTER TABLE "intentos_ingreso" ADD COLUMN "ambito" "ambito_intento" DEFAULT 'ingreso' NOT NULL;--> statement-breakpoint
CREATE INDEX "intentos_ingreso_usuario_idx" ON "intentos_ingreso" USING btree ("usuario_id","creado_en");