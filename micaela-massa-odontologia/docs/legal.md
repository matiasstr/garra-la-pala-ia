# Requisitos legales y cómo los cumple el sistema

Este documento es una matriz para revisar con un abogado especializado en derecho sanitario. No es asesoramiento legal. Antes de usar el sistema con pacientes reales hay que confirmar cada punto, junto con la normativa de la provincia donde está el consultorio.

| Requisito | Norma | Control en el sistema | Dónde |
| --- | --- | --- | --- |
| La historia clínica es inalterable | Ley 26.529 arts. 13 y 18; Ley 27.706 | Triggers que bloquean `UPDATE`, `DELETE` y `TRUNCATE`. Correcciones como enmiendas, solo del autor, vinculadas al original. Los borradores no son historia clínica hasta que se firman | `drizzle/0001_inalterabilidad.sql`, `firmarEnmienda` |
| Integridad verificable | Ley 27.706 y Dec. 393/2023 (autenticidad, inalterabilidad) | Cadena SHA-256 por historia clínica, verificada cada vez que se abre y mostrada en pantalla. Cada adjunto queda citado por su SHA-256 en un registro firmado y se vuelve a comprobar al verlo | `src/domain/firma/encadenamiento.ts`, `leerAdjuntoClinico` |
| Cada asiento con fecha, firma e identificación del profesional | Ley 26.529 art. 15 | Solo firma un profesional activo con matrícula, con fecha y hora en la firma. Nombre y matrícula quedan dentro del contenido firmado | `puedeFirmarRegistroClinico`, `firmarRegistro`, `firmanteDe` |
| Firma digital o electrónica | Ley 25.506; Dec. 1089/2012 art. 13; Dec. 393/2023 | Hoy, firma electrónica: cada firma pide el PIN personal del profesional (guardado solo como huella scrypt, bloqueo tras 5 intentos) y muestra el paciente para confirmar. Columnas preparadas para firma digital CMS | `src/server/hc/pin.ts`, `registros_clinicos.metodo_firma` |
| Una sola historia clínica por paciente | Ley 26.529 art. 17 | `historias_clinicas.paciente_id` único. La base impide adjuntar un archivo o vincular un turno de otro paciente | `src/db/schema.ts`, `drizzle/0004_historia_clinica_sql.sql` |
| Acceso restringido | Ley 26.529 arts. 2 y 13; secreto profesional | Permisos por rol. La secretaria no accede a la historia clínica ni a sus adjuntos (ni por enlace directo); solo ve las alertas médicas. Los adjuntos no quedan en cachés | `src/domain/permisos/permisos.ts`, `verHistoriaClinica` |
| Trazabilidad de accesos | Ley 27.706 (trazabilidad) | Auditoría de solo agregar, con IP y navegador: cada apertura de la historia clínica, cada firma, cada vez que se ve o descarga un adjunto y cada PIN de firma equivocado | `auditoria_accesos`, `abrirHistoriaClinica`, `leerAdjuntoClinico` |
| Conservación mínima de 10 años | Ley 26.529 art. 18 | Nada se borra. Adjuntos con Object Lock (por implementar) | Triggers; `docs/arquitectura.md` |
| Copia al paciente en 48 horas | Ley 26.529 art. 14 | Exportación a PDF firmado (por implementar) | Permiso `hc.exportar` |
| Consentimiento informado escrito | Ley 26.529 arts. 5 a 7 | Plantillas versionadas e inmutables. Consentimiento firmado como registro clínico | `plantillas_consentimiento` |
| Consentimiento de menores | Código Civil y Comercial art. 26 | Regla según la edad y si el procedimiento es invasivo | `quienConsiente` |
| Datos de salud = datos sensibles | Ley 25.326 | Cifrado en tránsito y en reposo, hosting en un país adecuado o con cláusulas modelo (por definir), base inscripta ante la AAIP | `docs/arquitectura.md` |
| Permiso para mensajes, separado de la atención | Ley 25.326 | `pacientes.acepta_mensajes` con fecha. Recordatorios sin información clínica | `enlaceRecordatorioWhatsApp` |
| Receta electrónica solo por plataformas registradas | Ley 27.553; Res. 2214/2025 (ReNaPDiS) | El sistema no emite recetas: enlaza la plataforma registrada del profesional | Fuera de alcance |

## Tareas del consultorio (no son del sistema)

- [ ] Cada profesional tramita su firma digital remota.
- [ ] Inscribir la base de datos de pacientes ante la AAIP.
- [ ] Redactar con el abogado los modelos de consentimiento por procedimiento, incluidos los de menores.
- [ ] Acuerdo de confidencialidad firmado por cada secretaria.
- [ ] Definir qué pasa con las historias clínicas en papel: se escanean y los originales se conservan.
- [ ] Revisión legal del sistema antes de usarlo con pacientes reales.

## Fuentes

- [Ley 27.706, Ministerio de Salud](https://e-legis-ar.msal.gov.ar/legisalud/migration/pdf/ley27706.pdf)
- [Decreto 393/2023, texto oficial](https://www.argentina.gob.ar/normativa/nacional/decreto-393-2023-387475/texto)
- [Resolución 2214/2025, receta electrónica](https://e-legis-ar.msal.gov.ar/legisalud/migration/pdf/msres2214_2025.pdf)
