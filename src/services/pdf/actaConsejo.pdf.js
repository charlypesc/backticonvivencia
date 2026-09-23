const { jsPDF } = require('jspdf');
const { formatearFecha } = require('../../utils/fecha');
const { etiquetaDe } = require('../../utils/etiquetas');
const { plano } = require('./comun');

// Formato del acta del Consejo de Profesores para la reconsideración de una
// suspensión cautelar (art. 6 letra d) del DFL 2 de 1998).
//
// La ley dice que el director resuelve la reconsideración "previa consulta al
// Consejo de Profesores, el que deberá pronunciarse por escrito". Este es ese
// escrito: se imprime con los datos del caso ya puestos, el Consejo lo completa
// y firma en la sesión, y se vuelve a subir escaneado como "acta_consejo".
//
// El Consejo se PRONUNCIA; la decisión es del director. Por eso el acta ofrece
// "recomienda acoger / rechazar" y no "se acoge / se rechaza", y lo dice al pie.
//
// Lo que ya está registrado en el sistema (fecha del Consejo, pronunciamiento)
// sale impreso; lo que falta queda en blanco para llenarse a mano. Un formato
// que no se puede imprimir porque falta un dato deja al Consejo sin acta.

const TINTA = [17, 24, 39];
const GRIS = [107, 114, 128];
const LINEA = [209, 213, 219];
const MARGEN = 56;

/**
 * @param d {{
 *   establecimiento: { nombre?: string, rbd?: string|number },
 *   caso: { id: number, protocolo?: string },
 *   estudiante: { nombre?: string, rut?: string, curso?: string },
 *   suspension: {
 *     fundamento: string, fecha_notificacion: any, medio_notificacion?: string,
 *     fecha_reconsideracion?: any, fecha_consejo?: any, consejo_profesores_acta?: string,
 *   },
 * }}
 * @returns {{ buffer: Buffer, nombre: string }}
 */
const construirActaConsejoPdf = (d) => {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const m = MARGEN;
  const util = ancho - m * 2;
  const piso = alto - 50;
  let y = m;

  const salto = (necesario) => {
    if (y + necesario > piso) {
      doc.addPage();
      y = m;
    }
  };

  const parrafo = (texto, tam = 10, estilo = 'normal', color = TINTA) => {
    doc.setFontSize(tam).setFont('helvetica', estilo);
    const lineas = doc.splitTextToSize(plano(texto), util);
    salto(lineas.length * (tam + 3) + 6);
    doc.setTextColor(...color);
    doc.text(lineas, m, y);
    y += lineas.length * (tam + 3) + 6;
  };

  const dato = (etiqueta, valor) => {
    const anchoEtiqueta = 130;
    doc.setFontSize(10).setFont('helvetica', 'normal');
    const lineas = doc.splitTextToSize(plano(valor) || '-', util - anchoEtiqueta);
    salto(lineas.length * 13 + 5);
    doc.setFontSize(8.5).setTextColor(...GRIS);
    doc.text(plano(etiqueta).toUpperCase(), m, y);
    doc.setFontSize(10).setTextColor(...TINTA);
    doc.text(lineas, m + anchoEtiqueta, y);
    y += lineas.length * 13 + 5;
  };

  const linea = () => {
    salto(16);
    doc.setDrawColor(...LINEA).setLineWidth(0.7);
    doc.line(m, y, ancho - m, y);
    y += 16;
  };

  // Pide espacio para el título más un par de renglones: un título solo al
  // pie de la hoja, con su contenido en la siguiente, es un título huérfano.
  const subtitulo = (texto) => {
    salto(90);
    parrafo(texto, 9, 'bold', GRIS);
  };

  /** Renglones para escribir a mano. */
  const renglones = (n) => {
    for (let i = 0; i < n; i++) {
      salto(22);
      y += 14;
      doc.setDrawColor(...LINEA).setLineWidth(0.6);
      doc.line(m, y, ancho - m, y);
      y += 8;
    }
    y += 6;
  };

  const casilla = (texto, x) => {
    doc.setDrawColor(...TINTA).setLineWidth(0.8);
    doc.rect(x, y - 9, 10, 10);
    doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(...TINTA);
    doc.text(plano(texto), x + 16, y);
  };

  // ── Encabezado ──────────────────────────────────────────────────────────
  if (d.establecimiento?.nombre) {
    doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(...TINTA);
    doc.text(plano(d.establecimiento.nombre), m, y);
    y += 14;
    if (d.establecimiento.rbd) {
      doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(...GRIS);
      doc.text(`RBD ${plano(d.establecimiento.rbd)}`, m, y);
      y += 14;
    }
  }
  doc.setFontSize(15).setFont('helvetica', 'bold').setTextColor(...TINTA);
  doc.text('ACTA DEL CONSEJO DE PROFESORES', m, y + 8);
  y += 24;
  parrafo(
    'Pronunciamiento sobre la solicitud de reconsideración de una suspensión cautelar ' +
      '(art. 6 letra d) del DFL 2 de 1998)',
    9.5, 'normal', GRIS,
  );
  linea();

  // ── La medida que se pide reconsiderar ──────────────────────────────────
  const s = d.suspension;
  dato('Caso', `N° ${d.caso.id}${d.caso.protocolo ? ` - ${d.caso.protocolo}` : ''}`);
  dato('Estudiante', d.estudiante?.nombre || '______________________________________');
  if (d.estudiante?.rut) dato('RUT', d.estudiante.rut);
  if (d.estudiante?.curso) dato('Curso', d.estudiante.curso);
  dato(
    'Suspensión notificada',
    `${formatearFecha(s.fecha_notificacion) || '-'}` +
      (s.medio_notificacion ? ` (${etiquetaDe(s.medio_notificacion, 'medio_notificacion').toLowerCase()})` : ''),
  );
  dato('Reconsideración pedida', formatearFecha(s.fecha_reconsideracion) || '____ / ____ / ________');
  dato('Fundamento de la medida', s.fundamento);
  y += 4;
  linea();

  // ── La sesión ───────────────────────────────────────────────────────────
  subtitulo('SESIÓN DEL CONSEJO');
  dato('Fecha', formatearFecha(s.fecha_consejo) || '____ / ____ / ________');
  dato('Hora y lugar', '______________________________________________');
  y += 4;

  subtitulo('PROFESORES ASISTENTES');
  // Tabla de asistencia: el pronunciamiento vale por quienes lo dieron, y es
  // lo primero que se pregunta si se impugna.
  const col = [m, m + util * 0.45, m + util * 0.72];
  const filaAlto = 22;
  salto(filaAlto * 2);
  doc.setFontSize(8.5).setFont('helvetica', 'bold').setTextColor(...GRIS);
  doc.text('NOMBRE', col[0], y);
  doc.text('CARGO / ASIGNATURA', col[1], y);
  doc.text('FIRMA', col[2], y);
  y += 6;
  doc.setDrawColor(...LINEA).setLineWidth(0.6);
  for (let i = 0; i < 10; i++) {
    salto(filaAlto);
    y += filaAlto;
    doc.line(m, y, ancho - m, y);
  }
  y += 16;

  subtitulo('ANTECEDENTES CONSIDERADOS');
  renglones(3);

  // ── El pronunciamiento ──────────────────────────────────────────────────
  subtitulo('PRONUNCIAMIENTO DEL CONSEJO');
  if (s.consejo_profesores_acta?.trim()) {
    parrafo(s.consejo_profesores_acta.trim());
    renglones(1);
  } else {
    renglones(5);
  }

  salto(70);
  parrafo('En mérito de lo anterior, el Consejo de Profesores:', 10, 'bold');
  y += 4;
  casilla('Recomienda ACOGER la reconsideración (dejar sin efecto la suspensión)', m);
  y += 20;
  casilla('Recomienda RECHAZAR la reconsideración (mantener la suspensión)', m);
  y += 24;
  doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(...TINTA);
  doc.text('Votos a favor: ______     En contra: ______     Abstenciones: ______', m, y);
  y += 24;

  // ── Firmas ──────────────────────────────────────────────────────────────
  salto(110);
  const anchoFirma = (util - 24) / 2;
  const firmar = (rotulo, x) => {
    doc.setDrawColor(...TINTA).setLineWidth(0.8);
    doc.line(x, y + 44, x + anchoFirma, y + 44);
    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(...TINTA);
    doc.text(plano(rotulo), x, y + 58);
    doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
    doc.text('Nombre:', x, y + 72);
  };
  firmar('Quien preside el Consejo', m);
  firmar('Secretario/a de actas', m + anchoFirma + 24);
  y += 92;

  doc.setFontSize(8).setFont('helvetica', 'italic').setTextColor(...GRIS);
  const pie = doc.splitTextToSize(
    plano(
      'El Consejo de Profesores se pronuncia por escrito como exige el art. 6 letra d) del DFL 2 de ' +
        '1998. La resolución de la reconsideración corresponde al Director del establecimiento, ' +
        'previa esta consulta. Una vez firmada, esta acta se adjunta al caso en el sistema.',
    ),
    util,
  );
  salto(pie.length * 10);
  doc.text(pie, m, y);

  // Pie con número de página: el acta puede pasar a una segunda hoja.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
    doc.text(`Caso N° ${d.caso.id} · Acta del Consejo de Profesores`, m, alto - 28);
    doc.text(`Página ${p} de ${total}`, ancho - m, alto - 28, { align: 'right' });
  }

  const persona = plano(d.estudiante?.nombre || '').replace(/[\\/:*?"<>|]/g, '').trim();
  return {
    buffer: Buffer.from(doc.output('arraybuffer')),
    nombre: `Acta Consejo de Profesores ${persona || 'caso ' + d.caso.id}.pdf`,
  };
};

module.exports = { construirActaConsejoPdf };
