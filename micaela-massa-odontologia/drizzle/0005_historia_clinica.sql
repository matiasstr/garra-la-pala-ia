ALTER TABLE "profesionales" ADD COLUMN "pin_firma_hash" text;--> statement-breakpoint
ALTER TABLE "profesionales" ADD COLUMN "pin_firma_actualizado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profesionales" ADD COLUMN "pin_firma_intentos_fallidos" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profesionales" ADD COLUMN "pin_firma_bloqueado_hasta" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "adjuntos_hc_idx" ON "adjuntos" USING btree ("historia_clinica_id");--> statement-breakpoint
ALTER TABLE "borradores_clinicos" ADD CONSTRAINT "borradores_clinicos_unico" UNIQUE("historia_clinica_id","autor_id","tipo");--> statement-breakpoint
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_pin_intentos" CHECK ("profesionales"."pin_firma_intentos_fallidos" >= 0);