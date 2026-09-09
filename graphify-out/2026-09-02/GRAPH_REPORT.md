# Graph Report - backticonvivencia  (2026-09-02)

## Corpus Check
- 100 files · ~119,535 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 845 nodes · 1676 edges · 46 communities (33 shown, 5 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 241 edges (avg confidence: 0.85)
- Token cost: 79,156 input · 0 output

## Community Hubs (Navigation)
- Motor de Flujo de Protocolos
- Informe de Expulsión y Medidas de Protección
- Dashboard, Estudiantes y Registros
- Establecimientos, Usuarios y Tipos de Falta
- Protocolos Activados (ejecución de casos)
- Autenticación, Sostenedor y Conexión BD
- Dependencias del Proyecto (package.json)
- Bootstrap Express y Documentos OCR
- Esquema SQL del Workflow de Protocolos
- Documentos Institucionales y Constancias
- Feriados y Tipos de Falta
- Expediente y Exportación Masiva
- Cursos e Importación Excel
- Roles y Catálogo de Permisos
- Establecimientos Geo e Importación
- Involucrados y Gestiones del Caso
- Normativa de Embarazo y Retención Escolar
- Middleware JWT y Códigos de Permiso
- Protocolos por Establecimiento
- Ley 21.809 y Arquitectura Multi-tenant
- CRUD de Comunas
- Medidas Disciplinarias
- CRUD de Países
- Protocolos Genéricos (catálogo)
- CRUD de Provincias
- CRUD de Regiones
- Notificaciones
- Reglamento Interno y Debido Proceso
- Derogación REX 324/2026 y Continuidad
- Responsabilidad Penal Adolescente (Ley 20.084)
- Graduación y Proporcionalidad de Faltas
- Digitalización de Actas (OCR + LLM)
- OCR Nativo en Swift (Vision)
- Tabla MEDIDA_DISCIPLINARIA
- Tabla USUARIO
- Tabla MEDIDA_PROTECCION_SEGUIMIENTO
- Tabla NOTIFICACION
- Tabla REGISTRO_ESTUDIANTE

## God Nodes (most connected - your core abstractions)
1. `Permiso` - 33 edges
2. `verifyToken()` - 33 edges
3. `requirePermission()` - 31 edges
4. `resolverScope()` - 21 edges
5. `requireEstablecimiento()` - 18 edges
6. `validarCondicion()` - 16 edges
7. `buscarProtocoloEstablecimiento()` - 15 edges
8. `esAdmin()` - 15 edges
9. `comprimirArchivo()` - 14 edges
10. `cargarFeriados()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Rol ENCARGADO` --implements--> `Encargado de Convivencia Escolar`  [INFERRED]
  README.md → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt
- `REGISTRO_CONVIVENCIA` --conceptually_related_to--> `Justo y racional procedimiento`  [INFERRED]
  README.md → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt
- `Protocolos genéricos (catálogo global)` --implements--> `Protocolos de actuación de contenido mínimo (Anexos 1-6)`  [INFERRED]
  README.md → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt
- `Catálogo de tipos de falta por establecimiento` --implements--> `Graduación de faltas según gravedad`  [INFERRED]
  README.md → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt
- `Protocolo de retención y apoyo (contenido mínimo)` --semantically_similar_to--> `Protocolo de retención y apoyo a estudiantes padres, madres y embarazadas`  [INFERRED] [semantically similar]
  docs/normativa/14-Circular-193-2018-embarazadas-madres-padres.OCR.txt → docs/normativa/03-Circular-482-2018-reglamentos-internos.OCR.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Flujo OCR→LLM→transacción de digitalización de actas** — readme_flujo_digitalizacion_actas, readme_documentai_service, readme_gemini_service, readme_catalogos_para_resolver_ids, readme_registro_convivencia, readme_documento_digitalizado, readme_registro_estudiante, readme_revision_humana_confirmar [EXTRACTED 1.00]
- **Contenido mínimo del Reglamento Interno (Circular 482/2018)** — docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_reglamento_interno, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_graduacion_faltas, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_medidas_disciplinarias, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_protocolos_actuacion, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_plan_gestion_convivencia, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_encargado_convivencia, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_protocolo_retencion_embarazo [EXTRACTED 1.00]
- **Transición normativa hacia la Ley 21.809 de Convivencia Educativa** — docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_rex324, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_ley_21809, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_rex781, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_rex782, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_rex202, docs_normativa_08_rex_324_2026_deroga_circulares_781_782_202_ocr_continuidad_regulatoria, docs_normativa_03_circular_482_2018_reglamentos_internos_ocr_circular482 [EXTRACTED 1.00]

## Communities (46 total, 5 thin omitted)

### Community 0 - "Motor de Flujo de Protocolos"
Cohesion: 0.05
Nodes (89): CAMPO_APELACION, CAMPOS_DESCARGOS, CATALOGO, CICLO_SEGUIMIENTO, debeRecargar(), DRY, main(), ORGANISMOS (+81 more)

### Community 1 - "Informe de Expulsión y Medidas de Protección"
Cohesion: 0.05
Nodes (60): actualizar(), buscarInforme(), { calcularFechaLimite }, CAMPOS_EXIGIDOS, { cargarFeriados }, comisionDe(), decidir(), emitir() (+52 more)

### Community 2 - "Dashboard, Estudiantes y Registros"
Cohesion: 0.05
Nodes (55): getResumen(), pool, { puedeVerConfidencial }, buscar(), { COLUMNAS_ESTADO_PROTOCOLO }, consultarRut(), create(), getAll() (+47 more)

### Community 3 - "Establecimientos, Usuarios y Tipos de Falta"
Cohesion: 0.06
Nodes (49): TIPOS_FALTA_PLANTILLA, bcrypt, create(), getAll(), getById(), getMine(), pool, remove() (+41 more)

### Community 4 - "Protocolos Activados (ejecución de casos)"
Cohesion: 0.08
Nodes (48): activar(), agregarNota(), anular(), aprobarPaso(), avanzar(), buscarActivado(), buscarPasoActivado(), buscarPasoActivadoEn() (+40 more)

### Community 5 - "Autenticación, Sostenedor y Conexión BD"
Cohesion: 0.06
Nodes (34): bcrypt, cambiarPassword(), jwt, login(), me(), pool, asignarEstablecimiento(), create() (+26 more)

### Community 6 - "Dependencias del Proyecto (package.json)"
Cohesion: 0.05
Nodes (38): bcryptjs, cors, dotenv, express, @google-cloud/documentai, @google/generative-ai, heic-convert, jsonwebtoken (+30 more)

### Community 7 - "Bootstrap Express y Documentos OCR"
Cohesion: 0.06
Nodes (33): verificarPermisos(), { comprimirArchivo }, db, { estructurarTextoOCR }, { normalizarImagen }, obtenerPorRegistro(), { procesarDocumento }, subirDocumento() (+25 more)

### Community 8 - "Esquema SQL del Workflow de Protocolos"
Cohesion: 0.09
Nodes (34): CATALOGO_PROTOCOLOS_GENERICOS, MEDIDA_DISCIPLINARIA, PROTOCOLO_ACTIVADO_INVOLUCRADO, PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO, PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO_ARCHIVO, ESTABLECIMIENTO, ESTUDIANTE, PROTOCOLO_ACTIVADO (+26 more)

### Community 9 - "Documentos Institucionales y Constancias"
Cohesion: 0.08
Nodes (32): adjuntarFirmada(), buscarDoc(), { comprimirArchivo }, crear(), getAll(), getConstancias(), pool, publicar() (+24 more)

### Community 10 - "Feriados y Tipos de Falta"
Cohesion: 0.11
Nodes (22): Permiso, create(), getAll(), { invalidarCache }, pool, remove(), create(), getAll() (+14 more)

### Community 11 - "Expediente y Exportación Masiva"
Cohesion: 0.14
Nodes (22): armarExpediente(), cumplimientoDe(), exportarMasivo(), formatear(), getExpediente(), inicialesDe(), motivoCierreDe(), { pasosDescartados } (+14 more)

### Community 12 - "Cursos e Importación Excel"
Cohesion: 0.13
Nodes (21): create(), crypto, eliminarTodos(), getAll(), getProgresoImportacion(), importarExcel(), importJobs, normalizarGrado() (+13 more)

### Community 13 - "Roles y Catálogo de Permisos"
Cohesion: 0.19
Nodes (20): alcanceValido(), { CODIGO_POR_ID, codigoDe }, create(), derivarCodigo(), { esAdmin }, getAll(), getCatalogoPermisos(), getPermisos() (+12 more)

### Community 14 - "Establecimientos Geo e Importación"
Cohesion: 0.14
Nodes (19): cambiarAcceso(), create(), crypto, getAll(), getProgresoImportacion(), importarExcel(), importJobs, normalizar() (+11 more)

### Community 15 - "Involucrados y Gestiones del Caso"
Cohesion: 0.20
Nodes (19): adjuntarActaFirmada(), agregar(), buscarActivado(), buscarGestion(), cambiarRol(), { comprimirArchivo }, descargarActaFirmada(), getByCaso() (+11 more)

### Community 16 - "Normativa de Embarazo y Retención Escolar"
Cohesion: 0.17
Nodes (13): Circular 482/2018 sobre Reglamentos Internos, Ley N° 20.529 (LSAC), Ley N° 20.845 de Inclusión Escolar, Ley General de Educación (DFL N° 2 de 2009), Modelo de fiscalización con enfoque en derechos (REX 137/2018), Protocolo de retención y apoyo a estudiantes padres, madres y embarazadas, Artículo 11 LGE: embarazo y maternidad no impiden permanecer, Circular 193/2018 de alumnas embarazadas, madres y padres estudiantes (+5 more)

### Community 17 - "Middleware JWT y Códigos de Permiso"
Cohesion: 0.22
Nodes (11): CODIGO_POR_ID, codigoDe(), { CODIGO_POR_ID, codigoDe }, ID_POR_CODIGO, jwt, normalizarPermisos(), requirePermission(), requireRole() (+3 more)

### Community 18 - "Protocolos por Establecimiento"
Cohesion: 0.22
Nodes (11): create(), createPropio(), getAll(), pool, remove(), update(), { getAll, create, createPropio, update, remove }, { Permiso } (+3 more)

### Community 19 - "Ley 21.809 y Arquitectura Multi-tenant"
Cohesion: 0.18
Nodes (11): Encargado de Convivencia Escolar, Plan de Gestión de Convivencia Escolar, Artículos 16 D a 16 H (Planes de Gestión y Reglamentos Internos), Ley N° 21.809 de Convivencia Educativa, Entrada en vigencia 01-07-2026 y plazo de 9 meses, Autenticación JWT con req.user, MiConvivencia Backend API, Aislamiento multi-tenant por id_establecimiento (+3 more)

### Community 20 - "CRUD de Comunas"
Cohesion: 0.25
Nodes (9): create(), getAll(), pool, remove(), update(), { getAll, create, update, remove }, { Permiso }, router (+1 more)

### Community 21 - "Medidas Disciplinarias"
Cohesion: 0.20
Nodes (7): pool, registrarResultado(), { Permiso }, { registrarResultado }, { resolverScope, requireEstablecimiento }, router, { verifyToken, requirePermission }

### Community 22 - "CRUD de Países"
Cohesion: 0.25
Nodes (9): create(), getAll(), pool, remove(), update(), { getAll, create, update, remove }, { Permiso }, router (+1 more)

### Community 23 - "Protocolos Genéricos (catálogo)"
Cohesion: 0.25
Nodes (9): create(), getAll(), pool, remove(), update(), { getAll, create, update, remove }, { Permiso }, router (+1 more)

### Community 24 - "CRUD de Provincias"
Cohesion: 0.25
Nodes (9): create(), getAll(), pool, remove(), update(), { getAll, create, update, remove }, { Permiso }, router (+1 more)

### Community 25 - "CRUD de Regiones"
Cohesion: 0.25
Nodes (9): create(), getAll(), pool, remove(), update(), { getAll, create, update, remove }, { Permiso }, router (+1 more)

### Community 26 - "Notificaciones"
Cohesion: 0.29
Nodes (8): getAll(), getContador(), marcarLeida(), marcarTodasLeidas(), pool, {
  getAll, getContador, marcarLeida, marcarTodasLeidas,
}, router, { verifyToken }

### Community 27 - "Reglamento Interno y Debido Proceso"
Cohesion: 0.25
Nodes (9): Justo y racional procedimiento, Principios que deben respetar los Reglamentos Internos, Protocolos de actuación de contenido mínimo (Anexos 1-6), Reglamento Interno del establecimiento, Regla especial para delitos sexuales (Art. 4), Protocolos activados sobre un registro, Protocolos genéricos (catálogo global), REGISTRO_CONVIVENCIA (+1 more)

### Community 28 - "Derogación REX 324/2026 y Continuidad"
Cohesion: 0.29
Nodes (7): Medidas disciplinarias y procedimientos, Continuidad regulatoria: 482/2018 y 860/2018 siguen vigentes, Ley N° 21.430 sobre garantías y protección integral de la niñez, REX 202/2026 (circular reglamentos internos educación parvularia, derogada), REX 324/2026 que deroga REX 781, 782 y 202, REX 781/2025 (circular reglamentos internos, derogada), REX 782/2025 (circular medidas formativas y disciplinarias, derogada)

### Community 29 - "Responsabilidad Penal Adolescente (Ley 20.084)"
Cohesion: 0.33
Nodes (6): Convención sobre los Derechos del Niño (Decreto 830/1990), Interés superior del niño, niña y adolescente, Interés superior del adolescente (Art. 2), Ley N° 20.084 de Responsabilidad Penal Adolescente, Límites de edad: 14 a 18 años (Art. 3), Prescripción: 5 años crímenes, 2 años delitos, 6 meses faltas (Art. 5)

### Community 30 - "Graduación y Proporcionalidad de Faltas"
Cohesion: 0.40
Nodes (5): Graduación de faltas según gravedad, Proporcionalidad de las medidas disciplinarias, Faltas: solo responsables adolescentes mayores de 16 (Art. 1), Carga de catálogos para que el LLM resuelva IDs, Catálogo de tipos de falta por establecimiento

### Community 31 - "Digitalización de Actas (OCR + LLM)"
Cohesion: 0.50
Nodes (5): documentai.service.js, DOCUMENTO_DIGITALIZADO, Flujo de digitalización de actas (OCR→LLM), gemini.service.js (usa OpenAI, nombre desactualizado), Revisión humana antes de confirmar (PATCH /:id/confirmar)

### Community 32 - "OCR Nativo en Swift (Vision)"
Cohesion: 0.50
Nodes (3): AppKit, Foundation, Vision

## Ambiguous Edges - Review These
- `Graduación de faltas según gravedad` → `Faltas: solo responsables adolescentes mayores de 16 (Art. 1)`  [AMBIGUOUS]
  docs/normativa/16-Ley-20084-responsabilidad-penal-adolescente.txt · relation: conceptually_related_to
- `Protocolos de actuación de contenido mínimo (Anexos 1-6)` → `Regla especial para delitos sexuales (Art. 4)`  [AMBIGUOUS]
  docs/normativa/16-Ley-20084-responsabilidad-penal-adolescente.txt · relation: conceptually_related_to

## Knowledge Gaps
- **338 isolated node(s):** `Foundation`, `Vision`, `AppKit`, `name`, `version` (+333 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 373 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Graduación de faltas según gravedad` and `Faltas: solo responsables adolescentes mayores de 16 (Art. 1)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Protocolos de actuación de contenido mínimo (Anexos 1-6)` and `Regla especial para delitos sexuales (Art. 4)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Permiso` connect `Feriados y Tipos de Falta` to `Motor de Flujo de Protocolos`, `Informe de Expulsión y Medidas de Protección`, `Dashboard, Estudiantes y Registros`, `Establecimientos, Usuarios y Tipos de Falta`, `Protocolos Activados (ejecución de casos)`, `Autenticación, Sostenedor y Conexión BD`, `Bootstrap Express y Documentos OCR`, `Documentos Institucionales y Constancias`, `Expediente y Exportación Masiva`, `Cursos e Importación Excel`, `Roles y Catálogo de Permisos`, `Establecimientos Geo e Importación`, `Middleware JWT y Códigos de Permiso`, `Protocolos por Establecimiento`, `CRUD de Comunas`, `Medidas Disciplinarias`, `CRUD de Países`, `Protocolos Genéricos (catálogo)`, `CRUD de Provincias`, `CRUD de Regiones`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `verifyToken()` connect `Middleware JWT y Códigos de Permiso` to `Motor de Flujo de Protocolos`, `Informe de Expulsión y Medidas de Protección`, `Dashboard, Estudiantes y Registros`, `Establecimientos, Usuarios y Tipos de Falta`, `Protocolos Activados (ejecución de casos)`, `Autenticación, Sostenedor y Conexión BD`, `Bootstrap Express y Documentos OCR`, `Documentos Institucionales y Constancias`, `Feriados y Tipos de Falta`, `Expediente y Exportación Masiva`, `Cursos e Importación Excel`, `Roles y Catálogo de Permisos`, `Establecimientos Geo e Importación`, `Protocolos por Establecimiento`, `CRUD de Comunas`, `Medidas Disciplinarias`, `CRUD de Países`, `Protocolos Genéricos (catálogo)`, `CRUD de Provincias`, `CRUD de Regiones`, `Notificaciones`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `requirePermission()` connect `Middleware JWT y Códigos de Permiso` to `Motor de Flujo de Protocolos`, `Informe de Expulsión y Medidas de Protección`, `Dashboard, Estudiantes y Registros`, `Establecimientos, Usuarios y Tipos de Falta`, `Protocolos Activados (ejecución de casos)`, `Autenticación, Sostenedor y Conexión BD`, `Bootstrap Express y Documentos OCR`, `Documentos Institucionales y Constancias`, `Feriados y Tipos de Falta`, `Expediente y Exportación Masiva`, `Cursos e Importación Excel`, `Roles y Catálogo de Permisos`, `Establecimientos Geo e Importación`, `Protocolos por Establecimiento`, `CRUD de Comunas`, `Medidas Disciplinarias`, `CRUD de Países`, `Protocolos Genéricos (catálogo)`, `CRUD de Provincias`, `CRUD de Regiones`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `Foundation`, `Vision`, `AppKit` to the rest of the system?**
  _338 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Motor de Flujo de Protocolos` be split into smaller, more focused modules?**
  _Cohesion score 0.05442176870748299 - nodes in this community are weakly interconnected._