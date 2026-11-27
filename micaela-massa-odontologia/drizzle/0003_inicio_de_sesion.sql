CREATE TYPE "public"."motivo_enlace_acceso" AS ENUM('primer_ingreso', 'blanqueo_clave', 'blanqueo_verificacion');--> statement-breakpoint
CREATE TYPE "public"."resultado_intento_ingreso" AS ENUM('clave_incorrecta', 'codigo_incorrecto', 'clave_correcta', 'ingreso', 'bloqueado');--> statement-breakpoint
CREATE TABLE "codigos_recuperacion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"codigo_hash" char(64) NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"usado_en" timestamp with time zone,
	"anulado_en" timestamp with time zone,
	CONSTRAINT "codigos_recuperacion_unico" UNIQUE("usuario_id","codigo_hash")
);
--> statement-breakpoint
CREATE TABLE "consultorio_miembros" (
	"consultorio_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultorio_miembros_consultorio_id_usuario_id_pk" PRIMARY KEY("consultorio_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "consultorios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enlaces_acceso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" char(64) NOT NULL,
	"usuario_id" uuid NOT NULL,
	"motivo" "motivo_enlace_acceso" NOT NULL,
	"creado_por" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"vence_en" timestamp with time zone NOT NULL,
	"usado_en" timestamp with time zone,
	"anulado_en" timestamp with time zone,
	CONSTRAINT "enlaces_acceso_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "enlaces_acceso_token_hash_hex" CHECK ("enlaces_acceso"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "intentos_ingreso" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email_huella" char(64),
	"usuario_id" uuid,
	"ip" text,
	"resultado" "resultado_intento_ingreso" NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" char(64) NOT NULL,
	"usuario_id" uuid NOT NULL,
	"consultorio_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"verificada_en" timestamp with time zone,
	"ultimo_uso_en" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrada_en" timestamp with time zone,
	"motivo_cierre" text,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "sesiones_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sesiones_token_hash_hex" CHECK ("sesiones"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
-- EDITADO A MANO (ver el informe de inicio de sesión): drizzle-kit creaba la
-- clave primaria nueva antes de agregar la columna, y la columna NOT NULL
-- fallaba en una base con datos. Orden correcto: agregar la columna, pasar lo
-- existente a un consultorio inicial y recién ahí cambiar la clave primaria.
ALTER TABLE "usuario_roles" ADD COLUMN "consultorio_id" uuid;--> statement-breakpoint
INSERT INTO "consultorios" ("nombre") SELECT 'Micaela Massa Odontología' WHERE EXISTS (SELECT 1 FROM "usuarios");--> statement-breakpoint
INSERT INTO "consultorio_miembros" ("consultorio_id", "usuario_id", "activo") SELECT c."id", u."id", u."activo" FROM "usuarios" u CROSS JOIN (SELECT "id" FROM "consultorios" ORDER BY "creado_en" LIMIT 1) c;--> statement-breakpoint
UPDATE "usuario_roles" SET "consultorio_id" = (SELECT "id" FROM "consultorios" ORDER BY "creado_en" LIMIT 1);--> statement-breakpoint
ALTER TABLE "usuario_roles" ALTER COLUMN "consultorio_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usuario_roles" DROP CONSTRAINT "usuario_roles_usuario_id_rol_pk";--> statement-breakpoint
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_consultorio_id_usuario_id_rol_pk" PRIMARY KEY("consultorio_id","usuario_id","rol");--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "clave_hash" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "clave_cambiada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "totp_secreto" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "totp_confirmado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "totp_ultimo_paso" bigint;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "totp_pendiente" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "totp_pendiente_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "codigos_recuperacion" ADD CONSTRAINT "codigos_recuperacion_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultorio_miembros" ADD CONSTRAINT "consultorio_miembros_consultorio_id_consultorios_id_fk" FOREIGN KEY ("consultorio_id") REFERENCES "public"."consultorios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultorio_miembros" ADD CONSTRAINT "consultorio_miembros_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enlaces_acceso" ADD CONSTRAINT "enlaces_acceso_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enlaces_acceso" ADD CONSTRAINT "enlaces_acceso_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intentos_ingreso" ADD CONSTRAINT "intentos_ingreso_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_consultorio_id_consultorios_id_fk" FOREIGN KEY ("consultorio_id") REFERENCES "public"."consultorios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_miembro_fk" FOREIGN KEY ("consultorio_id","usuario_id") REFERENCES "public"."consultorio_miembros"("consultorio_id","usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultorio_miembros_usuario_idx" ON "consultorio_miembros" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enlaces_acceso_uno_vigente" ON "enlaces_acceso" USING btree ("usuario_id") WHERE "enlaces_acceso"."usado_en" is null and "enlaces_acceso"."anulado_en" is null;--> statement-breakpoint
CREATE INDEX "intentos_ingreso_email_idx" ON "intentos_ingreso" USING btree ("email_huella","creado_en");--> statement-breakpoint
CREATE INDEX "intentos_ingreso_ip_idx" ON "intentos_ingreso" USING btree ("ip","creado_en");--> statement-breakpoint
CREATE INDEX "sesiones_usuario_idx" ON "sesiones" USING btree ("usuario_id","cerrada_en");--> statement-breakpoint
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_consultorio_id_consultorios_id_fk" FOREIGN KEY ("consultorio_id") REFERENCES "public"."consultorios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_miembro_fk" FOREIGN KEY ("consultorio_id","usuario_id") REFERENCES "public"."consultorio_miembros"("consultorio_id","usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_email_normalizado" CHECK ("usuarios"."email" = lower(btrim("usuarios"."email")));--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_totp_confirmado" CHECK (("usuarios"."totp_secreto" is null) = ("usuarios"."totp_confirmado_en" is null));