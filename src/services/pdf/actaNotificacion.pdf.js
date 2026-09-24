const { jsPDF } = require('jspdf');
const { formatearFecha } = require('../../utils/fecha');
const { plano } = require('./comun');

// El acta de notificación que se imprime, se firma en papel y se vuelve a
// subir escaneada.
//
// Existe porque la constancia que guarda el sistema (fecha + vía) prueba lo
// que el establecimiento dice haber hecho, no lo que la persona reconoce haber
// recibido. Lo segundo se prueba con una firma, y para firmar hace falta un
// papel: este.
//
// Es una hoja y no un expediente a propósito: quien la firma tiene que poder
// leer completo lo que se le notifica y en qué plazo puede reclamar.
//
// Antes se armaba en el navegador con los datos que juntaba la pantalla del
// caso. Ahora los junta el servidor (ver `generarActaNotificacion` en
// involucrados.controller.js), así el papel que se firma no depende de lo que
// el cliente tenga cargado en ese momento.

const TINTA = [17, 24, 39];
const GRIS = [107, 114, 128];
const LINEA = [209, 213, 219];
const MARGEN = 56;

/**
 * "Notificacion Benjamin Aburto". Por la persona y no por el número del caso:
 * quien busca el archivo en la carpeta lo busca por el alumno.
 */
const nombreArchivo = (d) => {
  const persona = plano(d.persona.nombre).replace(/[\\/:*?"<>|]/g, '').trim();
  const quien = d.destinatario === 'apoderado' ? 'Notificacion apoderado de' : 'Notificacion';
  return `${quien} ${persona || 'caso ' + d.caso.id}.pdf`;
};

/**
 * @param d {{
 *   establecimiento?: { nombre?: string, rbd?: string|number } | null,
 *   caso: { id: number, protocolo: string, asunto?: string, fecha_incidente?: string },
 *   paso: { nombre: string },
 *   persona: { nombre: string, rut?: string, curso?: string, rol?: string },
 *   destinatario: 'estudiante' | 'apoderado',
 *   medidas: { descripcion: string, tipo_medida?: string, fecha_aplicacion?: string }[],
 *   plazo: string,
 *   nota?: string,
 *   notificador: { nombre?: string, cargo?: string, correo: string },
 * }}
 * @returns {{ buffer: Buffer, nombre: string }}
 */
const construirActaNotificacionPdf = (d) => {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const m = MARGEN;
  const util = ancho - m * 2;
  let y = m;

  // Una hoja suele alcanzar, pero una nota larga o varias medidas la pasan: se
  // salta de página antes de cortar un bloque o dejar las firmas afuera.
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
    const anchoEtiqueta = 120;
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
  const alApoderado = d.destinatario === 'apoderado';
  doc.setFontSize(15).setFont('helvetica', 'bold').setTextColor(...TINTA);
  doc.text(alApoderado ? 'ACTA DE NOTIFICACION AL APODERADO' : 'ACTA DE NOTIFICACION', m, y + 8);
  y += 26;
  doc.setFontSize(9.5).setFont('helvetica', 'normal').setTextColor(...GRIS);
  doc.text(plano(d.paso.nombre), m, y);
  y += 18;
  linea();

  // A quién y por qué. Al apoderado se lo identifica a mano —el sistema no lo
  // tiene— y el estudiante pasa a ser de quién es apoderado, no el notificado.
  const enBlanco = '______________________________________________';
  if (alApoderado) {
    dato('Apoderado de', d.persona.nombre);
    if (d.persona.rut) dato('RUT del estudiante', d.persona.rut);
    if (d.persona.curso) dato('Curso', d.persona.curso);
    if (d.persona.rol) dato('Calidad en el caso', d.persona.rol);
    dato('Nombre del apoderado', enBlanco);
    dato('RUT del apoderado', enBlanco);
  } else {
    dato('Notificado a', d.persona.nombre);
    if (d.persona.rut) dato('RUT', d.persona.rut);
    if (d.persona.curso) dato('Curso', d.persona.curso);
    if (d.persona.rol) dato('Calidad en el caso', d.persona.rol);
  }
  dato('Caso', `N° ${d.caso.id} - ${d.caso.protocolo}`);
  if (d.caso.asunto) dato('Asunto', d.caso.asunto);
  if (d.caso.fecha_incidente) dato('Fecha del hecho', formatearFecha(d.caso.fecha_incidente));
  dato('Fecha de notificacion', formatearFecha(new Date(), true));
  y += 6;
  linea();

  // Lo que se notifica: las medidas cargadas y, debajo, lo que quien notifica
  // escribió al emitir el acta. El texto va acá y no en un bloque aparte de
  // "Observaciones" porque es justamente lo que se le está notificando.
  parrafo('SE NOTIFICA', 9, 'bold', GRIS);
  const nota = d.nota?.trim();
  for (const med of d.medidas) {
    parrafo(
      `- ${med.tipo_medida ? med.tipo_medida + ': ' : ''}${med.descripcion}` +
        (med.fecha_aplicacion ? ` (aplicada el ${formatearFecha(med.fecha_aplicacion)})` : ''),
    );
  }
  if (nota) parrafo(nota);
  if (!d.medidas.length && !nota) {
    // Sin medidas ni texto el acta se emite igual y se llena a mano: un acta
    // que no se puede imprimir deja al establecimiento sin constancia.
    parrafo('_______________________________________________________________________');
    parrafo('_______________________________________________________________________');
    parrafo('_______________________________________________________________________');
  }
  y += 4;

  parrafo('PLAZO PARA PEDIR RECONSIDERACION', 9, 'bold', GRIS);
  parrafo(d.plazo);
  y += 4;
  linea();

  // Firmas. Bajo la de quien notifica van nombre y cargo, no sólo el correo:
  // quien lea el acta después necesita saber en qué calidad notificó.
  const firmar = (rotulo, detalle, x, anchoFirma) => {
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
  const anchoFirma = (util - 24) / 2;
  // Las dos firmas y la leyenda del pie van juntas en la misma hoja.
  salto(130);
  firmar(
    alApoderado ? 'Firma del apoderado o adulto responsable' : 'Firma de quien recibe la notificacion',
    alApoderado ? `Apoderado de ${d.persona.nombre}` : d.persona.nombre,
    m,
    anchoFirma,
  );
  firmar(
    'Firma de quien notifica',
    [d.notificador.nombre ?? '', d.notificador.cargo ?? '', d.notificador.correo],
    m + anchoFirma + 24,
    anchoFirma,
  );
  y += 100;

  doc.setFontSize(8).setFont('helvetica', 'italic').setTextColor(...GRIS);
  const pie = doc.splitTextToSize(
    plano(
      'La negativa a firmar no invalida la notificacion: se deja constancia de ella en esta ' +
        'misma acta y en la bitacora del caso. Una copia queda en poder ' +
        (alApoderado ? 'del apoderado.' : 'de la persona notificada.'),
    ),
    util,
  );
  doc.text(pie, m, y);

  return { buffer: Buffer.from(doc.output('arraybuffer')), nombre: nombreArchivo(d) };
};

module.exports = { construirActaNotificacionPdf };
