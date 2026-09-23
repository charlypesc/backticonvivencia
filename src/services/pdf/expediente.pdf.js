const { jsPDF } = require('jspdf');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { formatearFecha, formatearFechasEnTexto } = require('../../utils/fecha');
const { etiquetaDe } = require('../../utils/etiquetas');
const { plano } = require('./comun');

// El expediente de un caso como PDF.
//
// Antes se armaba en el navegador con jsPDF + pdf-lib, bajando además cada
// acta firmada con una petición aparte. Se trajo al servidor tal cual: mismo
// diseño y mismas reglas, pero las actas se leen de la base en la misma pasada.
//
// El expediente es el antecedente que se le entrega a la Superintendencia, al
// sostenedor o a la familia, y ahí lo que importa es que el documento no se
// pueda alterar después de emitido. Por eso el único formato es PDF, e
// imprimir también pasa por él: lo que se firma en papel es exactamente el
// archivo que se descarga.

// Paleta sobria: el documento es un antecedente formal, no una pantalla.
const TINTA = [17, 24, 39];
const GRIS = [107, 114, 128];
const LINEA = [209, 213, 219];
const ACENTO = [30, 64, 175];
const ALERTA = [185, 28, 28];
const MARGEN = 54;

const fecha = (f) => formatearFecha(f) || '—';

/**
 * Texto listo para el papel: traduce los códigos de la base (`inicio_paso` no
 * es castellano), formatea las fechas pegadas en la frase y saca lo que no es
 * Latin-1.
 */
const texto = (valor, dominio) => {
  const bruto = String(valor ?? '');
  // Un valor todo en minúscula y sin espacios es un código de la base, no
  // algo que escribió una persona: solo esos se traducen.
  const codigo = /^[a-z][a-z0-9_]*$/.test(bruto);
  return plano(codigo ? etiquetaDe(bruto, dominio) : formatearFechasEnTexto(bruto));
};

/** "1 día hábil", "5 días hábiles". */
const plazo = (p) => {
  if (!p?.plazo_valor) return 'sin plazo';
  const SINGULAR = { horas: 'hora', dias_habiles: 'día hábil', dias_corridos: 'día corrido' };
  const unidad = p.plazo_valor === 1
    ? (SINGULAR[p.plazo_unidad] ?? texto(p.plazo_unidad, 'plazo_unidad'))
    : texto(p.plazo_unidad, 'plazo_unidad');
  return plano(`${p.plazo_valor} ${unidad}`);
};

const nombreArchivo = (e) => `expediente-${e.caso?.id_protocolo_activado ?? 'caso'}`;

const titulo = (e) => `${e.caso?.protocolo ?? 'Caso'} — versión ${e.caso?.version ?? '—'}`;

/**
 * Las actas firmadas que se anexan, en el orden en que se pegan: por paso y,
 * dentro del paso, por persona.
 *
 * En modo redactado la lista queda vacía a propósito —`formatear` no manda el
 * id de la gestión—, porque el acta escaneada trae nombre, RUT y firma:
 * anexarla sería deshacer la redacción con la fotocopia.
 */
const TITULO_DOCUMENTO = {
  solicitud_reconsideracion: 'Solicitud de reconsideración',
  acta_consejo: 'Acta del Consejo de Profesores',
};

// Cómo se nombra cada documento en la línea de la suspensión.
const EN_EL_CUERPO = {
  solicitud_reconsideracion: 'Solicitud de reconsideración firmada',
  acta_consejo: 'Acta firmada del Consejo de Profesores',
};

/**
 * Cada anexo trae `origen` (qué hay que leer de la base para pegarlo), su
 * título y las líneas de su hoja separadora. Primero las actas de
 * notificación, después los documentos de las suspensiones cautelares.
 */
const anexos = (e) => [
  ...(e.pasos ?? []).flatMap((p) =>
    (p.gestiones ?? [])
      .filter((g) => g.adjunto?.id_paso_involucrado)
      .map((g) => ({
        origen: { tipo: 'acta_notificacion', id_paso_involucrado: g.adjunto.id_paso_involucrado },
        titulo: 'Acta de notificación firmada',
        lineas: [
          `Paso: ${plano(p.nombre)}`,
          `Persona notificada: ${plano(g.involucrado?.nombre ?? g.involucrado?.iniciales ?? 'sin identificar')}`,
        ],
      })),
  ),
  ...(e.suspensiones_cautelares ?? []).flatMap((sc) =>
    (sc.documentos ?? [])
      .filter((d) => d.id_suspension_cautelar)
      .map((d) => ({
        origen: { tipo: 'suspension_cautelar', id_suspension_cautelar: d.id_suspension_cautelar, documento: d.tipo },
        titulo: TITULO_DOCUMENTO[d.tipo] ?? 'Documento de la suspensión cautelar',
        lineas: [
          'Suspensión cautelar (art. 6 letra d) del DFL 2 de 1998)',
          `Estudiante: ${plano(sc.persona?.nombre ?? sc.persona?.iniciales ?? 'sin identificar')}`,
        ],
      })),
  ),
];

/** El número de anexo de un origen, o null si no se anexa. */
const numeroDeAnexo = (lista, coincide) => {
  const i = lista.findIndex((a) => coincide(a.origen));
  return i >= 0 ? i + 1 : null;
};

/** Estructura del expediente; es la fuente única del documento. */
const secciones = (e) => {
  const t = texto;
  const cumplimiento = {
    en_plazo: 'Cumplido en plazo',
    fuera_de_plazo: 'Cumplido fuera de plazo',
    vencido: 'Vencido, sin cumplir',
    en_curso: 'En curso',
    sin_plazo: 'Sin plazo definido',
  };
  const incumple = (c) => c === 'fuera_de_plazo' || c === 'vencido';

  // Nombre en el expediente completo, iniciales en el redactado.
  const nombreDe = (p) => {
    const quien = t(p?.nombre ?? p?.iniciales) || 'sin identificar';
    return p?.rol ? `${quien} (${t(p.rol, 'rol_involucrado')})` : quien;
  };

  // Había que notificar a esta persona y no consta que se hiciera.
  const faltaConstancia = (p, g) =>
    !!p.requiere_notificacion && g.estado !== 'no_aplica' && !g.fecha_notificacion;

  // El número con que cada acta queda anexada: misma lista y mismo orden con
  // que después se pegan las páginas.
  const lista = anexos(e);
  const anexoDe = (g) =>
    numeroDeAnexo(lista, (o) => o.id_paso_involucrado === g.adjunto?.id_paso_involucrado);
  // "Solicitud de reconsideración en anexo 3" / "(adjunta)" en modo redactado.
  const documentosDe = (sc) =>
    (sc.documentos ?? []).map((d) => {
      const n = d.id_suspension_cautelar
        ? numeroDeAnexo(lista, (o) => o.id_suspension_cautelar === d.id_suspension_cautelar && o.documento === d.tipo)
        : null;
      return `${EN_EL_CUERPO[d.tipo] ?? 'Documento firmado'} ${n ? `en anexo ${n}` : '(adjunta en el sistema)'}`;
    });

  const salida = [
    {
      titulo: 'Identificación del caso',
      tipo: 'campos',
      campos: [
        { etiqueta: 'Establecimiento', valor: t(e.establecimiento?.nombre) || '—' },
        { etiqueta: 'RBD', valor: String(e.establecimiento?.rbd ?? '—') },
        {
          etiqueta: 'Protocolo aplicado',
          valor: `${t(e.caso?.protocolo) || '—'} - versión ${e.caso?.version ?? '—'}`,
        },
        { etiqueta: 'Categoría (ley)', valor: t(e.caso?.categoria_ley, 'opcion_campo') || '—' },
        { etiqueta: 'Fecha de activación', valor: fecha(e.caso?.fecha_activacion) },
        {
          etiqueta: 'Estado',
          valor:
            `${t(e.caso?.estado, 'estado_caso') || '—'}` +
            (e.caso?.fecha_cierre ? ` (cerrado el ${fecha(e.caso.fecha_cierre)})` : ''),
        },
        ...(e.caso?.motivo_cierre
          ? [{ etiqueta: 'Motivo del cierre', valor: t(e.caso.motivo_cierre) }]
          : []),
        { etiqueta: 'Plazo de investigación', valor: fecha(e.caso?.fecha_limite_investigacion) },
        { etiqueta: 'Protocolo activado por', valor: t(e.caso?.activado_por) || '—' },
      ],
    },
    {
      titulo: 'Antecedente inicial',
      tipo: 'campos',
      campos: [
        { etiqueta: 'Fecha del registro', valor: fecha(e.denuncia?.fecha_registro) },
        {
          etiqueta: 'Registrado por',
          valor: t(e.denuncia?.registrado_por_nombre) || t(e.denuncia?.registrado_por) || '—',
        },
        {
          etiqueta: 'Denunciante',
          valor:
            (e.denuncia?.denunciantes ?? [])
              .map((d) => t(d?.nombre ?? d?.iniciales))
              .filter(Boolean)
              .join(', ') || 'no se registró un denunciante',
        },
        // Sólo si lo hay: en un expediente cada línea se lee como si
        // acreditara algo.
        ...((e.denuncia?.documentos_origen ?? []).length
          ? [{
              etiqueta: 'Documento de origen',
              valor: e.denuncia.documentos_origen
                .map((d) => `${t(d.tipo_archivo)} (${fecha(d.fecha_subida)})`)
                .join(', '),
            }]
          : []),
      ],
    },
    {
      titulo: 'Hecho denunciado',
      tipo: 'campos',
      campos: [
        { etiqueta: 'Fecha del incidente', valor: fecha(e.hecho?.fecha_incidente) },
        {
          etiqueta: 'Tipo de falta',
          valor: `${t(e.hecho?.tipo_falta) || '—'} (${t(e.hecho?.gravedad, 'opcion_campo') || '—'})`,
        },
        { etiqueta: 'Asunto', valor: t(e.hecho?.asunto) || '—' },
        { etiqueta: 'Antecedentes', valor: t(e.hecho?.antecedentes) || '—' },
        { etiqueta: 'Acuerdos', valor: t(e.hecho?.acuerdos) || '—' },
      ],
    },
    {
      titulo: 'Involucrados',
      tipo: 'items',
      items: (e.involucrados ?? []).map((i) => ({
        titulo: i.iniciales ? t(i.iniciales) : t(i.nombre),
        marca: t(i.rol, 'rol_involucrado') || 'sin rol indicado',
        detalles: [
          t(i.tipo_persona, 'tipo_persona'),
          // En modo redactado no vienen: identifican a la persona.
          ...(i.rut ? [`RUT ${i.rut}`] : []),
          ...(i.curso ? [`Curso: ${t(i.curso)}`] : []),
        ].filter(Boolean),
      })),
    },
    {
      titulo: 'Pasos ejecutados',
      tipo: 'items',
      items: (e.pasos ?? []).map((p) => ({
        titulo: t(p.nombre),
        marca: cumplimiento[p.cumplimiento] ?? t(p.cumplimiento),
        alerta: incumple(p.cumplimiento) || (p.gestiones ?? []).some((g) => faltaConstancia(p, g)),
        detalles: [
          `Estado: ${t(p.estado, 'estado_paso')} · Plazo: ${plazo(p)} · ` +
            `Vence: ${fecha(p.fecha_limite)} · Completado: ${fecha(p.fecha_completado)}` +
            (p.responsable ? ` · Responsable: ${t(p.responsable)}` : ''),
          ...(p.campos ?? [])
            .filter((c) => c.valor !== null && c.valor !== undefined && c.valor !== '')
            // Un campo `seleccion` guarda el código: va la etiqueta.
            .map((c) => `${t(c.etiqueta)}: ${t(c.valor, 'opcion_campo')}`),
          // La actuación persona por persona: sin estas líneas no consta con
          // quién se hizo la entrevista o la notificación.
          ...(p.gestiones ?? []).flatMap((g) => {
            const quien = nombreDe(g.involucrado);
            const cabeza =
              `${quien}: ${t(g.estado, 'estado_gestion')}` +
              (g.fecha_gestion ? ` · Gestión del ${fecha(g.fecha_gestion)}` : '') +
              // Cuándo y CÓMO se notificó, siempre juntos.
              (g.fecha_notificacion
                ? ` · Notificado el ${fecha(g.fecha_notificacion)} por ` +
                  (g.medio_notificacion
                    ? t(g.medio_notificacion, 'medio_notificacion')
                    : 'vía no registrada')
                : faltaConstancia(p, g)
                  ? ' · SIN CONSTANCIA DE NOTIFICACIÓN'
                  : '') +
              (g.adjunto
                ? ` · Acta firmada${anexoDe(g) ? ` en anexo ${anexoDe(g)}` : ''}` +
                  (g.adjunto.nombre_archivo ? ` (${t(g.adjunto.nombre_archivo)})` : '')
                : '');
            return [cabeza, ...(g.observacion ? [`   ${quien} — ${t(g.observacion)}`] : [])];
          }),
        ],
      })),
    },
    // Solo si el caso tuvo ramas descartadas.
    ...((e.pasos_no_aplicables ?? []).length
      ? [{
          titulo: 'Pasos que no correspondieron',
          tipo: 'items',
          items: e.pasos_no_aplicables.map((p) => ({
            titulo: t(p.nombre),
            marca: 'No aplicable',
            detalles: [t(p.motivo)],
          })),
        }]
      : []),
    {
      titulo: 'Medidas de protección',
      tipo: 'items',
      items: (e.medidas_proteccion ?? []).map((m) => ({
        titulo: t(m.tipo, 'tipo_medida_proteccion') + (m.es_reaplicacion ? ' (reaplicación)' : ''),
        marca: t(m.estado, 'estado_medida'),
        detalles: [
          ...(m.persona ? [`Persona: ${nombreDe(m.persona)}`] : []),
          `Vigencia: ${fecha(m.fecha_inicio)} al ${fecha(m.fecha_termino)}`,
          ...(m.fundamento ? [`Fundamento: ${t(m.fundamento)}`] : []),
          // El seguimiento es la mitad de la obligación del art. 16 E letra j.
          ...(m.seguimientos ?? []).map(
            (s) => `Seguimiento ${fecha(s.fecha)} — ${t(s.tipo, 'tipo_seguimiento')}: ${t(s.descripcion)}`,
          ),
          ...((m.seguimientos ?? []).length === 0 ? ['Sin seguimientos registrados'] : []),
        ],
      })),
    },
    // Art. 6 letra d) del DFL 2/1998: la decreta el director, plazo fatal.
    {
      titulo: 'Suspensiones cautelares',
      tipo: 'items',
      items: (e.suspensiones_cautelares ?? []).map((s) => ({
        titulo: s.persona ? nombreDe(s.persona) : 'Suspensión cautelar',
        marca: t(s.estado, 'estado_suspension_cautelar'),
        alerta: s.estado === 'vencida',
        detalles: [
          `Notificada el ${fecha(s.fecha_notificacion)}` +
            (s.medio_notificacion ? ` (${t(s.medio_notificacion, 'medio_notificacion')})` : ''),
          `Plazo para resolver: ${fecha(s.fecha_limite_resolucion)} · ` +
            `Resuelta: ${fecha(s.fecha_resolucion)}`,
          `Fundamento: ${t(s.fundamento)}`,
          s.fecha_reconsideracion
            ? `Reconsideración presentada el ${fecha(s.fecha_reconsideracion)}` +
              (s.resultado_reconsideracion
                ? ` — ${t(s.resultado_reconsideracion, 'resultado_reconsideracion')}`
                : ' — sin resolver') +
              (s.fecha_consejo ? ` · Consejo de Profesores del ${fecha(s.fecha_consejo)}` : '')
            : `Sin reconsideración (plazo hasta ${fecha(s.fecha_limite_reconsideracion)})`,
          ...(s.consejo_profesores_acta
            ? [`Pronunciamiento del Consejo: ${t(s.consejo_profesores_acta)}`]
            : []),
          ...(s.decretada_por ? [`Decretada por: ${t(s.decretada_por)}`] : []),
          ...documentosDe(s),
        ],
      })),
    },
    {
      titulo: 'Medidas disciplinarias y sus resultados',
      tipo: 'items',
      items: (e.medidas_disciplinarias ?? []).map((m) => ({
        titulo: t(m.descripcion),
        marca: fecha(m.fecha_aplicacion),
        alerta: !m.resultado,
        detalles: [
          ...(m.persona ? [`Persona: ${nombreDe(m.persona)}`] : []),
          `Resultado: ${t(m.resultado) || 'sin registrar'}`,
        ],
      })),
    },
    // Solo cuando hubo expulsión.
    ...(e.informe_expulsion
      ? [{
          titulo: 'Informe de expulsión o cancelación de matrícula',
          tipo: 'campos',
          campos: [
            { etiqueta: 'Medida', valor: t(e.informe_expulsion.medida, 'opcion_campo') || '—' },
            {
              etiqueta: 'Recomendación',
              valor: t(e.informe_expulsion.recomendacion, 'opcion_campo') || '—',
            },
            {
              etiqueta: 'Decisión del director',
              valor: t(e.informe_expulsion.decision_director, 'opcion_campo') || 'pendiente',
            },
            { etiqueta: 'Emitido el', valor: fecha(e.informe_expulsion.fecha_emision) },
            {
              // De esta notificación cuelgan los plazos: la vía va con la fecha.
              etiqueta: 'Notificado al apoderado',
              valor: e.informe_expulsion.fecha_notificacion_apoderado
                ? `${fecha(e.informe_expulsion.fecha_notificacion_apoderado)} por ` +
                  (e.informe_expulsion.medio_notificacion_apoderado
                    ? t(e.informe_expulsion.medio_notificacion_apoderado, 'medio_notificacion')
                    : 'vía no registrada')
                : '—',
            },
            {
              etiqueta: 'Informado a la Superintendencia',
              valor: fecha(e.informe_expulsion.fecha_informe_superintendencia),
            },
            { etiqueta: 'Informado a la SEREMI', valor: fecha(e.informe_expulsion.fecha_informe_seremi) },
          ],
        }]
      : []),
    {
      titulo: 'Bitácora',
      tipo: 'items',
      items: (e.bitacora ?? []).map((b) => ({
        titulo: t(b.tipo_evento, 'tipo_evento'),
        marca: fecha(b.fecha),
        detalles: [t(b.descripcion) + (b.usuario ? ` (${t(b.usuario)})` : '')].filter((d) => d.trim()),
      })),
    },
    {
      titulo: 'Resumen de cumplimiento',
      tipo: 'campos',
      campos: [
        { etiqueta: 'Pasos que correspondían', valor: String(e.resumen_cumplimiento?.pasos_totales ?? 0) },
        ...(e.resumen_cumplimiento?.pasos_no_aplicables
          ? [{
              etiqueta: 'Pasos de ramas no tomadas',
              valor: String(e.resumen_cumplimiento.pasos_no_aplicables),
            }]
          : []),
        { etiqueta: 'Cumplidos en plazo', valor: String(e.resumen_cumplimiento?.en_plazo ?? 0) },
        { etiqueta: 'Cumplidos fuera de plazo', valor: String(e.resumen_cumplimiento?.fuera_de_plazo ?? 0) },
        { etiqueta: 'Vencidos sin cumplir', valor: String(e.resumen_cumplimiento?.vencidos_abiertos ?? 0) },
        { etiqueta: 'Personas involucradas', valor: String(e.resumen_cumplimiento?.involucrados ?? 0) },
        {
          etiqueta: 'Gestiones por persona pendientes',
          valor: String(e.resumen_cumplimiento?.gestiones_pendientes ?? 0),
        },
        {
          etiqueta: 'Notificaciones sin constancia',
          valor: String(e.resumen_cumplimiento?.notificaciones_pendientes ?? 0),
        },
      ],
    },
  ];

  // Una sección de items vacía no se omite: "sin medidas de protección" es
  // información, no un hueco.
  return salida.filter((s) => (s.tipo === 'campos' ? s.campos.length : true));
};

// ── Armado del documento ──────────────────────────────────────────────────

/** Encabezado de la primera página. Devuelve la `y` donde sigue el cuerpo. */
const portada = (doc, e, ancho, util) => {
  const m = MARGEN;
  let y = m + 6;

  doc.setFontSize(8.5).setFont('helvetica', 'bold').setTextColor(...GRIS);
  doc.text(plano(e.establecimiento?.nombre || 'Establecimiento').toUpperCase(), m, y);
  doc.text(`RBD ${e.establecimiento?.rbd ?? '-'}`, ancho - m, y, { align: 'right' });
  y += 10;

  doc.setDrawColor(...ACENTO).setLineWidth(1.5);
  doc.line(m, y, m + util, y);
  y += 26;

  doc.setFontSize(19).setFont('helvetica', 'bold').setTextColor(...TINTA);
  doc.text('Expediente del caso', m, y);
  y += 16;

  doc.setFontSize(10.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
  doc.text(doc.splitTextToSize(plano(titulo(e)), util), m, y);
  y += 18;

  doc.setFontSize(8.5);
  doc.text(`Emitido el ${fecha(e.emitido_el)}`, m, y);
  y += 18;

  if (e.modo === 'redactado') {
    // Cambia lo que el documento prueba: tiene que verse antes de leer nada.
    const etiqueta = 'DATOS PERSONALES RESGUARDADOS';
    doc.setFontSize(8).setFont('helvetica', 'bold');
    const anchoCaja = doc.getTextWidth(etiqueta) + 16;
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(217, 119, 6).setLineWidth(0.5);
    doc.roundedRect(m, y - 10, anchoCaja, 16, 3, 3, 'FD');
    doc.setTextColor(146, 64, 14);
    doc.text(etiqueta, m + 8, y);
    y += 16;
  }

  return y + 12;
};

const tituloSeccion = (doc, tituloTexto, y, util) => {
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(...ACENTO);
  doc.text(plano(tituloTexto).toUpperCase(), MARGEN, y);
  doc.setDrawColor(...LINEA).setLineWidth(0.5);
  doc.line(MARGEN, y + 6, MARGEN + util, y + 6);
  return y + 22;
};

/** Pie en todas las páginas. Al final, porque el "de N" no se sabe antes. */
const pies = (doc, e, ancho, alto) => {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINEA).setLineWidth(0.5);
    doc.line(MARGEN, alto - 42, ancho - MARGEN, alto - 42);
    doc.setFontSize(7.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
    doc.text(
      plano(`Documento reservado · ${e.establecimiento?.nombre ?? ''} · ${nombreArchivo(e)}`),
      MARGEN,
      alto - 30,
    );
    doc.text(`Página ${p} de ${total}`, ancho - MARGEN, alto - 30, { align: 'right' });
  }
};

const documento = (e) => {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const m = MARGEN;
  const util = ancho - m * 2;
  // Pie fijo: el cuerpo nunca baja de esta línea.
  const piso = alto - 56;

  let y = portada(doc, e, ancho, util);

  const salto = (necesario) => {
    if (y + necesario > piso) {
      doc.addPage();
      y = m + 10;
    }
  };

  for (const s of secciones(e)) {
    // Título más su primera línea: un título solo al pie de la hoja es huérfano.
    salto(52);
    y = tituloSeccion(doc, s.titulo, y, util);

    if (s.tipo === 'campos') {
      for (const c of s.campos) {
        const etiquetaAncho = 132;
        const valor = doc.splitTextToSize(plano(c.valor) || '-', util - etiquetaAncho);
        salto(valor.length * 12 + 4);

        doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
        doc.text(plano(c.etiqueta).toUpperCase(), m, y);

        doc.setFontSize(9.5).setFont('helvetica', 'normal').setTextColor(...TINTA);
        doc.text(valor, m + etiquetaAncho, y);
        y += valor.length * 12 + 5;
      }
      y += 8;
      continue;
    }

    if (!s.items.length) {
      salto(18);
      doc.setFontSize(9.5).setFont('helvetica', 'italic').setTextColor(...GRIS);
      doc.text('Sin registros.', m, y);
      y += 22;
      continue;
    }

    for (const item of s.items) {
      // Se mide antes de dibujar: un bloque partido deja el detalle sin título.
      doc.setFontSize(8).setFont('helvetica', 'bold');
      const marca = plano(item.marca).toUpperCase();
      const marcaAncho = marca ? doc.getTextWidth(marca) + 12 : 0;

      doc.setFontSize(10).setFont('helvetica', 'bold');
      const lineasTitulo = doc.splitTextToSize(plano(item.titulo) || '-', util - marcaAncho - 20);

      doc.setFontSize(9).setFont('helvetica', 'normal');
      const detalles = (item.detalles ?? []).flatMap((d) => doc.splitTextToSize(plano(d), util - 14));
      salto(lineasTitulo.length * 12 + detalles.length * 11 + 14);

      const yBloque = y;

      doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(...TINTA);
      doc.text(lineasTitulo, m + 14, y);

      if (marca) {
        doc.setFontSize(8).setFont('helvetica', 'bold');
        doc.setTextColor(...(item.alerta ? ALERTA : GRIS));
        doc.text(marca, ancho - m, y, { align: 'right' });
      }
      y += lineasTitulo.length * 12 + 1;

      doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(...GRIS);
      for (const linea of detalles) {
        doc.text(linea, m + 14, y);
        y += 11;
      }

      // Filete a la izquierda: separa un bloque del siguiente sin gastar una línea.
      doc.setDrawColor(...(item.alerta ? ALERTA : LINEA)).setLineWidth(2);
      doc.line(m + 2, yBloque - 8, m + 2, y - 6);

      y += 10;
    }
    y += 6;
  }

  pies(doc, e, ancho, alto);
  return doc;
};

// ── Anexos: las actas firmadas ─────────────────────────────────────────────

/** Hoja separadora: qué documento viene a continuación y de quién es. */
const portadaAnexo = (pdf, negrita, normal, numero, a, error) => {
  const pagina = pdf.addPage([612, 792]);
  let y = 720;
  const linea = (txt, fuente, tamano, gris = false) => {
    pagina.drawText(plano(txt), {
      x: 54, y, size: tamano, font: fuente,
      color: gris ? rgb(0.42, 0.45, 0.5) : rgb(0.07, 0.09, 0.15),
    });
    y -= tamano + 8;
  };
  linea(`ANEXO ${numero}`, negrita, 10, true);
  y -= 8;
  linea(a.titulo, negrita, 17);
  y -= 6;
  for (const l of a.lineas) linea(l, normal, 11, true);
  if (error) linea(error, normal, 11);
};

/** Nota suelta cuando el archivo llegó pero no se pudo pegar. */
const notaAnexo = (pdf, normal, txt) => {
  pdf.addPage([612, 792]).drawText(plano(txt), {
    x: 54, y: 690, size: 11, font: normal, color: rgb(0.72, 0.11, 0.11),
  });
};

/**
 * El expediente como PDF, con las actas firmadas pegadas al final.
 *
 * Van completas: el acta firmada es la única prueba de que la persona recibió
 * la notificación. Si una no se puede leer o el archivo está roto, el
 * expediente se emite igual con una hoja que dice qué faltó — perder el
 * documento completo por un adjunto ilegible es el peor de los dos resultados.
 *
 * `leerAnexo(origen)` devuelve `{ mime_type, contenido }` o null. `origen` es
 * `{ tipo: 'acta_notificacion', id_paso_involucrado }` o
 * `{ tipo: 'suspension_cautelar', id_suspension_cautelar, documento }`.
 *
 * @returns {Promise<{ buffer: Buffer, nombre: string }>}
 */
const construirExpedientePdf = async (e, leerAnexo) => {
  const doc = documento(e);
  const nombre = `${nombreArchivo(e)}.pdf`;
  const lista = anexos(e);
  const base = Buffer.from(doc.output('arraybuffer'));
  if (!lista.length) return { buffer: base, nombre };

  try {
    const pdf = await PDFDocument.load(base);
    const normal = await pdf.embedFont(StandardFonts.Helvetica);
    const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);

    for (let i = 0; i < lista.length; i++) {
      const a = lista[i];
      let archivo = null;
      let error = '';
      try {
        archivo = await leerAnexo(a.origen);
        if (!archivo) error = 'El archivo no se encontró en el sistema.';
      } catch {
        error = 'No fue posible recuperar el archivo desde el sistema.';
      }

      portadaAnexo(pdf, negrita, normal, i + 1, a, error);
      if (!archivo) continue;

      try {
        const mime = String(archivo.mime_type ?? '');
        if (mime === 'application/pdf') {
          const origen = await PDFDocument.load(archivo.contenido, { ignoreEncryption: true });
          for (const pagina of await pdf.copyPages(origen, origen.getPageIndices())) pdf.addPage(pagina);
        } else {
          const imagen = mime.includes('png')
            ? await pdf.embedPng(archivo.contenido)
            : await pdf.embedJpg(archivo.contenido);
          const pagina = pdf.addPage([612, 792]);
          // Ajustada a la hoja conservando la proporción: tiene que leerse.
          const escala = Math.min((612 - 72) / imagen.width, (792 - 72) / imagen.height, 1);
          pagina.drawImage(imagen, {
            x: (612 - imagen.width * escala) / 2,
            y: (792 - imagen.height * escala) / 2,
            width: imagen.width * escala,
            height: imagen.height * escala,
          });
        }
      } catch {
        notaAnexo(pdf, normal, 'El archivo adjunto no se pudo incorporar al expediente.');
      }
    }

    return { buffer: Buffer.from(await pdf.save({ useObjectStreams: true })), nombre };
  } catch (err) {
    // El expediente vale por sí solo: antes que no emitir nada, sin anexos.
    console.error('No se pudieron anexar las actas firmadas', err);
    return { buffer: base, nombre };
  }
};

module.exports = { construirExpedientePdf };
