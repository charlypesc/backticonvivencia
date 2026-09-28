const { jsPDF } = require('jspdf');
const { formatearFecha } = require('../../utils/fecha');
const { etiquetaDe } = require('../../utils/etiquetas');
const { plano } = require('./comun');

// El registro de convivencia tal como se llenó: el hecho, los involucrados, el
// relato y los acuerdos. Sin protocolo, bitácora ni medidas — eso es el
// expediente. Es la hoja que se imprime para archivar en la carpeta del
// estudiante o para que la firmen quienes estuvieron en la entrevista.

const TINTA = [17, 24, 39];
const GRIS = [107, 114, 128];
const LINEA = [209, 213, 219];
const MARGEN = 56;

/** "Registro 42 - Pelea en el recreo". Por número y asunto: así se busca en la carpeta. */
const nombreArchivo = (r) => {
  const asunto = plano(r.asunto).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60);
  return `Registro ${r.id_registro}${asunto ? ' - ' + asunto : ''}.pdf`;
};

/**
 * @param d {{ registro: object, estudiantes: object[], personal: object[] }}
 * @returns {{ buffer: Buffer, nombre: string }}
 */
const construirRegistroPdf = ({ registro: r, estudiantes, personal }) => {
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

  // El relato puede ocupar varias hojas: se corta línea por línea en vez de
  // mandar el bloque entero, que jsPDF dibujaría fuera del margen inferior.
  const parrafo = (texto, tam = 10, estilo = 'normal', color = TINTA) => {
    doc.setFontSize(tam).setFont('helvetica', estilo).setTextColor(...color);
    const alto_linea = tam + 3;
    for (const l of doc.splitTextToSize(plano(texto), util)) {
      salto(alto_linea);
      doc.text(l, m, y);
      y += alto_linea;
    }
    y += 6;
  };

  const dato = (etiqueta, valor) => {
    const anchoEtiqueta = 130;
    const lineas = doc.splitTextToSize(plano(valor) || '-', util - anchoEtiqueta);
    salto(lineas.length * 13 + 5);
    doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
    doc.text(plano(etiqueta).toUpperCase(), m, y);
    doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(...TINTA);
    doc.text(lineas, m + anchoEtiqueta, y);
    y += lineas.length * 13 + 5;
  };

  const linea = () => {
    salto(16);
    doc.setDrawColor(...LINEA).setLineWidth(0.7);
    doc.line(m, y, ancho - m, y);
    y += 16;
  };

  // Encabezado
  if (r.establecimiento_nombre) {
    doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(...TINTA);
    doc.text(plano(r.establecimiento_nombre), m, y);
    y += 14;
    if (r.rbd) {
      doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(...GRIS);
      doc.text(`RBD ${plano(r.rbd)}`, m, y);
      y += 14;
    }
  }
  doc.setFontSize(15).setFont('helvetica', 'bold').setTextColor(...TINTA);
  doc.text('REGISTRO DE CONVIVENCIA ESCOLAR', m, y + 8);
  doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(...GRIS);
  doc.text(`N° ${r.id_registro}`, ancho - m, y + 8, { align: 'right' });
  y += 30;
  linea();

  dato('Registrado por', r.autor_nombre || r.autor_correo);
  dato('Fecha de registro', formatearFecha(r.fecha_creacion, true));
  dato('Fecha del incidente', formatearFecha(r.fecha_incidente));
  dato('Motivo del registro',
    `${r.tipo_falta_nombre}${r.gravedad ? ` (${etiquetaDe(r.gravedad, 'opcion_campo')})` : ''}`);
  dato('Asunto', r.asunto);
  y += 4;
  linea();

  parrafo('ESTUDIANTES INVOLUCRADOS', 9, 'bold', GRIS);
  if (!estudiantes.length) parrafo('Sin estudiantes registrados.', 10, 'italic', GRIS);
  for (const e of estudiantes)
    parrafo(
      `- ${e.nombre} ${e.apellido} (${e.run}-${e.dv})` +
        (e.curso ? ` · ${e.curso}` : '') +
        (e.rol_en_incidente ? ` · ${etiquetaDe(e.rol_en_incidente, 'rol_involucrado')}` : ''),
    );

  if (personal.length) {
    parrafo('OTROS INVOLUCRADOS', 9, 'bold', GRIS);
    for (const p of personal)
      parrafo(
        `- ${p.nombre}${p.rut ? ` (${p.rut})` : ''} · ` +
          `${p.tipo_persona === 'funcionario' ? 'Funcionario' : 'Externo'}` +
          (p.rol_en_incidente ? ` · ${etiquetaDe(p.rol_en_incidente, 'rol_involucrado')}` : ''),
      );
  }
  linea();

  parrafo('ANTECEDENTES', 9, 'bold', GRIS);
  parrafo(r.antecedentes);
  parrafo('ACUERDOS', 9, 'bold', GRIS);
  parrafo(r.acuerdos?.trim() || 'Sin acuerdos registrados.', 10, r.acuerdos?.trim() ? 'normal' : 'italic',
    r.acuerdos?.trim() ? TINTA : GRIS);
  y += 4;

  // Firmas: quien registró y quien participó de la entrevista. En blanco la
  // segunda: puede ser el estudiante, el apoderado o nadie.
  salto(100);
  const anchoFirma = (util - 24) / 2;
  const firmar = (rotulo, detalle, x) => {
    doc.setDrawColor(...TINTA).setLineWidth(0.8);
    doc.line(x, y + 44, x + anchoFirma, y + 44);
    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(...TINTA);
    doc.text(plano(rotulo), x, y + 58);
    if (detalle) {
      doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
      doc.text(doc.splitTextToSize(plano(detalle), anchoFirma), x, y + 70);
    }
  };
  firmar('Firma de quien registra', r.autor_nombre || r.autor_correo, m);
  firmar('Firma del entrevistado / apoderado', '', m + anchoFirma + 24);

  return { buffer: Buffer.from(doc.output('arraybuffer')), nombre: nombreArchivo(r) };
};

module.exports = { construirRegistroPdf };
