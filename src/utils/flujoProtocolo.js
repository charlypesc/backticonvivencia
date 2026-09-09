// Reglas del grafo de un protocolo, independientes de en qué nivel viva.
//
// Las mismas comprobaciones corren sobre la plantilla global, sobre la copia
// espejo de un establecimiento y sobre el grafo materializado en un caso. Por
// eso reciben arreglos de objetos y no consultan la BD: quien llama trae las
// filas de la tabla que le toca y las pasa con los nombres canónicos
// (`id_paso`, `id_paso_origen`, `id_paso_destino`).
//
// Sin ORM ni triggers, esto es lo único que impide que un protocolo mal armado
// llegue a producción y deje casos atascados en un nodo sin salida.

// Formato deliberadamente mínimo: `campo=valor` o `campo!=valor`. No hay >, <
// ni AND/OR. Los campos que deciden una rama son selectores, no números, y un
// motor de reglas de verdad es una pieza que hay que mantener y depurar para
// algo que ninguna transición de un protocolo escolar necesita.
// Si algún día hacen falta rangos, se amplía acá y en validarCondicion().
const RE_CONDICION = /^\s*([a-z][a-z0-9_]{0,49})\s*(!=|=)\s*(.+?)\s*$/;

// El código de un campo viaja dentro de la condición como texto plano, así que
// se restringe a snake_case: un código con '=' o espacios haría imposible
// parsear la condición sin ambigüedad.
const RE_CODIGO_CAMPO = /^[a-z][a-z0-9_]{0,49}$/;

// 'booleano' se sacó: una pregunta 'seleccion' con las opciones 'si'/'no' abre
// las mismas dos ramas (ver TIPOS_DECIDIBLES y CAMPO_APROBACION, que siempre
// fue 'seleccion') y era el mismo tipo de campo contado dos veces.
const TIPOS_CAMPO = ['texto', 'numero', 'fecha', 'seleccion'];
// Los cinco primeros son formas de ejecutar un paso; los seis últimos son
// trámites concretos que se repiten en todos los protocolos y que el editor
// precarga enteros (texto, plazo, a quién alcanza y preguntas), en vez de que
// cada colegio los reescriba con sus palabras y después no haya forma de leer
// "en cuántos casos se notificó fuera de plazo".
const TIPOS_PASO = [
  'informativo', 'formulario', 'adjunto', 'aprobacion', 'notificacion_externa',
  'seguimiento', 'notificacion_apoderado', 'notificacion_estudiante',
  'medida_proteccion', 'medida_disciplinaria', 'medida_cautelar',
];

// Pasos que se resuelven aprobando o rechazando, no completando un formulario.
// Una medida disciplinaria y una cautelar son decisiones que alguien firma —la
// dirección— y de las que cuelga una rama según lo resuelto, que es exactamente
// lo que hace un paso de aprobación; no son un tipo nuevo de conducta, son el
// mismo acto con otro nombre.
const TIPOS_PASO_APROBACION = ['aprobacion', 'medida_disciplinaria', 'medida_cautelar'];

/** ¿Este paso se resuelve aprobando/rechazando? */
const esPasoDeAprobacion = (tipo_paso) => TIPOS_PASO_APROBACION.includes(tipo_paso);
const UNIDADES_PLAZO = ['horas', 'dias_habiles', 'dias_corridos'];
const ACCIONES_VENCER = ['notificar', 'escalar', 'marcar_alerta'];
const TIPOS_PARTICIPACION = ['ejecutor', 'aprobador', 'notificado'];

// Roles de un involucrado en el caso. Deliberadamente 'afectado' y 'senalado'
// en vez de 'víctima' y 'agresor': esas son calificaciones jurídicas que el
// establecimiento no puede hacer antes de investigar, y el rol se asigna al
// activar el protocolo, o sea antes de todo.
const ROLES_INVOLUCRADO = ['afectado', 'senalado', 'testigo', 'denunciante'];

// Las PARTES del caso: aquella a favor de quien se instruye y aquella contra
// quien se instruye. Testigo y denunciante intervienen en el caso pero no son
// partes: no se les notifica la resolución ni se les hace seguimiento.
const ROLES_PARTE = ['afectado', 'senalado'];

// A qué involucrados les toca un paso. 'todos' es lo que corresponde cuando la
// obligación alcanza a las dos partes (notificar la resolución), que no es lo
// mismo que un paso del caso (por_involucrado_rol nulo), que se hace una vez.
//
// 'todos' significa AMBAS PARTES, no "todo el mundo": hasta 2026-09-01 excluía
// solo al testigo, así que el denunciante recibía la notificación de la
// resolución y las comunicaciones a la familia de los diez pasos que usan este
// valor. El denunciante puede ser un profesor, un vecino o el apoderado de otro
// curso; notificarlo choca de frente con el deber de resguardar la intimidad
// del afectado y la identidad del acusado (Circular 482/2018, Anexo 2, vi y ix)
// y le abre un plazo de apelación a quien no es parte.
const ROLES_PASO_INVOLUCRADO = [...ROLES_INVOLUCRADO, 'todos'];

// Qué clase de medida ordena un paso con `requiere_medida`. Sin esto la bandera
// se conformaba con cualquiera de las tres tablas, y un paso de resguardo se
// daba por cumplido con la sanción disciplinaria del mismo caso.
//
// Una clase por tabla, y ninguna cumple por otra. En particular, la medida de
// protección (Ley 21.809 art. 16 E letra j) y la suspensión cautelar (DFL 2/1998
// art. 6 letra d) NO son intercambiables: la primera va a favor de la persona
// afectada y la puede adoptar el establecimiento desde que toma conocimiento de
// los hechos; la segunda recae sobre el señalado, la decreta solo el director
// dentro de un procedimiento sancionatorio ya iniciado, y abre un plazo de diez
// días hábiles para resolver. Decretar la cautelar no descarga el deber de
// proteger a la persona afectada —ni el monitoreo pedagógico ni la continuidad
// de la trayectoria educativa que la letra j impone por separado—, así que darla
// por buena en un paso de protección apagaba un aviso que tenía que seguir
// encendido.
const TIPOS_MEDIDA_REQUERIDA = ['proteccion', 'cautelar', 'disciplinaria', 'cualquiera'];

/**
 * El par (requiere_medida, tipo_medida_requerida) reducido a lo único que se
 * guarda: la clase, o null si el paso no ordena medida.
 *
 * Los dos campos pueden llegar en desacuerdo desde el editor —se destildó la
 * casilla pero el select quedó con su valor, o al revés— y dejar la clase
 * puesta sobre un paso que ya no pide medida hace que el paso reaparezca
 * pidiéndola apenas alguien vuelva a marcar la casilla por otro motivo. Que la
 * casilla mande es lo que el usuario ve.
 *
 * 'cualquiera' es el default y no un error: un establecimiento que arma un paso
 * propio y marca "ordena una medida" sin elegir clase está diciendo justamente
 * eso, y el comportamiento viejo era ese.
 */
const normalizarMedidaRequerida = ({ requiere_medida, tipo_medida_requerida }) =>
  (requiere_medida ? (tipo_medida_requerida || 'cualquiera') : null);

// El mismo criterio que `involucradosDelPaso`, en SQL, para las consultas que
// materializan o borran filas de cumplimiento. Va acá y no copiado en cada
// consulta porque son tres lugares: si divergen, quedan filas de cumplimiento
// que el motor no sabe que existen y el caso no avanza nunca. Espera dos
// parámetros, ambos el rol del involucrado.
const SQL_ROL_ALCANZA_PASO =
  "(p.por_involucrado_rol = ? OR (p.por_involucrado_rol = 'todos' AND ? IN ('afectado', 'senalado')))";

const TIPOS_PERSONA = ['estudiante', 'funcionario', 'externo'];

// Por qué vía se notificó a la persona. No se le pide firma: la Superintendencia
// fiscaliza que exista constancia de que se notificó, cuándo y cómo — no un
// papel firmado. Las únicas dos actuaciones que sí exigen firma son la expulsión
// y la cancelación de matrícula, que viven en INFORME_EXPULSION.
const MEDIOS_NOTIFICACION = ['presencial', 'correo', 'telefono', 'plataforma', 'carta'];

/**
 * Involucrados del caso a los que les toca un paso.
 *
 * Un paso sin `por_involucrado_rol` es del caso y no devuelve ninguno: se hace
 * una sola vez. El paso sigue siendo un nodo del grafo aunque alcance a tres
 * personas — lo que se multiplica es el registro de cumplimiento, no el nodo,
 * porque el motor es de un solo token y tres nodos en paralelo harían que el
 * primero en completarse arrastrara el caso al paso siguiente.
 */
const involucradosDelPaso = (paso, involucrados) => {
  const rol = paso?.por_involucrado_rol;
  if (!rol) return [];
  if (rol === 'todos') return involucrados.filter((i) => ROLES_PARTE.includes(i.rol));
  return involucrados.filter((i) => i.rol === rol);
};

// Solo este tipo puede decidir una rama. Condicionar sobre un texto libre es
// una condición que nunca se cumple salvo por coincidencia exacta, y sobre una
// fecha o un número haría falta comparación por rango, que no existe.
const TIPOS_DECIDIBLES = ['seleccion'];

/** `'gravedad=grave'` → `{ campo: 'gravedad', operador: '=', valor: 'grave' }`; null si no parsea. */
const parsearCondicion = (condicion) => {
  const m = RE_CONDICION.exec(condicion ?? '');
  if (!m) return null;
  return { campo: m[1], operador: m[2], valor: m[3] };
};

/**
 * Valida una condición contra los campos del paso de origen.
 *
 * Se comprueba al guardar la transición y no al evaluarla: un código de campo
 * mal escrito descubierto en runtime significa un caso real atascado a mitad
 * de un protocolo, y para entonces el grafo ya está congelado en ese caso.
 *
 * @param {string} condicion
 * @param {Array} campos filas de *_PASO_CAMPO del paso de origen
 * @returns {string|null} mensaje de error, o null si es válida
 */
const validarCondicion = (condicion, campos) => {
  const cond = parsearCondicion(condicion);
  if (!cond)
    return `Condición '${condicion}' mal formada. Se espera 'campo=valor' o 'campo!=valor'.`;

  const campo = campos.find((c) => c.codigo === cond.campo);
  if (!campo)
    return `La condición usa el campo '${cond.campo}', que no existe en el paso de origen.`;

  if (!TIPOS_DECIDIBLES.includes(campo.tipo_campo))
    return `El campo '${cond.campo}' es de tipo '${campo.tipo_campo}' y no puede decidir una rama. ` +
           `Solo se puede condicionar sobre campos de tipo ${TIPOS_DECIDIBLES.join(' o ')}.`;

  if (campo.tipo_campo === 'seleccion') {
    const opciones = normalizarOpciones(campo.opciones);
    if (!opciones.includes(cond.valor))
      return `El valor '${cond.valor}' no es una de las opciones de '${cond.campo}' (${opciones.join(', ')}).`;
  }

  return null;
};

/**
 * Valida el `depende_de` de un campo contra los demás campos de su paso.
 *
 * Se comprueba al guardar y no al pintar el formulario: una dependencia sobre
 * un código mal escrito no falla — simplemente esconde el campo para siempre,
 * y eso se descubre cuando alguien nota que un dato del expediente nunca se
 * llenó.
 *
 * @param {string|null} depende_de   'campo=valor' o 'campo!=valor'
 * @param {string} codigoPropio      código del campo que se está guardando
 * @param {Array} campos             los demás campos del mismo paso
 * @returns {string|null} mensaje de error, o null si es válida
 */
const validarDependencia = (depende_de, codigoPropio, campos) => {
  if (depende_de === undefined || depende_de === null || String(depende_de).trim() === '') return null;

  const texto = String(depende_de).trim();
  const cond = parsearCondicion(texto);
  if (!cond)
    return `Dependencia '${texto}' mal formada. Se espera 'campo=valor' o 'campo!=valor'.`;
  if (cond.campo === codigoPropio) return 'Un campo no puede depender de sí mismo.';

  const problema = validarCondicion(texto, campos);
  if (problema)
    return problema
      .replace('La condición', 'La dependencia')
      .replace('no puede decidir una rama. Solo se puede condicionar sobre',
               'no puede decidir si se muestra otro campo. Solo se puede depender de');

  // Un ciclo (a depende de b y b de a) deja a los dos campos invisibles para
  // siempre, sin ningún error a la vista.
  const porCodigo = new Map(campos.map((c) => [c.codigo, c]));
  const vistos = new Set([codigoPropio]);
  let actual = cond.campo;
  while (actual) {
    if (vistos.has(actual))
      return `La dependencia forma un ciclo con '${actual}': ninguno de los dos campos se podría mostrar nunca.`;
    vistos.add(actual);
    const padre = parsearCondicion(porCodigo.get(actual)?.depende_de);
    actual = padre?.campo ?? null;
  }

  return null;
};

// mysql2 devuelve una columna JSON ya parseada, pero el mismo objeto puede
// venir del body de un request como string. Se acepta cualquiera de las dos.
const normalizarOpciones = (opciones) => {
  if (Array.isArray(opciones)) return opciones;
  if (typeof opciones === 'string') {
    try {
      const parsed = JSON.parse(opciones);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

/**
 * ¿Las condiciones de estas salidas cubren todas las respuestas posibles?
 *
 * Un paso con una pregunta Sí/No y sus dos ramas no necesita salida por
 * defecto: pase lo que pase, una de las dos se cumple. Exigirle igual una
 * tercera salida "por defecto" obliga a inventar un destino que nunca se usa.
 *
 * Se considera cubierto cuando todas las condiciones son sobre el mismo campo
 * obligatorio y, entre todas, agotan sus valores (o hay un `!=`, que se queda
 * con todo el resto).
 */
const salidasCubrenTodosLosCasos = (salientes, campos) => {
  const conds = salientes.map((t) => parsearCondicion(t.condicion));
  if (conds.length === 0 || conds.some((c) => !c)) return false;

  const codigo = conds[0].campo;
  if (conds.some((c) => c.campo !== codigo)) return false;

  const campo = campos.find((c) => c.codigo === codigo);
  // Sin el campo a la vista no se puede afirmar que estén cubiertos; el
  // problema real (condición sobre un campo inexistente) lo reporta
  // validarCondicion.
  if (!campo || !campo.es_obligatorio) return false;

  if (conds.some((c) => c.operador === '!=')) return true;

  const posibles = normalizarOpciones(campo.opciones);
  if (posibles.length === 0) return false;

  const cubiertos = new Set(conds.map((c) => c.valor));
  return posibles.every((v) => cubiertos.has(v));
};

/**
 * Los pasos de un caso que ya no se van a ejecutar: la rama que no se tomó.
 *
 * Al activar un protocolo se materializa el grafo entero, ramas incluidas. Si
 * en la bifurcación se respondió "Sí", el paso colgado del "No" queda pendiente
 * para siempre y se lee como una tarea que alguien olvidó hacer — aparece en la
 * línea de tiempo y hace que cerrar el caso exija justificar pasos incompletos
 * que nunca correspondieron.
 *
 * Se deriva de las respuestas ya registradas en vez de guardarse: un estado más
 * en la tabla es un estado más que puede quedar desincronizado, y la regla es
 * exactamente la del motor — desde un paso ya cerrado, la única salida viva es
 * la que `elegirTransicion` habría tomado con sus `datos_salida`.
 *
 * @param {Array} pasos        filas de PROTOCOLO_ACTIVADO_PASO
 * @param {Array} transiciones filas de PROTOCOLO_ACTIVADO_TRANSICION
 * @returns {Set<number>} ids (`id_activado_paso`) de los pasos descartados
 */
const pasosDescartados = (pasos, transiciones) => {
  const idDe = (p) => p.id_activado_paso ?? p.id_paso;
  const porId = new Map(pasos.map((p) => [idDe(p), p]));

  const salientesPor = new Map();
  const entrantesPor = new Map();
  for (const t of transiciones) {
    if (!salientesPor.has(t.id_paso_origen)) salientesPor.set(t.id_paso_origen, []);
    salientesPor.get(t.id_paso_origen).push(t);
    if (!entrantesPor.has(t.id_paso_destino)) entrantesPor.set(t.id_paso_destino, []);
    entrantesPor.get(t.id_paso_destino).push(t);
  }

  const fuera = new Set();

  // Una transición está muerta si el caso ya no puede pasar por ella.
  const muerta = (t) => {
    if (fuera.has(t.id_paso_origen)) return true;
    const origen = porId.get(t.id_paso_origen);
    if (!origen) return true;
    // Mientras el origen no se cierre, todavía puede mandar el caso por acá.
    if (!['completado', 'omitido'].includes(origen.estado)) return false;
    const elegida = elegirTransicion(salientesPor.get(t.id_paso_origen) ?? [], origen.datos_salida);
    // Sin destino elegible (grafo roto) no se descarta nada: el problema es
    // otro y esconder pasos lo haría más difícil de ver.
    if (elegida.error) return false;
    return elegida.transicion !== t;
  };

  // Punto fijo: descartar un paso mata sus salidas, y eso puede descartar al
  // siguiente, en cadena.
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const p of pasos) {
      const id = idDe(p);
      if (fuera.has(id) || p.estado !== 'pendiente') continue;
      const entrantes = entrantesPor.get(id) ?? [];
      // Sin entradas es el paso inicial (o uno suelto): no se descarta.
      if (entrantes.length === 0) continue;
      if (entrantes.every(muerta)) {
        fuera.add(id);
        cambio = true;
      }
    }
  }
  return fuera;
};

/**
 * Batería de coherencia sobre el grafo completo. Corre al publicar y no en
 * cada edición: mientras el ADMIN arma el protocolo el grafo está roto casi
 * todo el tiempo (el primer paso creado no tiene todavía ninguna transición),
 * así que bloquear cada guardado haría imposible construirlo.
 *
 * @param {Array} pasos        filas de *_PASO
 * @param {Array} transiciones filas de *_TRANSICION
 * @param {Array} campos       filas de *_PASO_CAMPO; sin ellas no se puede
 *                             saber si las condiciones de un paso agotan las
 *                             respuestas posibles y se exige salida por defecto
 * @returns {string[]} problemas encontrados; vacío = grafo publicable
 */
const validarGrafo = (pasos, transiciones, campos = []) => {
  const problemas = [];

  if (pasos.length === 0) return ['El protocolo no tiene ningún paso definido.'];

  const iniciales = pasos.filter((p) => p.es_paso_inicial);
  if (iniciales.length === 0)
    problemas.push('No hay paso inicial: el motor no tiene por dónde arrancar.');
  else if (iniciales.length > 1)
    problemas.push(
      `Hay ${iniciales.length} pasos iniciales (${iniciales.map((p) => p.nombre).join(', ')}); debe haber exactamente uno.`
    );

  if (!pasos.some((p) => p.es_paso_final))
    problemas.push('No hay ningún paso final: el protocolo nunca podría cerrarse.');

  // Un paso final con salidas es contradictorio: o cierra o continúa.
  for (const p of pasos)
    if (p.es_paso_final && transiciones.some((t) => t.id_paso_origen === p.id_paso))
      problemas.push(`El paso final '${p.nombre}' tiene transiciones salientes.`);

  const salientesPor = new Map();
  for (const t of transiciones) {
    if (!salientesPor.has(t.id_paso_origen)) salientesPor.set(t.id_paso_origen, []);
    salientesPor.get(t.id_paso_origen).push(t);
  }

  for (const p of pasos) {
    const salientes = salientesPor.get(p.id_paso) ?? [];

    // Callejón sin salida: un paso que no cierra y del que no se puede seguir
    // deja el caso detenido para siempre, sin error visible en ninguna parte.
    if (!p.es_paso_final && salientes.length === 0)
      problemas.push(`El paso '${p.nombre}' no es final y no tiene ninguna transición saliente.`);

    // Un paso que solo vuelve sobre sí mismo no avanza nunca. El self-loop es
    // legítimo ("mantener el seguimiento otro ciclo"), pero tiene que convivir
    // con al menos una salida real.
    if (!p.es_paso_final && salientes.length > 0 && salientes.every((t) => t.id_paso_destino === p.id_paso))
      problemas.push(`Todas las transiciones de '${p.nombre}' vuelven al mismo paso: el protocolo no podría avanzar.`);

    const defaults = salientes.filter((t) => t.es_default);
    if (defaults.length > 1)
      problemas.push(`El paso '${p.nombre}' tiene ${defaults.length} transiciones marcadas por defecto; solo puede haber una.`);

    // Si todas las salidas son condicionales y ninguna se cumple, el caso
    // queda igual de atascado que sin salidas. La rama por defecto es el
    // escape obligatorio, salvo cuando las condiciones ya cubren todas las
    // respuestas posibles (el caso corriente: una pregunta Sí/No con sus dos
    // ramas), donde no hay ningún hueco que tapar.
    const camposDelOrigen = camposDelPaso(p, campos.filter((c) => (c.id_paso ?? c.id_paso_estab) === p.id_paso));
    if (
      salientes.length > 0 &&
      salientes.every((t) => t.condicion) &&
      defaults.length === 0 &&
      !salidasCubrenTodosLosCasos(salientes, camposDelOrigen)
    )
      problemas.push(
        `Todas las transiciones desde '${p.nombre}' son condicionales y no hay una por defecto: ` +
        'si ninguna condición se cumple, el caso queda sin destino.'
      );
  }

  // Alcanzabilidad desde el inicial. Un paso huérfano no rompe ningún caso,
  // pero es trabajo que el colegio cree configurado y que nunca va a ejecutarse.
  if (iniciales.length === 1) {
    const alcanzados = new Set([iniciales[0].id_paso]);
    const cola = [iniciales[0].id_paso];
    while (cola.length > 0) {
      for (const t of salientesPor.get(cola.pop()) ?? [])
        if (!alcanzados.has(t.id_paso_destino)) {
          alcanzados.add(t.id_paso_destino);
          cola.push(t.id_paso_destino);
        }
    }
    const huerfanos = pasos.filter((p) => !alcanzados.has(p.id_paso));
    if (huerfanos.length > 0)
      problemas.push(
        `Estos pasos no son alcanzables desde el paso inicial: ${huerfanos.map((p) => p.nombre).join(', ')}.`
      );
  }

  return problemas;
};

// Un paso de aprobación no tiene campos configurables, pero sí produce un
// resultado sobre el que ramificar — que es el caso más natural de todos:
// "si lo aprueban, seguir; si no, volver". Se expone como un campo implícito
// para que las condiciones no necesiten un mecanismo aparte.
const CAMPO_APROBACION = Object.freeze({
  codigo: 'aprobado',
  etiqueta: '¿Aprobado?',
  tipo_campo: 'seleccion',
  opciones: ['si', 'no'],
  es_obligatorio: 1,
  implicito: true,
});

/**
 * Campos contra los que se evalúan las condiciones que salen de un paso: los
 * configurados, salvo en aprobación, donde es el implícito.
 */
const camposDelPaso = (paso, campos) =>
  esPasoDeAprobacion(paso?.tipo_paso) ? [CAMPO_APROBACION, ...(campos ?? [])] : (campos ?? []);

/**
 * Elige el destino al completar un paso.
 *
 * Se toma la primera transición condicional que se cumpla contra el
 * `datos_salida` del paso recién completado, y si ninguna se cumple, la que
 * esté marcada por defecto. Las condiciones nunca miran pasos anteriores: eso
 * mantiene cada salto explicable con lo que se ve en la bitácora de ese paso.
 *
 * @returns {{transicion: object}|{error: string}}
 */
const elegirTransicion = (transiciones, datosSalida) => {
  const datos = datosSalida ?? {};
  const condicionales = transiciones.filter((t) => t.condicion);
  // Una salida sin condición vale como destino aunque nadie la haya marcado
  // por defecto: es el caso corriente de un paso con una sola continuación.
  // `es_default` solo desempata cuando hay varias incondicionales.
  const incondicionales = transiciones.filter((t) => !t.condicion);
  const porDefecto = incondicionales.find((t) => t.es_default) ?? incondicionales[0];

  for (const t of condicionales) {
    const cond = parsearCondicion(t.condicion);
    if (!cond) continue;
    const valor = datos[cond.campo];
    if (valor === undefined || valor === null) continue;
    const coincide = cond.operador === '='
      ? String(valor) === cond.valor
      : String(valor) !== cond.valor;
    if (coincide) return { transicion: t };
  }

  if (porDefecto) return { transicion: porDefecto };

  // El grafo se valida antes de activarse, así que llegar acá significa que se
  // activó con reglas rotas o que el paso no tenía salidas.
  return {
    error: transiciones.length === 0
      ? 'El paso no tiene ninguna transición saliente y no es final.'
      : 'Ninguna condición se cumplió y el paso no tiene una transición por defecto.',
  };
};

/**
 * Fecha límite de un paso que arranca en `desde`.
 *
 * `dias_habiles` descuenta fines de semana y feriados. Los feriados llegan como
 * parámetro y no se consultan acá para no romper la regla del archivo: estas
 * funciones son puras y no tocan la BD, porque las mismas corren sobre la
 * plantilla, sobre el espejo y sobre el caso. Quien llama los trae con
 * `feriados.service.js`, que los cachea.
 *
 * Si falta el set se lanza TypeError en vez de contar sin feriados: seguir de
 * largo devolvería una fecha límite plausible pero corrida, y un plazo legal
 * mal contado descubierto en una fiscalización no tiene arreglo retroactivo.
 * Es el mismo criterio que requirePermission con un código string.
 *
 * @param {Date} desde
 * @param {number} plazo_valor
 * @param {string} plazo_unidad
 * @param {Set<string>} [feriados] fechas 'YYYY-MM-DD' inhábiles; obligatorio
 *   para 'dias_habiles'
 */
const calcularFechaLimite = (desde, plazo_valor, plazo_unidad, feriados) => {
  if (!plazo_valor || !plazo_unidad) return null;
  const f = new Date(desde);

  if (plazo_unidad === 'horas') {
    f.setUTCHours(f.getUTCHours() + plazo_valor);
    return f;
  }
  if (plazo_unidad === 'dias_corridos') {
    f.setUTCDate(f.getUTCDate() + plazo_valor);
    return f;
  }

  if (!(feriados instanceof Set))
    throw new TypeError(
      'calcularFechaLimite necesita el set de feriados para contar días hábiles. ' +
      'Traelo con cargarFeriados(id_establecimiento) de services/feriados.service.js.'
    );

  let restantes = plazo_valor;
  while (restantes > 0) {
    f.setUTCDate(f.getUTCDate() + 1);
    const dia = f.getUTCDay();
    if (dia === 0 || dia === 6) continue;
    if (feriados.has(f.toISOString().slice(0, 10))) continue;
    restantes--;
  }
  return f;
};

/**
 * ¿Este campo se le pregunta a alguien que ya respondió `datos`?
 *
 * Un campo puede depender de otro del mismo paso (`depende_de: 'campo=valor'`,
 * la misma sintaxis de las condiciones de las transiciones, para no inventar un
 * segundo lenguaje). "Descargos presentados" solo tiene sentido si antes se
 * dijo que sí los presentó: preguntarlo igual invita a llenar un campo que
 * contradice la respuesta anterior, y eso queda escrito en el expediente.
 *
 * Sin `depende_de` el campo se pregunta siempre. Si el campo del que depende
 * todavía no fue respondido, el dependiente no se muestra: no se puede afirmar
 * que corresponda.
 */
const campoVisible = (campo, datos) => {
  const cond = parsearCondicion(campo?.depende_de);
  if (!cond) return true;

  const valor = (datos ?? {})[cond.campo];
  if (valor === undefined || valor === null || String(valor).trim() === '') return false;

  return cond.operador === '='
    ? String(valor) === cond.valor
    : String(valor) !== cond.valor;
};

/**
 * Valida los datos que llegan al completar un paso contra el schema congelado
 * de ese paso. Devuelve `{ datos }` normalizados o `{ error }`.
 *
 * Se rechazan las claves desconocidas en vez de ignorarlas: un campo que el
 * cliente cree estar guardando y que se descarta en silencio reaparece como
 * una condición que nunca se cumple, meses después y sin rastro.
 */
const validarDatosSalida = (campos, datos) => {
  const entrada = datos ?? {};
  const porCodigo = new Map(campos.map((c) => [c.codigo, c]));

  for (const clave of Object.keys(entrada))
    if (!porCodigo.has(clave))
      return { error: `El campo '${clave}' no existe en este paso.` };

  const limpio = {};
  for (const campo of campos) {
    // Un campo que no correspondía preguntarse no se exige ni se guarda, aunque
    // el cliente lo mande: es lo que pasa cuando alguien responde 'sí', llena el
    // dependiente y después cambia a 'no'. Guardarlo dejaría en el expediente un
    // dato que la propia respuesta anterior desmiente.
    if (!campoVisible(campo, entrada)) continue;

    const valor = entrada[campo.codigo];
    const vacio = valor === undefined || valor === null || String(valor).trim() === '';

    if (vacio) {
      if (campo.es_obligatorio) return { error: `El campo '${campo.etiqueta}' es obligatorio.` };
      continue;
    }

    const texto = String(valor).trim();
    if (campo.tipo_campo === 'numero' && Number.isNaN(Number(texto)))
      return { error: `El campo '${campo.etiqueta}' debe ser un número.` };
    if (campo.tipo_campo === 'fecha' && Number.isNaN(Date.parse(texto)))
      return { error: `El campo '${campo.etiqueta}' debe ser una fecha válida.` };
    if (campo.tipo_campo === 'seleccion') {
      const opciones = normalizarOpciones(campo.opciones);
      if (!opciones.includes(texto))
        return { error: `'${texto}' no es una opción válida de '${campo.etiqueta}' (${opciones.join(', ')}).` };
    }

    limpio[campo.codigo] = texto;
  }

  return { datos: limpio };
};

/**
 * Normaliza el plazo de un paso: valor y unidad van juntos o no van ninguno.
 * Un plazo con valor y sin unidad no se puede calcular, y una unidad sin valor
 * no significa nada.
 *
 * @returns {{valor: number|null, unidad: string|null}|{error: string}}
 */
const validarPlazo = (plazo_valor, plazo_unidad) => {
  const hayValor = plazo_valor !== undefined && plazo_valor !== null && plazo_valor !== '';
  const hayUnidad = plazo_unidad !== undefined && plazo_unidad !== null && plazo_unidad !== '';

  if (hayValor !== hayUnidad)
    return { error: 'plazo_valor y plazo_unidad se definen juntos o se omiten los dos.' };
  if (!hayValor) return { valor: null, unidad: null };
  if (!Number.isInteger(Number(plazo_valor)) || Number(plazo_valor) <= 0)
    return { error: 'plazo_valor debe ser un entero mayor que cero.' };
  if (!UNIDADES_PLAZO.includes(plazo_unidad))
    return { error: `plazo_unidad debe ser uno de: ${UNIDADES_PLAZO.join(', ')}.` };

  return { valor: Number(plazo_valor), unidad: plazo_unidad };
};

/** Validaciones de forma de un paso, sin mirar la BD. Devuelve mensaje o null. */
const validarPaso = ({ nombre, tipo_paso, accion_al_vencer, por_involucrado_rol,
                       tipo_medida_requerida }) => {
  if (!nombre?.trim()) return 'Nombre es requerido';
  if (tipo_paso && !TIPOS_PASO.includes(tipo_paso))
    return `tipo_paso debe ser uno de: ${TIPOS_PASO.join(', ')}.`;
  if (accion_al_vencer && !ACCIONES_VENCER.includes(accion_al_vencer))
    return `accion_al_vencer debe ser uno de: ${ACCIONES_VENCER.join(', ')}.`;
  if (por_involucrado_rol && !ROLES_PASO_INVOLUCRADO.includes(por_involucrado_rol))
    return `por_involucrado_rol debe ser uno de: ${ROLES_PASO_INVOLUCRADO.join(', ')}, o quedar vacío si el paso es del caso.`;
  if (tipo_medida_requerida && !TIPOS_MEDIDA_REQUERIDA.includes(tipo_medida_requerida))
    return `tipo_medida_requerida debe ser uno de: ${TIPOS_MEDIDA_REQUERIDA.join(', ')}.`;
  return null;
};

/** Validaciones de forma de un campo de formulario. Devuelve mensaje o null. */
const validarCampo = ({ codigo, etiqueta, tipo_campo, opciones }) => {
  if (!codigo?.trim()) return 'codigo es requerido';
  if (!RE_CODIGO_CAMPO.test(codigo.trim()))
    return "codigo debe ser snake_case: empezar con letra minúscula y usar solo letras, números y '_' (es lo que se escribe dentro de una condición).";
  if (!etiqueta?.trim()) return 'etiqueta es requerida';
  if (!TIPOS_CAMPO.includes(tipo_campo)) return `tipo_campo debe ser uno de: ${TIPOS_CAMPO.join(', ')}.`;

  if (tipo_campo === 'seleccion') {
    const lista = normalizarOpciones(opciones);
    if (lista.length < 2) return 'Un campo de selección necesita al menos dos opciones.';
    if (new Set(lista).size !== lista.length) return 'Las opciones no pueden repetirse.';
  }
  return null;
};

// Techo legal de la investigación cuando el involucrado es estudiante: 2 meses
// (art. 16 E letra g del DFL 2/2009, según Ley 21.809).
const DIAS_TECHO_ESTUDIANTE = 60;

// Techo legal cuando el involucrado es personal del establecimiento.
//
// El inciso final del art. 16 E es explícito: cuando se determina la
// responsabilidad administrativa de profesionales o asistentes de la educación
// en establecimientos "administrados por Servicios Locales, municipalidades o
// corporaciones municipales", los procedimientos investigativos "se regirán por
// los plazos y etapas establecidas en el Título V de la ley N° 18.834 (...) o,
// en su defecto, cuando corresponda, (...) de la ley N° 18.883".
//
// O sea que estos casos NO quedan sin plazo: quedan sujetos a otro. Antes acá
// se eximían, que es la mitad de la regla y la mitad equivocada.
//
// El tope se toma del tramo más largo que la ley admite: la instrucción de un
// sumario administrativo, 20 días hábiles prorrogables "hasta completar sesenta
// días" (art. 133 de la Ley 18.883; el art. 141 de la 18.834 es equivalente).
// Se elige el más permisivo a propósito: un protocolo que igual lo excede no
// cabe ni en el procedimiento más largo que la ley contempla.
//
// Y son días HÁBILES, no corridos: el art. 143 de la 18.883 lo dice sin
// ambigüedad — "los plazos señalados en este título serán de días hábiles".
const DIAS_HABILES_TECHO_PERSONAL = 60;

// Un día hábil ocupa ~1,4 días de calendario (5 hábiles por semana de 7). Es
// una aproximación deliberada: al guardar el grafo todavía no existe la fecha
// de inicio, así que no se puede saber qué feriados va a cruzar. Se prefiere
// aproximar por exceso, porque el error caro es dejar publicar un protocolo que
// en la práctica se pasa del plazo legal.
const DIAS_CALENDARIO = { horas: (v) => v / 24, dias_corridos: (v) => v, dias_habiles: (v) => v * 1.4 };

const plazoEnDias = (paso) =>
  !paso.plazo_valor || !paso.plazo_unidad ? 0 : DIAS_CALENDARIO[paso.plazo_unidad](paso.plazo_valor);

/**
 * Camino más largo en días de calendario, siguiendo las transiciones.
 *
 * Se toma el camino más largo y no la suma de todos los pasos porque un grafo
 * con ramas alternativas nunca las ejecuta todas: sumarlas rechazaría
 * protocolos que en la práctica siempre terminan a tiempo.
 *
 * Los ciclos se cortan (un paso no se cuenta dos veces en el mismo camino). Un
 * protocolo con vuelta atrás podría en teoría girar indefinidamente, pero eso
 * no es un problema de plazos sino de diseño del grafo, y lo reporta validarGrafo.
 */
const caminoMasLargoEnDias = (pasos, transiciones) => {
  const porId = new Map(pasos.map((p) => [p.id_paso, p]));
  const salidas = new Map();
  for (const t of transiciones) {
    if (!salidas.has(t.id_paso_origen)) salidas.set(t.id_paso_origen, []);
    salidas.get(t.id_paso_origen).push(t.id_paso_destino);
  }

  const desde = (id, enCamino) => {
    if (enCamino.has(id)) return 0;
    const paso = porId.get(id);
    if (!paso) return 0;
    enCamino.add(id);
    let peor = 0;
    for (const destino of salidas.get(id) ?? [])
      peor = Math.max(peor, desde(destino, enCamino));
    enCamino.delete(id);
    return plazoEnDias(paso) + peor;
  };

  const iniciales = pasos.filter((p) => p.es_paso_inicial);
  return Math.max(0, ...(iniciales.length > 0 ? iniciales : pasos).map((p) => desde(p.id_paso, new Set())));
};

/**
 * @returns {string[]} problemas; vacío si el protocolo cabe en el plazo legal
 */
const validarTechoLegal = (pasos, transiciones, ambito) => {
  const dias = caminoMasLargoEnDias(pasos, transiciones);

  // Un protocolo 'mixto' alcanza a estudiantes y a personal, así que tiene que
  // caber en el más corto de los dos techos: el del estudiante.
  const esSoloPersonal = ambito === 'personal';

  // El techo del personal está fijado en días hábiles y el camino más largo se
  // mide en días de calendario, así que se convierte con la misma equivalencia
  // que usa el resto del archivo.
  const techo = esSoloPersonal
    ? DIAS_CALENDARIO.dias_habiles(DIAS_HABILES_TECHO_PERSONAL)
    : DIAS_TECHO_ESTUDIANTE;

  if (dias <= techo) return [];

  return esSoloPersonal
    ? [
        `El camino más largo del protocolo suma ~${Math.round(dias)} días de calendario y la ` +
        `instrucción de un sumario administrativo no puede exceder ${DIAS_HABILES_TECHO_PERSONAL} días ` +
        `hábiles (~${Math.round(techo)} de calendario), ni siquiera con la prórroga del art. 133 de la ` +
        'Ley 18.883. El art. 16 E, inciso final, remite a esos plazos para los casos de personal.',
      ]
    : [
        `El camino más largo del protocolo suma ~${Math.round(dias)} días de calendario y la ` +
        `investigación de un caso con estudiantes no puede exceder 2 meses (~${DIAS_TECHO_ESTUDIANTE} días, ` +
        'art. 16 E letra g). Acortá los plazos de los pasos o marcá el protocolo como de ámbito personal.',
      ];
};

module.exports = {
  DIAS_TECHO_ESTUDIANTE,
  DIAS_HABILES_TECHO_PERSONAL,
  caminoMasLargoEnDias,
  validarTechoLegal,
  TIPOS_CAMPO,
  TIPOS_PASO,
  TIPOS_PASO_APROBACION,
  esPasoDeAprobacion,
  UNIDADES_PLAZO,
  ACCIONES_VENCER,
  TIPOS_PARTICIPACION,
  TIPOS_MEDIDA_REQUERIDA,
  normalizarMedidaRequerida,
  ROLES_INVOLUCRADO,
  ROLES_PARTE,
  ROLES_PASO_INVOLUCRADO,
  SQL_ROL_ALCANZA_PASO,
  TIPOS_PERSONA,
  MEDIOS_NOTIFICACION,
  involucradosDelPaso,
  TIPOS_DECIDIBLES,
  RE_CODIGO_CAMPO,
  CAMPO_APROBACION,
  camposDelPaso,
  elegirTransicion,
  calcularFechaLimite,
  validarDatosSalida,
  campoVisible,
  parsearCondicion,
  validarCondicion,
  validarDependencia,
  validarGrafo,
  pasosDescartados,
  validarPlazo,
  validarPaso,
  validarCampo,
  normalizarOpciones,
};
