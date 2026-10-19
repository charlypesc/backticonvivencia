const { jsPDF } = require('jspdf');
const { formatearFecha } = require('../../utils/fecha');
const { plano } = require('./comun');

// La resolución que firma el director por una medida de la tarjeta "Medidas"
// (excepcionales y condicionalidad): se imprime, se firma y vuelve a subirse
// escaneada. La ley no exige esa firma para estas medidas (solo para la
// expulsión, la cancelación de matrícula y la suspensión cautelar, art. 6 letra
// d del DFL 2), pero son las más graves de la tarjeta y las que más se
// reclaman, así que el establecimiento las deja firmadas por la dirección.
//
// Mismo formato que el acta de notificación (actaNotificacion.pdf.js): una
// hoja que se lee completa antes de firmar.

const TINTA = [17, 24, 39];
const GRIS = [107, 114, 128];
const LINEA = [209, 213, 219];
const MARGEN = 56;

const TITULO = { resolucion_director: 'RESOLUCION DE MEDIDA' };

const nombreArchivo = (d) => {
  const persona = plano(d.persona.nombre).replace(/[\\/:*?"<>|]/g, '').trim();
  const que = 'Resolucion';
  return `${d.caso.codigo ? d.caso.codigo + ' - ' : ''}${que} ${d.medida.etiqueta} - ${persona || 'caso'}.pdf`;
};

/**
 * @param d {{
 *   tipo: 'resolucion_director',
 *   establecimiento?: { nombre?: string, rbd?: string|number } | null,
 *   caso: { id: number, codigo?: string, protocolo: string, registro_codigo?: string, asunto?: string, fecha_incidente?: string },
 *   persona: { nombre: string, rut?: string, curso?: string, rol?: string },
 *   medida: { etiqueta: string, descripcion?: string, fundamento?: string, dias_habiles?: number,
 *             fecha_aplicacion?: string, fecha_termino?: string },
 *   director?: { nombre?: string } | null,
 *   emisor: { nombre?: string, cargo?: string, correo: string },
 * }}
 */
const construirDocumentoMedidaPdf = (d) => {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const m = MARGEN;
  const util = ancho - m * 2;
  let y = m;

  const salto = (necesario) => {
    if (y + necesario > alto - 50) {
      doc.addPage();
      y = m;
    }
  };
  const parrafo = (texto, tam = 10, estilo = 'normal', color = TINTA) => {
    doc.setFontSize(tam).setFont('helvetica', estilo).setTextColor(...color);
    const lineas = doc.splitTextToSize(plano(texto), util);
    salto(lineas.length * (tam + 3) + 6);
    doc.text(lineas, m, y);
    y += lineas.length * (tam + 3) + 6;
  };
  const dato = (etiqueta, valor) => {
    const anchoEtiqueta = 130;
    doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
    doc.text(plano(etiqueta).toUpperCase(), m, y);
    doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(...TINTA);
    const lineas = doc.splitTextToSize(plano(valor) || '-', util - anchoEtiqueta);
    doc.text(lineas, m + anchoEtiqueta, y);
    y += lineas.length * 13 + 5;
  };
  const linea = () => {
    doc.setDrawColor(...LINEA).setLineWidth(0.7);
    doc.line(m, y, ancho - m, y);
    y += 16;
  };
  const firma = (rotulo, detalle, x, anchoFirma) => {
    doc.setDrawColor(...TINTA).setLineWidth(0.8);
    doc.line(x, y + 44, x + anchoFirma, y + 44);
    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(...TINTA);
    doc.text(plano(rotulo), x, y + 58);
    doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
    const lineas = (Array.isArray(detalle) ? detalle : [detalle])
      .filter(Boolean)
      .flatMap((t) => doc.splitTextToSize(plano(t), anchoFirma));
    doc.text(lineas, x, y + 70);
  };

  // Encabezado
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
  doc.text(TITULO[d.tipo], m, y + 8);
  y += 26;
  doc.setFontSize(9.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
  doc.text(plano(d.medida.etiqueta), m, y);
  y += 18;
  linea();

  dato('Estudiante', d.persona.nombre);
  if (d.persona.rut) dato('RUT', d.persona.rut);
  if (d.persona.curso) dato('Curso', d.persona.curso);
  if (d.persona.rol) dato('Calidad en el caso', d.persona.rol);
  dato('Caso', `${d.caso.codigo ?? 'N° ' + d.caso.id} - ${d.caso.protocolo}`);
  if (d.caso.registro_codigo) dato('Registro', d.caso.registro_codigo);
  if (d.caso.asunto) dato('Asunto', d.caso.asunto);
  if (d.caso.fecha_incidente) dato('Fecha del hecho', formatearFecha(d.caso.fecha_incidente));
  y += 6;
  linea();

  parrafo('SE RESUELVE APLICAR', 9, 'bold', GRIS);
  parrafo(
    d.medida.etiqueta +
      (d.medida.dias_habiles ? ` por ${d.medida.dias_habiles} días hábiles` : '') +
      (d.medida.fecha_aplicacion ? `, desde el ${formatearFecha(d.medida.fecha_aplicacion)}` : '') +
      (d.medida.fecha_termino ? ` hasta el ${formatearFecha(d.medida.fecha_termino)}` : '') +
      '.',
    11, 'bold',
  );
  if (d.medida.descripcion && d.medida.descripcion !== d.medida.etiqueta) parrafo(d.medida.descripcion);
  y += 4;
  parrafo('FUNDAMENTO', 9, 'bold', GRIS);
  if (d.medida.fundamento) parrafo(d.medida.fundamento);
  else {
    parrafo('_______________________________________________________________________');
    parrafo('_______________________________________________________________________');
  }
  y += 4;
  // Lo que la normativa pide de estas medidas, para que quien firma lo tenga
  // a la vista.
  parrafo(
    d.medida.tipo === 'condicionalidad'
      ? 'La condicionalidad de matrícula debe ser revisada por el establecimiento al final de cada ' +
          'semestre, independientemente de la fecha en que se haya aplicado (Circular 482).'
      : 'Las medidas excepcionales deben estar justificadas y debidamente acreditadas antes de su ' +
          'adopción, y comunicarse por escrito al estudiante y a su apoderado con las razones que las hacen ' +
          'adecuadas y las medidas de apoyo pedagógico o psicosocial que se aplicarán (Circular 482, p. 47).',
    8.5, 'italic', GRIS,
  );
  dato('Fecha de emisión', formatearFecha(new Date(), true));
  y += 4;
  linea();

  const anchoFirma = (util - 24) / 2;
  salto(110);
  firma('Firma del Director(a)', [d.director?.nombre || 'Nombre: ____________________________', 'Director(a) del establecimiento'], m, anchoFirma);
  firma('Firma de quien propone la medida', [d.emisor.nombre ?? '', d.emisor.cargo ?? ''], m + anchoFirma + 24, anchoFirma);
  y += 100;

  return { buffer: Buffer.from(doc.output('arraybuffer')), nombre: nombreArchivo(d) };
};

module.exports = { construirDocumentoMedidaPdf };
