CREATE TYPE "public"."ambito_adjunto" AS ENUM('administrativo', 'clinico');--> statement-breakpoint
CREATE TYPE "public"."canal_contacto" AS ENUM('llamada', 'whatsapp', 'instagram', 'email', 'presencial');--> statement-breakpoint
CREATE TYPE "public"."cara_dental" AS ENUM('M', 'D', 'V', 'L', 'O');--> statement-breakpoint
CREATE TYPE "public"."especialidad" AS ENUM('odontologia_general', 'odontopediatria', 'endodoncia', 'ortodoncia', 'periodoncia', 'cirugia_implantes', 'protesis');--> statement-breakpoint
CREATE TYPE "public"."estado_marca" AS ENUM('pendiente', 'realizado', 'preexistente');--> statement-breakpoint
CREATE TYPE "public"."estado_pendiente" AS ENUM('abierto', 'en_curso', 'resuelto', 'descartado');--> statement-breakpoint
CREATE TYPE "public"."estado_prestacion" AS ENUM('propuesta', 'aceptada', 'autorizada', 'realizada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."estado_turno" AS ENUM('reservado', 'confirmado', 'en_sala', 'atendido', 'ausente', 'cancelado', 'reprogramado');--> statement-breakpoint
CREATE TYPE "public"."hallazgo_dental" AS ENUM('caries', 'restauracion', 'sellador', 'fractura', 'endodoncia', 'perno', 'corona', 'extraccion', 'ausente', 'implante', 'protesis_fija', 'protesis_removible');--> statement-breakpoint
CREATE TYPE "public"."metodo_firma" AS ENUM('electronica', 'digital');--> statement-breakpoint
CREATE TYPE "public"."respuesta_presupuesto" AS ENUM('pendiente', 'aceptado', 'aceptado_parcial', 'rechazado');--> statement-breakpoint
CREATE TYPE "public"."rol" AS ENUM('secretaria', 'profesional', 'administrador');--> statement-breakpoint
CREATE TYPE "public"."tipo_alerta_medica" AS ENUM('alergia', 'medicacion', 'condicion');--> statement-breakpoint
CREATE TYPE "public"."tipo_pendiente" AS ENUM('tratamiento_sin_turno', 'presupuesto_sin_respuesta', 'ausente_sin_reprogramar', 'control_periodico', 'conversacion_sin_respuesta', 'manual');--> statement-breakpoint
CREATE TYPE "public"."tipo_registro_clinico" AS ENUM('anamnesis', 'evolucion', 'diagnostico', 'odontograma', 'plan_tratamiento', 'consentimiento', 'adjunto', 'enmienda');--> statement-breakpoint
CREATE TABLE "adjuntos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"ambito" "ambito_adjunto" NOT NULL,
	"historia_clinica_id" uuid,
	"pieza" smallint,
	"storage_key" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"tipo_mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"nombre_original" text NOT NULL,
	"descripcion" text,
	"subido_por" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjuntos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "adjuntos_clinicos_en_hc" CHECK ("adjuntos"."ambito" <> 'clinico' or "adjuntos"."historia_clinica_id" is not null),
	CONSTRAINT "adjuntos_pieza_fdi" CHECK ("adjuntos"."pieza" is null or ((pieza / 10 between 1 and 4 and pieza % 10 between 1 and 8) or (pieza / 10 between 5 and 8 and pieza % 10 between 1 and 5)))
);
--> statement-breakpoint
CREATE TABLE "alertas_medicas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"tipo" "tipo_alerta_medica" NOT NULL,
	"descripcion" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"registrada_por" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"desactivada_en" timestamp with time zone,
	"desactivada_por" uuid
);
--> statement-breakpoint
CREATE TABLE "aranceles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"financiador_id" uuid NOT NULL,
	"prestacion_codigo" text NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"vigente_desde" date NOT NULL,
	CONSTRAINT "aranceles_vigencia" UNIQUE("financiador_id","prestacion_codigo","vigente_desde")
);
--> statement-breakpoint
CREATE TABLE "auditoria_accesos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"usuario_id" uuid NOT NULL,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text,
	"paciente_id" uuid,
	"ip" text,
	"user_agent" text,
	"detalle" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "borradores_clinicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"historia_clinica_id" uuid NOT NULL,
	"autor_id" uuid NOT NULL,
	"tipo" "tipo_registro_clinico" NOT NULL,
	"contenido" jsonb NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financiadores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"es_particular" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "financiadores_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "historias_clinicas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" integer GENERATED ALWAYS AS IDENTITY (sequence name "historias_clinicas_numero_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"paciente_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "historias_clinicas_numero_unique" UNIQUE("numero"),
	CONSTRAINT "historias_clinicas_paciente_id_unique" UNIQUE("paciente_id")
);
--> statement-breakpoint
CREATE TABLE "marcas_odontograma" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registro_id" uuid NOT NULL,
	"historia_clinica_id" uuid NOT NULL,
	"pieza" smallint NOT NULL,
	"cara" "cara_dental",
	"hallazgo" "hallazgo_dental" NOT NULL,
	"estado" "estado_marca" NOT NULL,
	"reemplaza_a" uuid,
	"anulacion" boolean DEFAULT false NOT NULL,
	"prestacion_codigo" text,
	"registrada_en" timestamp with time zone NOT NULL,
	CONSTRAINT "marcas_odontograma_reemplazo_unico" UNIQUE("reemplaza_a"),
	CONSTRAINT "marcas_odontograma_pieza_fdi" CHECK ((pieza / 10 between 1 and 4 and pieza % 10 between 1 and 8) or (pieza / 10 between 5 and 8 and pieza % 10 between 1 and 5)),
	CONSTRAINT "marcas_odontograma_anulacion" CHECK (not "marcas_odontograma"."anulacion" or "marcas_odontograma"."reemplaza_a" is not null)
);
--> statement-breakpoint
CREATE TABLE "nomenclador_prestaciones" (
	"codigo" text PRIMARY KEY NOT NULL,
	"descripcion" text NOT NULL,
	"requiere_pieza" boolean DEFAULT false NOT NULL,
	"requiere_cara" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notas_administrativas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"texto" text NOT NULL,
	"autor_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "paciente_coberturas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"financiador_id" uuid NOT NULL,
	"numero_afiliado" text,
	"plan" text,
	"vigente_desde" date NOT NULL,
	"vigente_hasta" date,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pacientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo_documento" text DEFAULT 'DNI' NOT NULL,
	"numero_documento" text NOT NULL,
	"nombre" text NOT NULL,
	"apellido" text NOT NULL,
	"fecha_nacimiento" date NOT NULL,
	"telefono" text,
	"email" text,
	"foto_key" text,
	"acepta_mensajes" boolean DEFAULT false NOT NULL,
	"acepta_mensajes_en" timestamp with time zone,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL,
	CONSTRAINT "pacientes_documento_unico" UNIQUE("tipo_documento","numero_documento")
);
--> statement-breakpoint
CREATE TABLE "pendiente_acciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pendiente_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"canal" "canal_contacto" NOT NULL,
	"resultado" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pendientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"tipo" "tipo_pendiente" NOT NULL,
	"estado" "estado_pendiente" DEFAULT 'abierto' NOT NULL,
	"responsable_id" uuid,
	"detalle" text NOT NULL,
	"desde" timestamp with time zone NOT NULL,
	"vence_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelto_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_prestaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"prestacion_codigo" text NOT NULL,
	"pieza" smallint,
	"caras" "cara_dental"[],
	"financiador_id" uuid NOT NULL,
	"estado" "estado_prestacion" DEFAULT 'propuesta' NOT NULL,
	"numero_autorizacion" text,
	"importe" numeric(12, 2),
	"marca_id" uuid,
	"indicada_por" uuid NOT NULL,
	"registro_realizacion_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"realizada_en" timestamp with time zone,
	CONSTRAINT "plan_prestaciones_pieza_fdi" CHECK ("plan_prestaciones"."pieza" is null or ((pieza / 10 between 1 and 4 and pieza % 10 between 1 and 8) or (pieza / 10 between 5 and 8 and pieza % 10 between 1 and 5))),
	CONSTRAINT "plan_prestaciones_realizada" CHECK ("plan_prestaciones"."estado" <> 'realizada' or "plan_prestaciones"."registro_realizacion_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "plantillas_consentimiento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procedimiento" text NOT NULL,
	"version" integer NOT NULL,
	"texto" text NOT NULL,
	"vigente" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plantillas_consentimiento_version" UNIQUE("procedimiento","version")
);
--> statement-breakpoint
CREATE TABLE "presupuesto_items" (
	"presupuesto_id" uuid NOT NULL,
	"plan_prestacion_id" uuid NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	CONSTRAINT "presupuesto_items_presupuesto_id_plan_prestacion_id_pk" PRIMARY KEY("presupuesto_id","plan_prestacion_id")
);
--> statement-breakpoint
CREATE TABLE "presupuestos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"entregado_en" timestamp with time zone,
	"respuesta" "respuesta_presupuesto" DEFAULT 'pendiente' NOT NULL,
	"respondido_en" timestamp with time zone,
	"creado_por" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profesional_especialidades" (
	"usuario_id" uuid NOT NULL,
	"especialidad" "especialidad" NOT NULL,
	CONSTRAINT "profesional_especialidades_usuario_id_especialidad_pk" PRIMARY KEY("usuario_id","especialidad")
);
--> statement-breakpoint
CREATE TABLE "profesionales" (
	"usuario_id" uuid PRIMARY KEY NOT NULL,
	"matricula" text NOT NULL,
	CONSTRAINT "profesionales_matricula_unique" UNIQUE("matricula")
);
--> statement-breakpoint
CREATE TABLE "registros_clinicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"historia_clinica_id" uuid NOT NULL,
	"secuencia" integer NOT NULL,
	"tipo" "tipo_registro_clinico" NOT NULL,
	"contenido" jsonb NOT NULL,
	"autor_id" uuid NOT NULL,
	"especialidad" "especialidad",
	"turno_id" uuid,
	"enmienda_de" uuid,
	"firmado_en" timestamp with time zone NOT NULL,
	"hash_anterior" char(64) NOT NULL,
	"hash" char(64) NOT NULL,
	"metodo_firma" "metodo_firma" DEFAULT 'electronica' NOT NULL,
	"firma_digital" text,
	CONSTRAINT "registros_clinicos_hash_unique" UNIQUE("hash"),
	CONSTRAINT "registros_clinicos_secuencia_unica" UNIQUE("historia_clinica_id","secuencia"),
	CONSTRAINT "registros_clinicos_enmienda" CHECK (("registros_clinicos"."tipo" = 'enmienda') = ("registros_clinicos"."enmienda_de" is not null)),
	CONSTRAINT "registros_clinicos_hash_hex" CHECK ("registros_clinicos"."hash" ~ '^[0-9a-f]{64}$' and "registros_clinicos"."hash_anterior" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "registros_clinicos_firma_digital" CHECK (("registros_clinicos"."metodo_firma" = 'digital') = ("registros_clinicos"."firma_digital" is not null))
);
--> statement-breakpoint
CREATE TABLE "sillones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "sillones_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "turno_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turno_id" uuid NOT NULL,
	"estado_anterior" "estado_turno",
	"estado_nuevo" "estado_turno" NOT NULL,
	"usuario_id" uuid NOT NULL,
	"nota" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turnos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paciente_id" uuid NOT NULL,
	"profesional_id" uuid NOT NULL,
	"sillon_id" uuid,
	"inicio" timestamp with time zone NOT NULL,
	"fin" timestamp with time zone NOT NULL,
	"estado" "estado_turno" DEFAULT 'reservado' NOT NULL,
	"motivo" text,
	"reprograma_a" uuid,
	"creado_por" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turnos_fin_despues_de_inicio" CHECK ("turnos"."fin" > "turnos"."inicio")
);
--> statement-breakpoint
CREATE TABLE "usuario_roles" (
	"usuario_id" uuid NOT NULL,
	"rol" "rol" NOT NULL,
	CONSTRAINT "usuario_roles_usuario_id_rol_pk" PRIMARY KEY("usuario_id","rol")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"apellido" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_historia_clinica_id_historias_clinicas_id_fk" FOREIGN KEY ("historia_clinica_id") REFERENCES "public"."historias_clinicas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_subido_por_usuarios_id_fk" FOREIGN KEY ("subido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alertas_medicas" ADD CONSTRAINT "alertas_medicas_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alertas_medicas" ADD CONSTRAINT "alertas_medicas_registrada_por_profesionales_usuario_id_fk" FOREIGN KEY ("registrada_por") REFERENCES "public"."profesionales"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alertas_medicas" ADD CONSTRAINT "alertas_medicas_desactivada_por_profesionales_usuario_id_fk" FOREIGN KEY ("desactivada_por") REFERENCES "public"."profesionales"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aranceles" ADD CONSTRAINT "aranceles_financiador_id_financiadores_id_fk" FOREIGN KEY ("financiador_id") REFERENCES "public"."financiadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aranceles" ADD CONSTRAINT "aranceles_prestacion_codigo_nomenclador_prestaciones_codigo_fk" FOREIGN KEY ("prestacion_codigo") REFERENCES "public"."nomenclador_prestaciones"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria_accesos" ADD CONSTRAINT "auditoria_accesos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria_accesos" ADD CONSTRAINT "auditoria_accesos_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borradores_clinicos" ADD CONSTRAINT "borradores_clinicos_historia_clinica_id_historias_clinicas_id_fk" FOREIGN KEY ("historia_clinica_id") REFERENCES "public"."historias_clinicas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borradores_clinicos" ADD CONSTRAINT "borradores_clinicos_autor_id_profesionales_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."profesionales"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historias_clinicas" ADD CONSTRAINT "historias_clinicas_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marcas_odontograma" ADD CONSTRAINT "marcas_odontograma_registro_id_registros_clinicos_id_fk" FOREIGN KEY ("registro_id") REFERENCES "public"."registros_clinicos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marcas_odontograma" ADD CONSTRAINT "marcas_odontograma_historia_clinica_id_historias_clinicas_id_fk" FOREIGN KEY ("historia_clinica_id") REFERENCES "public"."historias_clinicas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marcas_odontograma" ADD CONSTRAINT "marcas_odontograma_reemplaza_a_marcas_odontograma_id_fk" FOREIGN KEY ("reemplaza_a") REFERENCES "public"."marcas_odontograma"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marcas_odontograma" ADD CONSTRAINT "marcas_odontograma_prestacion_codigo_nomenclador_prestaciones_codigo_fk" FOREIGN KEY ("prestacion_codigo") REFERENCES "public"."nomenclador_prestaciones"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas_administrativas" ADD CONSTRAINT "notas_administrativas_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas_administrativas" ADD CONSTRAINT "notas_administrativas_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paciente_coberturas" ADD CONSTRAINT "paciente_coberturas_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paciente_coberturas" ADD CONSTRAINT "paciente_coberturas_financiador_id_financiadores_id_fk" FOREIGN KEY ("financiador_id") REFERENCES "public"."financiadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ADD CONSTRAINT "pendiente_acciones_pendiente_id_pendientes_id_fk" FOREIGN KEY ("pendiente_id") REFERENCES "public"."pendientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendiente_acciones" ADD CONSTRAINT "pendiente_acciones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendientes" ADD CONSTRAINT "pendientes_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendientes" ADD CONSTRAINT "pendientes_responsable_id_usuarios_id_fk" FOREIGN KEY ("responsable_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prestaciones" ADD CONSTRAINT "plan_prestaciones_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prestaciones" ADD CONSTRAINT "plan_prestaciones_prestacion_codigo_nomenclador_prestaciones_codigo_fk" FOREIGN KEY ("prestacion_codigo") REFERENCES "public"."nomenclador_prestaciones"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prestaciones" ADD CONSTRAINT "plan_prestaciones_financiador_id_financiadores_id_fk" FOREIGN KEY ("financiador_id") REFERENCES "public"."financiadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prestaciones" ADD CONSTRAINT "plan_prestaciones_marca_id_marcas_odontograma_id_fk" FOREIGN KEY ("marca_id") REFERENCES "public"."marcas_odontograma"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prestaciones" ADD CONSTRAINT "plan_prestaciones_indicada_por_profesionales_usuario_id_fk" FOREIGN KEY ("indicada_por") REFERENCES "public"."profesionales"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prestaciones" ADD CONSTRAINT "plan_prestaciones_registro_realizacion_id_registros_clinicos_id_fk" FOREIGN KEY ("registro_realizacion_id") REFERENCES "public"."registros_clinicos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_presupuesto_id_presupuestos_id_fk" FOREIGN KEY ("presupuesto_id") REFERENCES "public"."presupuestos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_plan_prestacion_id_plan_prestaciones_id_fk" FOREIGN KEY ("plan_prestacion_id") REFERENCES "public"."plan_prestaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profesional_especialidades" ADD CONSTRAINT "profesional_especialidades_usuario_id_profesionales_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."profesionales"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registros_clinicos" ADD CONSTRAINT "registros_clinicos_historia_clinica_id_historias_clinicas_id_fk" FOREIGN KEY ("historia_clinica_id") REFERENCES "public"."historias_clinicas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registros_clinicos" ADD CONSTRAINT "registros_clinicos_autor_id_profesionales_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."profesionales"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registros_clinicos" ADD CONSTRAINT "registros_clinicos_turno_id_turnos_id_fk" FOREIGN KEY ("turno_id") REFERENCES "public"."turnos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registros_clinicos" ADD CONSTRAINT "registros_clinicos_enmienda_de_registros_clinicos_id_fk" FOREIGN KEY ("enmienda_de") REFERENCES "public"."registros_clinicos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turno_eventos" ADD CONSTRAINT "turno_eventos_turno_id_turnos_id_fk" FOREIGN KEY ("turno_id") REFERENCES "public"."turnos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turno_eventos" ADD CONSTRAINT "turno_eventos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_paciente_id_pacientes_id_fk" FOREIGN KEY ("paciente_id") REFERENCES "public"."pacientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_profesional_id_profesionales_usuario_id_fk" FOREIGN KEY ("profesional_id") REFERENCES "public"."profesionales"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_sillon_id_sillones_id_fk" FOREIGN KEY ("sillon_id") REFERENCES "public"."sillones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_reprograma_a_turnos_id_fk" FOREIGN KEY ("reprograma_a") REFERENCES "public"."turnos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjuntos_paciente_idx" ON "adjuntos" USING btree ("paciente_id");--> statement-breakpoint
CREATE INDEX "auditoria_paciente_idx" ON "auditoria_accesos" USING btree ("paciente_id","creado_en");--> statement-breakpoint
CREATE INDEX "auditoria_usuario_idx" ON "auditoria_accesos" USING btree ("usuario_id","creado_en");--> statement-breakpoint
CREATE INDEX "marcas_odontograma_hc_idx" ON "marcas_odontograma" USING btree ("historia_clinica_id","registrada_en");--> statement-breakpoint
CREATE INDEX "paciente_coberturas_paciente_idx" ON "paciente_coberturas" USING btree ("paciente_id");--> statement-breakpoint
CREATE INDEX "pacientes_apellido_nombre_idx" ON "pacientes" USING btree ("apellido","nombre");--> statement-breakpoint
CREATE INDEX "pendientes_abiertos_idx" ON "pendientes" USING btree ("estado","responsable_id");--> statement-breakpoint
CREATE INDEX "plan_prestaciones_paciente_idx" ON "plan_prestaciones" USING btree ("paciente_id","estado");--> statement-breakpoint
CREATE INDEX "turnos_profesional_inicio_idx" ON "turnos" USING btree ("profesional_id","inicio");--> statement-breakpoint
CREATE INDEX "turnos_paciente_idx" ON "turnos" USING btree ("paciente_id");