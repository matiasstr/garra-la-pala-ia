CREATE TABLE "archivos" (
	"clave" text PRIMARY KEY NOT NULL,
	"sha256" char(64) NOT NULL,
	"tipo_mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"contenido" "bytea" NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archivos_huella" CHECK ("archivos"."sha256" = encode(sha256("archivos"."contenido"), 'hex')),
	CONSTRAINT "archivos_clave_con_huella" CHECK ("archivos"."clave" like '%/' || "archivos"."sha256" || '.%'),
	CONSTRAINT "archivos_tamanio" CHECK ("archivos"."bytes" = octet_length("archivos"."contenido"))
);
