CREATE TYPE "public"."origen_accion" AS ENUM('usuario', 'sistema', 'ia');--> statement-breakpoint
CREATE TYPE "public"."plazo_regreso" AS ENUM('unos_dias', 'una_semana', 'dos_semanas', 'un_mes', 'tres_meses', 'seis_meses', 'cuando_avise', 'no_hace_falta');--> statement-breakpoint
CREATE TYPE "public"."prioridad_pendiente" AS ENUM('alta', 'media', 'baja');--> statement-breakpoint
CREATE TYPE "public"."respuesta_contacto" AS ENUM('no_contesta', 'quiere_turno', 'mas_adelante', 'lo_piensa', 'no_quiere');--> statement-breakpoint
CREATE TYPE "public"."tipo_accion_pendiente" AS ENUM('creado', 'tomado', 'contacto', 'nueva_fecha', 'no_responde', 'resuelto', 'descartado', 'reabierto');--> statement-breakpoint
ALTER TYPE "public"."estado_pendiente" ADD VALUE 'no_responde' BEFORE 'resuelto';--> statement-breakpoint
CREATE TABLE "indicaciones_regreso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"turno_id" uuid,
	"plazo" "plazo_regreso" NOT NULL,
	"importante" boolean DEFAULT false NOT NULL,
	"fecha_visita" date NOT NULL,
	"fecha_esperada" date,
	"indicada_por" uuid NOT NULL,
	"cargada_por" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indicaciones_regreso_fecha_esperada" CHECK (("indicaciones_regreso"."plazo" in ('cuando_avise', 'no_hace_falta')) = ("indicaciones_regreso"."fecha_esperada" is null))
);
--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ALTER COLUMN "usuario_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ALTER COLUMN "canal" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ALTER COLUMN "resultado" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ADD COLUMN "tipo" "tipo_accion_pendiente" DEFAULT 'contacto' NOT NULL;--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ADD COLUMN "origen" "origen_accion" DEFAULT 'usuario' NOT NULL;--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ADD COLUMN "respuesta" "respuesta_contacto";--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ADD COLUMN "contactar_desde" date;--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ADD COLUMN "contactar_desde_motivo" text;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "prioridad" "prioridad_pendiente" DEFAULT 'media' NOT NULL;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "importante" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "clave" text;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "tomado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "contactar_desde" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "contactar_desde_motivo" text;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "contactar_desde_origen" "origen_accion" DEFAULT 'sistema' NOT NULL;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "profesional_id" uuid;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "turno_id" uuid;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "indicacion_id" uuid;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "escalado_a" uuid;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "escalado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "cerrado_por" uuid;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "motivo_cierre" text;--> statement-breakpoint
ALTER TABLE "pendientes" ADD COLUMN "resuelto_por_turno_id" uuid;--> statement-breakpoint
ALTER TABLE "indicaciones_regreso" ADD CONSTRAINT "indicaciones_regreso_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicaciones_regreso" ADD CONSTRAINT "indicaciones_regreso_turno_id_turnos_id_fk" FOREIGN KEY ("turno_id") REFERENCES "public"."turnos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicaciones_regreso" ADD CONSTRAINT "indicaciones_regreso_indicada_por_profesionales_usuario_id_fk" FOREIGN KEY ("indicada_por") REFERENCES "public"."profesionales"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicaciones_regreso" ADD CONSTRAINT "indicaciones_regreso_cargada_por_usuarios_id_fk" FOREIGN KEY ("cargada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "indicaciones_regreso_paciente_idx" ON "indicaciones_regreso" USING btree ("paciente_id","fecha_visita");--> statement-breakpoint
CREATE INDEX "indicaciones_regreso_turno_idx" ON "indicaciones_regreso" USING btree ("turno_id");--> statement-breakpoint
ALTER TABLE "pendientes" ADD CONSTRAINT "pendientes_profesional_id_profesionales_usuario_id_fk" FOREIGN KEY ("profesional_id") REFERENCES "public"."profesionales"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendientes" ADD CONSTRAINT "pendientes_turno_id_turnos_id_fk" FOREIGN KEY ("turno_id") REFERENCES "public"."turnos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendientes" ADD CONSTRAINT "pendientes_indicacion_id_indicaciones_regreso_id_fk" FOREIGN KEY ("indicacion_id") REFERENCES "public"."indicaciones_regreso"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendientes" ADD CONSTRAINT "pendientes_escalado_a_usuarios_id_fk" FOREIGN KEY ("escalado_a") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendientes" ADD CONSTRAINT "pendientes_cerrado_por_usuarios_id_fk" FOREIGN KEY ("cerrado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendientes" ADD CONSTRAINT "pendientes_resuelto_por_turno_id_turnos_id_fk" FOREIGN KEY ("resuelto_por_turno_id") REFERENCES "public"."turnos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pendiente_acciones_pendiente_idx" ON "pendiente_acciones" USING btree ("pendiente_id","creado_en");--> statement-breakpoint
CREATE INDEX "pendientes_paciente_idx" ON "pendientes" USING btree ("paciente_id");--> statement-breakpoint
ALTER TABLE "pendientes" ADD CONSTRAINT "pendientes_clave_unica" UNIQUE("clave");--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ADD CONSTRAINT "pendiente_acciones_contacto" CHECK ("pendiente_acciones"."tipo" <> 'contacto' or ("pendiente_acciones"."canal" is not null and "pendiente_acciones"."respuesta" is not null));--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ADD CONSTRAINT "pendiente_acciones_autor" CHECK ("pendiente_acciones"."origen" <> 'usuario' or "pendiente_acciones"."usuario_id" is not null);