# Graph Report - backticonvivencia  (2026-09-02)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 855 nodes · 1652 edges · 55 communities (37 shown, 10 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 242 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `03097928`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- flujoProtocolo.js
- registros.controller.js
- protocolosActivados.controller.js
- dependencies
- documents.routes.js
- protocolos_workflow.sql
- documentosInstitucionales.routes.js
- verifyToken
- auth.js
- permisos.js
- connection.js
- usuarios.controller.js
- cursos.routes.js
- informeExpulsion.controller.js
- establecimiento.controller.js
- establecimientosGeo.routes.js
- involucrados.controller.js
- medidasProteccion.controller.js
- expediente.controller.js
- sostenedor.routes.js
- suspensionCautelar.controller.js
- Circular 482/2018 sobre Reglamentos Internos
- protocolosEstablecimiento.routes.js
- tiposFalta.routes.js
- feriados.routes.js
- Plan de Gestión de Convivencia Escolar
- comunas.routes.js
- paises.routes.js
- protocolosGenericos.routes.js
- Principios que deben respetar los Reglamentos Internos
- medidasDisciplinarias.controller.js
- medidasProteccion.routes.js
- REX 324/2026 que deroga REX 781, 782 y 202
- Ley N° 20.084 de Responsabilidad Penal Adolescente
- Graduación de faltas según gravedad
- Flujo de digitalización de actas (OCR→LLM)
- ocr-vision.swift
- CATALOGO_PROTOCOLO_PASO
- MEDIDA_DISCIPLINARIA
- USUARIO
- MEDIDA_DISCIPLINARIA
- MEDIDA_PROTECCION_SEGUIMIENTO
- NOTIFICACION
- PROTOCOLO_ACTIVADO_EVENTO
- PROTOCOLO_ACTIVADO_PASO
- PROTOCOLO_ESTABLECIMIENTO_PASO
- REGISTRO_ESTUDIANTE

## God Nodes (most connected - your core abstractions)
1. `verifyToken()` - 33 edges
2. `Permiso` - 32 edges
3. `requirePermission()` - 31 edges
4. `resolverScope()` - 21 edges
5. `requireEstablecimiento()` - 18 edges
6. `buscarProtocoloEstablecimiento()` - 15 edges
7. `esAdmin()` - 15 edges
8. `comprimirArchivo()` - 14 edges
9. `validarCondicion()` - 13 edges
10. `cargarFeriados()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Rol ENCARGADO` --implements--> `Encargado de Convivencia Escolar`  [INFERRED]
  README.md → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt
- `Protocolos genéricos (catálogo global)` --implements--> `Protocolos de actuación de contenido mínimo (Anexos 1-6)`  [INFERRED]
  README.md → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt
- `REGISTRO_CONVIVENCIA` --conceptually_related_to--> `Justo y racional procedimiento`  [INFERRED]
  README.md → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt
- `Catálogo de tipos de falta por establecimiento` --implements--> `Graduación de faltas según gravedad`  [INFERRED]
  README.md → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt
- `Protocolo de retención y apoyo (contenido mínimo)` --semantically_similar_to--> `Protocolo de retención y apoyo a estudiantes padres, madres y embarazadas`  [INFERRED] [semantically similar]
  docs/normativa/14-Circular-193-2018-embarazadas-madres-padres.OCR.txt → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Contenido mínimo del Reglamento Interno (Circular 482/2018)** — docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_reglamento_interno, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_graduacion_faltas, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_medidas_disciplinarias, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_protocolos_actuacion, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_plan_gestion_convivencia, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_encargado_convivencia, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_protocolo_retencion_embarazo [EXTRACTED 1.00]
- **Flujo OCR→LLM→transacción de digitalización de actas** — readme_flujo_digitalizacion_actas, readme_documentai_service, readme_gemini_service, readme_catalogos_para_resolver_ids, readme_registro_convivencia, readme_documento_digitalizado, readme_registro_estudiante, readme_revision_humana_confirmar [EXTRACTED 1.00]
- **Transición normativa hacia la Ley 21.809 de Convivencia Educativa** — docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_rex324, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_ley_21809, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_rex781, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_rex782, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_rex202, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_continuidad_regulatoria, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_circular482 [EXTRACTED 1.00]

## Communities (55 total, 10 thin omitted)

### Community 0 - "flujoProtocolo.js"
Cohesion: 0.05
Nodes (88): CAMPO_APELACION, CAMPOS_DESCARGOS, CATALOGO, CICLO_SEGUIMIENTO, debeRecargar(), DRY, main(), ORGANISMOS (+80 more)

### Community 1 - "registros.controller.js"
Cohesion: 0.05
Nodes (56): getResumen(), pool, { puedeVerConfidencial }, buscar(), { COLUMNAS_ESTADO_PROTOCOLO }, consultarRut(), create(), getAll() (+48 more)

### Community 2 - "protocolosActivados.controller.js"
Cohesion: 0.08
Nodes (50): activar(), agregarNota(), anular(), aprobarPaso(), avanzar(), buscarActivado(), buscarPasoActivado(), buscarPasoActivadoEn() (+42 more)

### Community 3 - "dependencies"
Cohesion: 0.05
Nodes (38): bcryptjs, cors, dotenv, express, @google-cloud/documentai, @google/generative-ai, heic-convert, jsonwebtoken (+30 more)

### Community 4 - "documents.routes.js"
Cohesion: 0.06
Nodes (33): verificarPermisos(), { comprimirArchivo }, db, { estructurarTextoOCR }, { normalizarImagen }, obtenerPorRegistro(), { procesarDocumento }, subirDocumento() (+25 more)

### Community 5 - "protocolos_workflow.sql"
Cohesion: 0.09
Nodes (34): CATALOGO_PROTOCOLOS_GENERICOS, MEDIDA_DISCIPLINARIA, PROTOCOLO_ACTIVADO_INVOLUCRADO, PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO, PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO_ARCHIVO, ESTABLECIMIENTO, ESTUDIANTE, PROTOCOLO_ACTIVADO (+26 more)

### Community 6 - "documentosInstitucionales.routes.js"
Cohesion: 0.08
Nodes (32): adjuntarFirmada(), buscarDoc(), { comprimirArchivo }, crear(), getAll(), getConstancias(), pool, publicar() (+24 more)

### Community 7 - "verifyToken"
Cohesion: 0.08
Nodes (28): getAll(), getContador(), marcarLeida(), marcarTodasLeidas(), pool, create(), getAll(), pool (+20 more)

### Community 8 - "auth.js"
Cohesion: 0.14
Nodes (28): CODIGO_POR_ID, codigoDe(), alcanceValido(), { CODIGO_POR_ID, codigoDe }, create(), derivarCodigo(), { esAdmin }, getAll() (+20 more)

### Community 9 - "permisos.js"
Cohesion: 0.10
Nodes (24): Permiso, { esAdmin }, requireEstablecimiento(), resolverScope(), { getMine, updateMine }, { Permiso }, { resolverScope, requireEstablecimiento }, router (+16 more)

### Community 10 - "connection.js"
Cohesion: 0.09
Nodes (22): bcrypt, cambiarPassword(), jwt, login(), me(), pool, mysql, pool (+14 more)

### Community 11 - "usuarios.controller.js"
Cohesion: 0.13
Nodes (25): asignarRol(), bcrypt, create(), { generarPassword }, getAll(), getRoles(), { Permiso }, pool (+17 more)

### Community 12 - "cursos.routes.js"
Cohesion: 0.13
Nodes (21): create(), crypto, eliminarTodos(), getAll(), getProgresoImportacion(), importarExcel(), importJobs, normalizarGrado() (+13 more)

### Community 13 - "informeExpulsion.controller.js"
Cohesion: 0.15
Nodes (19): actualizar(), buscarInforme(), { calcularFechaLimite }, CAMPOS_EXIGIDOS, { cargarFeriados }, comisionDe(), decidir(), emitir() (+11 more)

### Community 14 - "establecimiento.controller.js"
Cohesion: 0.13
Nodes (17): TIPOS_FALTA_PLANTILLA, bcrypt, create(), getAll(), getById(), getMine(), pool, remove() (+9 more)

### Community 15 - "establecimientosGeo.routes.js"
Cohesion: 0.14
Nodes (19): cambiarAcceso(), create(), crypto, getAll(), getProgresoImportacion(), importarExcel(), importJobs, normalizar() (+11 more)

### Community 16 - "involucrados.controller.js"
Cohesion: 0.20
Nodes (19): adjuntarActaFirmada(), agregar(), buscarActivado(), buscarGestion(), cambiarRol(), { comprimirArchivo }, descargarActaFirmada(), getByCaso() (+11 more)

### Community 17 - "medidasProteccion.controller.js"
Cohesion: 0.18
Nodes (16): crear(), actualizar(), buscarCaso(), { calcularFechaLimite }, { cargarFeriados }, crear(), getByCaso(), notificaciones (+8 more)

### Community 18 - "expediente.controller.js"
Cohesion: 0.24
Nodes (15): armarExpediente(), cumplimientoDe(), exportarMasivo(), formatear(), getExpediente(), inicialesDe(), motivoCierreDe(), { pasosDescartados } (+7 more)

### Community 19 - "sostenedor.routes.js"
Cohesion: 0.21
Nodes (13): asignarEstablecimiento(), create(), desasignarEstablecimiento(), getAll(), getById(), getEstablecimientos(), pool, remove() (+5 more)

### Community 20 - "suspensionCautelar.controller.js"
Cohesion: 0.22
Nodes (14): ABIERTAS, actualizar(), aISO(), buscarCaso(), buscarSuspension(), { calcularFechaLimite }, { cargarFeriados }, crear() (+6 more)

### Community 21 - "Circular 482/2018 sobre Reglamentos Internos"
Cohesion: 0.17
Nodes (13): Circular 482/2018 sobre Reglamentos Internos, Ley N° 20.529 (LSAC), Ley N° 20.845 de Inclusión Escolar, Ley General de Educación (DFL N° 2 de 2009), Modelo de fiscalización con enfoque en derechos (REX 137/2018), Protocolo de retención y apoyo a estudiantes padres, madres y embarazadas, Artículo 11 LGE: embarazo y maternidad no impiden permanecer, Circular 193/2018 de alumnas embarazadas, madres y padres estudiantes (+5 more)

### Community 22 - "protocolosEstablecimiento.routes.js"
Cohesion: 0.22
Nodes (11): create(), createPropio(), getAll(), pool, remove(), update(), { getAll, create, createPropio, update, remove }, { Permiso } (+3 more)

### Community 23 - "tiposFalta.routes.js"
Cohesion: 0.22
Nodes (11): create(), getAll(), pool, remove(), setProtocolos(), update(), { getAll, create, update, remove, setProtocolos }, { Permiso } (+3 more)

### Community 24 - "feriados.routes.js"
Cohesion: 0.24
Nodes (10): create(), getAll(), { invalidarCache }, pool, remove(), { getAll, create, remove }, { Permiso }, router (+2 more)

### Community 25 - "Plan de Gestión de Convivencia Escolar"
Cohesion: 0.18
Nodes (11): Encargado de Convivencia Escolar, Plan de Gestión de Convivencia Escolar, Artículos 16 D a 16 H (Planes de Gestión y Reglamentos Internos), Ley N° 21.809 de Convivencia Educativa, Entrada en vigencia 01-07-2026 y plazo de 9 meses, Autenticación JWT con req.user, MiConvivencia Backend API, Aislamiento multi-tenant por id_establecimiento (+3 more)

### Community 26 - "comunas.routes.js"
Cohesion: 0.25
Nodes (9): create(), getAll(), pool, remove(), update(), { getAll, create, update, remove }, { Permiso }, router (+1 more)

### Community 27 - "paises.routes.js"
Cohesion: 0.25
Nodes (9): create(), getAll(), pool, remove(), update(), { getAll, create, update, remove }, { Permiso }, router (+1 more)

### Community 28 - "protocolosGenericos.routes.js"
Cohesion: 0.25
Nodes (9): create(), getAll(), pool, remove(), update(), { getAll, create, update, remove }, { Permiso }, router (+1 more)

### Community 29 - "Principios que deben respetar los Reglamentos Internos"
Cohesion: 0.25
Nodes (9): Justo y racional procedimiento, Principios que deben respetar los Reglamentos Internos, Protocolos de actuación de contenido mínimo (Anexos 1-6), Reglamento Interno del establecimiento, Regla especial para delitos sexuales (Art. 4), Protocolos activados sobre un registro, Protocolos genéricos (catálogo global), REGISTRO_CONVIVENCIA (+1 more)

### Community 30 - "medidasDisciplinarias.controller.js"
Cohesion: 0.25
Nodes (6): { calcularFechaLimite }, { cargarFeriados }, pool, registrarResultado(), TIPOS_CON_PLAZO, TIPOS_MEDIDA

### Community 31 - "medidasProteccion.routes.js"
Cohesion: 0.25
Nodes (7): finalizar(), registrarSeguimiento(), { actualizar, finalizar, registrarSeguimiento }, { Permiso }, { resolverScope, requireEstablecimiento }, router, { verifyToken, requirePermission }

### Community 32 - "REX 324/2026 que deroga REX 781, 782 y 202"
Cohesion: 0.29
Nodes (7): Medidas disciplinarias y procedimientos, Continuidad regulatoria: 482/2018 y 860/2018 siguen vigentes, Ley N° 21.430 sobre garantías y protección integral de la niñez, REX 202/2026 (circular reglamentos internos educación parvularia, derogada), REX 324/2026 que deroga REX 781, 782 y 202, REX 781/2025 (circular reglamentos internos, derogada), REX 782/2025 (circular medidas formativas y disciplinarias, derogada)

### Community 33 - "Ley N° 20.084 de Responsabilidad Penal Adolescente"
Cohesion: 0.33
Nodes (6): Convención sobre los Derechos del Niño (Decreto 830/1990), Interés superior del niño, niña y adolescente, Interés superior del adolescente (Art. 2), Ley N° 20.084 de Responsabilidad Penal Adolescente, Límites de edad: 14 a 18 años (Art. 3), Prescripción: 5 años crímenes, 2 años delitos, 6 meses faltas (Art. 5)

### Community 34 - "Graduación de faltas según gravedad"
Cohesion: 0.40
Nodes (5): Graduación de faltas según gravedad, Proporcionalidad de las medidas disciplinarias, Faltas: solo responsables adolescentes mayores de 16 (Art. 1), Carga de catálogos para que el LLM resuelva IDs, Catálogo de tipos de falta por establecimiento

### Community 35 - "Flujo de digitalización de actas (OCR→LLM)"
Cohesion: 0.50
Nodes (5): documentai.service.js, DOCUMENTO_DIGITALIZADO, Flujo de digitalización de actas (OCR→LLM), gemini.service.js (usa OpenAI, nombre desactualizado), Revisión humana antes de confirmar (PATCH /:id/confirmar)

### Community 36 - "ocr-vision.swift"
Cohesion: 0.50
Nodes (3): AppKit, Foundation, Vision

## Ambiguous Edges - Review These
- `Protocolos de actuación de contenido mínimo (Anexos 1-6)` → `Regla especial para delitos sexuales (Art. 4)`  [AMBIGUOUS]
  docs/normativa/16-Ley-20084-responsabilidad-penal-adolescente.txt · relation: conceptually_related_to
- `Graduación de faltas según gravedad` → `Faltas: solo responsables adolescentes mayores de 16 (Art. 1)`  [AMBIGUOUS]
  docs/normativa/16-Ley-20084-responsabilidad-penal-adolescente.txt · relation: conceptually_related_to

## Knowledge Gaps
- **343 isolated node(s):** `Rol DIRECTOR`, `MiConvivencia Backend API`, `REGISTRO_ESTUDIANTE`, `DOCUMENTO_DIGITALIZADO`, `CAMPO_APELACION` (+338 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 382 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Protocolos de actuación de contenido mínimo (Anexos 1-6)` and `Regla especial para delitos sexuales (Art. 4)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Graduación de faltas según gravedad` and `Faltas: solo responsables adolescentes mayores de 16 (Art. 1)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Permiso` connect `permisos.js` to `flujoProtocolo.js`, `registros.controller.js`, `protocolosActivados.controller.js`, `documents.routes.js`, `documentosInstitucionales.routes.js`, `verifyToken`, `auth.js`, `usuarios.controller.js`, `cursos.routes.js`, `informeExpulsion.controller.js`, `establecimiento.controller.js`, `establecimientosGeo.routes.js`, `sostenedor.routes.js`, `protocolosEstablecimiento.routes.js`, `tiposFalta.routes.js`, `feriados.routes.js`, `comunas.routes.js`, `paises.routes.js`, `protocolosGenericos.routes.js`, `medidasProteccion.routes.js`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `verifyToken()` connect `verifyToken` to `flujoProtocolo.js`, `registros.controller.js`, `protocolosActivados.controller.js`, `documents.routes.js`, `documentosInstitucionales.routes.js`, `auth.js`, `permisos.js`, `connection.js`, `usuarios.controller.js`, `cursos.routes.js`, `informeExpulsion.controller.js`, `establecimiento.controller.js`, `establecimientosGeo.routes.js`, `sostenedor.routes.js`, `protocolosEstablecimiento.routes.js`, `tiposFalta.routes.js`, `feriados.routes.js`, `comunas.routes.js`, `paises.routes.js`, `protocolosGenericos.routes.js`, `medidasProteccion.routes.js`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `requirePermission()` connect `auth.js` to `flujoProtocolo.js`, `registros.controller.js`, `protocolosActivados.controller.js`, `documents.routes.js`, `documentosInstitucionales.routes.js`, `verifyToken`, `permisos.js`, `usuarios.controller.js`, `cursos.routes.js`, `informeExpulsion.controller.js`, `establecimiento.controller.js`, `establecimientosGeo.routes.js`, `sostenedor.routes.js`, `protocolosEstablecimiento.routes.js`, `tiposFalta.routes.js`, `feriados.routes.js`, `comunas.routes.js`, `paises.routes.js`, `protocolosGenericos.routes.js`, `medidasProteccion.routes.js`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `Rol DIRECTOR`, `MiConvivencia Backend API`, `REGISTRO_ESTUDIANTE` to the rest of the system?**
  _343 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `flujoProtocolo.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05049442457395329 - nodes in this community are weakly interconnected._