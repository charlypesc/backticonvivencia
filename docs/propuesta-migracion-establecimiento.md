# Propuesta: unificar ESTABLECIMIENTO (tenant) con el catálogo Geo

Estado: **borrador para revisar con Carlos** — nada de esto está aplicado a la BD.

## Contexto

Hoy conviven dos tablas separadas que representan "un colegio":

- **`ESTABLECIMIENTO`** (tenant): la que usa la app en producción. `id_establecimiento`,
  `nombre`, `rbd`, `region` (texto libre), `comuna` (texto libre), `id_sostenedor`.
  Actualmente tiene **un solo registro** de prueba: `id=1`, "Colegio San Martín",
  RBD `1234-6` — un RBD ficticio que no existe en el directorio oficial.
- **`ESTABLECIMIENTO_GEO`** (catálogo Geo, nuevo): el directorio nacional real de
  RBD importado desde el Excel oficial (`colegios_con_contactos.xlsx`, 7.847
  filas). Vive bajo `País → Región → Provincia → Comuna` y no está ligado al
  tenant todavía.

## Dato vital que se perdió al importar

El Excel trae una columna **`MATRICULAS`** (matrícula del establecimiento) que
**no se está guardando en ningún lado** — ni `ESTABLECIMIENTO_GEO` tiene la
columna, ni el importador (`establecimientosGeo.controller.js`) la lee. Es un
dato vital (tamaño real del colegio) que estaba disponible desde el principio
y se descartó sin querer al armar el catálogo la primera vez.

**Propuesta:** agregar la columna y que el importador la use.

```sql
ALTER TABLE ESTABLECIMIENTO_GEO
  ADD COLUMN matriculas INT NULL AFTER tipo_dependencia;
```

## Propuesta de migración: `ESTABLECIMIENTO` (tenant) apoyado en Geo

Reemplazar `region`/`comuna` (texto libre, sin validar) por un vínculo real a
la jerarquía Geo, y dejar `rbd` listo para validarse contra el directorio
oficial:

```sql
ALTER TABLE ESTABLECIMIENTO
  ADD COLUMN id_comuna INT NULL AFTER rbd,
  ADD CONSTRAINT fk_establecimiento_comuna
    FOREIGN KEY (id_comuna) REFERENCES COMUNA(id_comuna);

-- region/comuna (texto) quedan como columnas legacy hasta migrar los datos
-- existentes; se deprecan (no se eliminan todavía) para no romper nada en
-- caliente.
```

`id_comuna` queda **nullable** a propósito: el único registro real hoy
(`Colegio San Martín`, RBD `1234-6`) no matchea contra ningún RBD del
directorio oficial, así que no se puede autocompletar — alguien tiene que
decidir qué hacer con ese registro de prueba (ver preguntas abiertas).

## Preguntas abiertas para Carlos

1. **RBD ficticio existente**: `Colegio San Martín` (RBD `1234-6`) no es un
   colegio real del directorio MINEDUC. ¿Se dejó como dato de prueba a
   propósito, o hay que reemplazarlo por un RBD real antes de conectar la FK?
2. **Alcance del vínculo**: ¿el tenant `ESTABLECIMIENTO` debería enlazar
   directo a `ESTABLECIMIENTO_GEO` (1 fila = 1 RBD real, con
   `id_establecimiento_geo` como FK) en vez de solo a `COMUNA`? Eso permitiría
   heredar automáticamente teléfono/correo/matrícula del directorio oficial,
   pero exige que cada tenant tenga un RBD real desde el alta.
3. **Alta de tenant nuevo**: hoy no existe un flujo de alta de colegio en la
   app (es manual/directo en BD). Si se conecta con Geo, el flujo natural
   sería: buscar RBD en el directorio → autocompletar nombre/comuna/contacto
   → crear el `ESTABLECIMIENTO` del tenant. ¿Vale la pena construir ese flujo
   ahora, gateado con `ENCARGADO` como el resto de mantenedores (ver
   `sostenedor.routes.js` / rutas de Geo)?
4. **`matriculas`**: ¿se usa solo como dato informativo del catálogo Geo, o
   también debería reflejarse en el `ESTABLECIMIENTO` del tenant (ej. para
   comparar matrícula oficial vs. estudiantes cargados en el sistema)?

## Qué falta si se aprueba

- Actualizar `establecimientosGeo.controller.js` (`procesarImportacion` y
  `create`/`update`) para leer/guardar `matriculas`.
- Re-importar el Excel (o un `UPDATE` puntual) para poblar `matriculas` en las
  7.847 filas ya existentes.
- Migración de datos del `ESTABLECIMIENTO` actual según lo que se resuelva en
  la pregunta 1.
- Decidir si el link es a `COMUNA` o a `ESTABLECIMIENTO_GEO` (pregunta 2)
  antes de escribir el `ALTER TABLE` definitivo.
