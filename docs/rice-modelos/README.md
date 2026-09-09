# RICE de referencia — MODELOS, NO NORMATIVA

> **Nada de lo que hay en esta carpeta es fuente de derecho.**
> Son reglamentos internos (RICE) de establecimientos concretos, recogidos del
> repositorio público de MINEDUC. Sirven para ver **cómo se redacta** un
> reglamento, no para saber **qué exige la ley**.

## Por qué existe esta carpeta separada

Antes estos archivos vivían en `docs/normativa/`, numerados `06-` y `07-` en la
misma secuencia que la Ley 21.809 y las circulares. Eso invitaba a citarlos como
si fueran norma. No lo son, y la diferencia importa:

| | `docs/normativa/` | `docs/rice-modelos/` (esta carpeta) |
|---|---|---|
| Qué es | Leyes, circulares, dictámenes | Reglamentos de un colegio |
| Quién lo dicta | Congreso, Mineduc, Superintendencia | El propio establecimiento |
| Obliga | Sí, a todos | Solo a esa comunidad escolar |
| Se puede citar como fundamento | Sí | **No** |
| Puede estar equivocado | No | **Sí** — ver abajo |

Un RICE puede estar mal, desactualizado o contradecir la ley: es un texto que
redactó un colegio, no un acto normativo revisado. Hay casos concretos en este
corpus: **RBD 2102 se actualizó en abril de 2026 citando las Circulares 781 y
782 de 2025, que ya estaban derogadas** por la REX 324/2026 (está en
`docs/normativa/08-REX-324...`). Copiar de ahí replica normativa muerta.

Si un modelo y la ley se contradicen, **manda la ley**. Siempre.

## Cuánto del corpus está adecuado a la Ley 21.809

La forma útil de medirlo **no** es contar menciones al número de la ley: un RICE
puede estar bien adecuado y no citarla nunca. La señal real es el vocabulario —
la 21.809 sustituye **"Convivencia Escolar"** por **"Convivencia Educativa"**, y
un texto adecuado no puede evitar el término. La prueba más fuerte es que
además **deje de citar la Ley 20.536**, la que la 21.809 vino a reemplazar.

Con ese criterio, **14 de los 28 modelos** están adecuados:

| modelo | "conv. educativa" | cita 21.809 | resabios 20.536 |
|---|---|---|---|
| `LiceoManuelBarrosBorgono-adaptado-Ley21809-RBD8492` | 205 | 54 | 7 |
| `ColegioAlerce-adaptado-Ley21809-RBD11709` | 182 | 5 | 0 |
| `LiceoAlbertoMagno-adaptado-Ley21809-RBD11792` | 175 | 3 | 0 |
| `EscuelaGuidoGoossens-RBD2941` | 89 | 0 | 1 |
| `adaptado-Ley21809-RBD17742` | 78 | 1 | 4 |
| `EscuelaSanJoseObrero-Curacavi-RBD10844` | 50 | 1 | 6 |
| `EscuelaLuisMartinezGonzalez-Huepil-adaptado-Ley21809-RBD11711` | 48 | 0 | 4 |
| `EscuelaBelgica-RBD897` | 42 | 0 | 11 |
| `ColegioNinoJesus-Lota-adaptado-Ley21809-RBD11707` | 38 | 0 | 0 |
| `InstitutoNacional-RBD8485` | 36 | 0 | 6 |
| `EscuelaJuanPabloII-LosAngeles-RBD11718` | 33 | 0 | 11 |
| `EscuelaDomingoSantaMaria-Renca-RBD10202` | 26 | 0 | 4 |
| `EscuelaPuertaDeLaCordillera-RBD11704` | 25 | 0 | 8 |
| `TheMayflowerSchool-adaptado-Ley21809-RBD11776` | 23 | 4 | 3 |

Los tres primeros son los mejores modelos del corpus. **Barros Borgoño (8492)**
es el único que además cita el articulado (art. 16 E letras i y j de la LGE).
**Colegio Alerce (11709)** y **Liceo Alberto Magno (11792)** valen tanto o más
como redacción: llegan a 182 y 175 usos del término nuevo con **cero menciones a
la 20.536**, o sea que están reescritos, no parchados.

Ojo con la última columna: un número alto de 20.536 junto a un "conv. educativa"
alto significa un texto a medio migrar (Escuela Bélgica y Juan Pablo II, con 11
resabios cada uno). Sirven para ver la transición, no como modelo terminado.

Los 14 restantes siguen íntegramente en la 20.536 y son material de contraste:
el "antes" contra el que se compara la adecuación pendiente.

## Para qué sirven entonces

- Ver cómo se redacta en la práctica un procedimiento de investigación, una
  gradación de faltas o un protocolo de acoso.
- Comparar el "antes" (RICE sobre la 20.536) contra lo que exige la 21.809,
  que es justamente el trabajo de adecuación pendiente del proyecto.
- Alimentar plantillas y textos por defecto del sistema — **redactando a
  partir de ellos, nunca copiándolos como si fueran obligatorios.**

## Advertencias por archivo

Cada `.txt` arranca con cuatro líneas de aviso antes del contenido, para que
quien abra el archivo suelto (o se lo pase a un modelo) lea primero que no es
normativa. El prefijo `RICE-modelo-` en el nombre cumple lo mismo al hacer
`grep -rn`, porque la ruta y el archivo aparecen en cada coincidencia.

## Origen

MINEDUC publica el RICE de cada establecimiento en una ruta predecible por RBD:

```
https://wwwfs.mineduc.cl/Archivos/infoescuelas/documentos/{RBD}/ReglamentodeConvivencia{RBD}.pdf
```

Dos cosas a tener en cuenta si se descargan más:

- **El servidor no manda `Content-Length`.** Una descarga cortada queda como un
  PDF que `file` reporta como válido ("39 pages") pero sin capa de texto. La
  única validación que sirve es correr `pdftotext` y exigir un mínimo de
  caracteres. Un lote entero de 17 bajó truncado sin dar ni un error.
- **Descargar en serie**, no en paralelo: en paralelo el servidor corta. Y
  conviene un tope de tamaño (>20 MB es un escaneado, que además no trae texto).

Algunos RBD devuelven otro documento (un Plan de Gestión de Convivencia) o una
versión de un año anterior. Hay que abrir la portada y verificar antes de sumarlo.
