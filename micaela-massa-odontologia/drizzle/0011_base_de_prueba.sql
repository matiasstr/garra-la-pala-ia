CREATE TABLE "base_de_prueba" (
	"unica" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_de_prueba_una_fila" CHECK ("base_de_prueba"."unica")
);
