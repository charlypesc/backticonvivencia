# backticonvivencia — Convenciones del proyecto

## Antes de explorar el código: usar graphify

Este proyecto tiene un grafo de conocimiento ya construido en
`graphify-out/` (`graph.json`, `graph.html`, `GRAPH_REPORT.md`). Ante
**cualquier** pregunta sobre cómo funciona algo, qué controller toca qué
tabla, dónde vive una regla del motor de protocolos o cómo fluye un dato,
la primera acción es consultar el grafo — no arrancar con `grep`/`Explore`
sobre todo el repo:

```bash
graphify query "¿cómo funciona X?"                    # contexto amplio (BFS)
graphify query "..." --dfs                            # trazar un camino concreto
graphify path "protocolosActivados" "flujoProtocolo"  # camino más corto entre dos nodos
graphify explain "avanzar"                            # explicación en lenguaje simple de un nodo
```

Recién si el grafo no alcanza (código muy nuevo, detalle línea a línea) se
pasa a leer archivos directamente.

- **Mantenerlo al día**: después de cambios grandes (endpoints nuevos,
  refactors de varios archivos, migraciones de esquema), correr
  `graphify . --update --code-only` desde la raíz del back — es incremental,
  solo re-extrae lo que cambió.
- `--code-only` evita el error de "no LLM API key": sin key, graphify no
  puede extraer los `.md` de `docs/` y aborta. Con `--code-only` indexa el
  código con AST local y salta los docs. Si hay `ANTHROPIC_API_KEY` (o
  `GEMINI_API_KEY`) exportada, correr `graphify . --update` a secas para que
  entren también los `.md` de `docs/` (los `.sql` de esquema viven ahí).
- El front tiene **su propio grafo** en `../front-ticonvivencia/graphify-out/`.
  Son dos grafos separados: una pregunta que cruza front y back se consulta
  en los dos.
- No commitear `graphify-out/` con cada cambio: es salida generada.

## Documentos legales: normativa vs. modelos

`docs/` tiene dos carpetas de documentos que **no se pueden tratar igual**:

- **`docs/normativa/`** — leyes, DFL, circulares y dictámenes. Es fuente de
  derecho: se cita como fundamento de una regla del sistema.
- **`docs/rice-modelos/`** — reglamentos internos (RICE) de establecimientos
  concretos, bajados del repositorio público de MINEDUC. **No son normativa.**
  Son ejemplos de redacción, sirven para consultar cómo se escribe algo, y
  pueden estar desactualizados o directamente equivocados. **Nunca se citan
  como fundamento legal.** Si un RICE contradice la ley, manda la ley.

La mayoría de los RICE del corpus todavía están escritos sobre la Ley 20.536:
el plazo para adecuarse a la Ley 21.809 vence en abril de 2027. Los únicos dos
ya adecuados son los que llevan `adaptado-Ley21809` en el nombre.

Los `.txt` se generan con `pdftotext -layout` y se consultan con `grep -n` +
`sed -n` sobre el rango de líneas: abrir el PDF cuesta muchísimo más.
