import { format, parseISO } from 'date-fns';
import { ProductionReport } from '../types';
import { getLogicalDate } from '../utils';

export const printProductionReport = (report: ProductionReport) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const logicalDate = getLogicalDate(report);
  const formattedDate = logicalDate ? format(parseISO(logicalDate), 'dd/MM/yyyy') : '-';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Parte de Producción - Expedición - ${report.planilla}</title>
      <style>
        @media print {
          @page { margin: 1cm; }
        }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          color: #333;
          line-height: 1.4;
          margin: 0;
          padding: 20px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid #2563eb;
          padding-bottom: 10px;
          margin-bottom: 20px;
        }
        .header h1 {
          margin: 0;
          color: #2563eb;
          font-size: 24px;
        }
        .header .info {
          text-align: right;
        }
        .section {
          margin-bottom: 25px;
        }
        .section-title {
          font-size: 16px;
          font-weight: bold;
          background: #f3f4f6;
          padding: 8px 12px;
          border-radius: 6px;
          margin-bottom: 15px;
          border-left: 4px solid #2563eb;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 15px;
        }
        .data-item {
          border-bottom: 1px solid #e5e7eb;
          padding: 5px 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .data-item.full-width {
          grid-column: span 2;
        }
        .highlight {
          background: #fef3c7;
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid #f59e0b;
          font-size: 1.1em;
        }
        .label {
          color: #6b7280;
          font-weight: 500;
        }
        .value {
          font-weight: bold;
        }
        .footer {
          margin-top: 40px;
          display: flex;
          justify-content: space-between;
        }
        .signature-box {
          width: 250px;
          border-top: 1px solid #000;
          text-align: center;
          padding-top: 10px;
          font-size: 14px;
        }
        .manual-notes {
          margin-top: 20px;
          border: 1px dashed #9ca3af;
          border-radius: 6px;
          padding: 15px;
          min-height: 60px;
        }
        .badge {
          display: inline-block;
          padding: 4px 8px;
          background: #dbeafe;
          color: #1e40af;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1>Parte de Producción</h1>
          <div class="badge">PARA EXPEDICIÓN</div>
        </div>
        <div class="info">
          <div><strong>Planilla:</strong> ${report.planilla}</div>
          <div><strong>Fecha:</strong> ${formattedDate}</div>
          <div><strong>Turno:</strong> ${report.turno}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Información General</div>
        <div class="grid">
          <div class="data-item"><span class="label">Línea:</span> <span class="value">${report.linea}</span></div>
          <div class="data-item"><span class="label">Supervisor:</span> <span class="value">${report.supervisor}</span></div>
          <div class="data-item"><span class="label">Marca:</span> <span class="value">${report.marca}</span></div>
          <div class="data-item"><span class="label">Sabor:</span> <span class="value">${report.sabor}</span></div>
          <div class="data-item"><span class="label">Tamaño:</span> <span class="value">${report.tamano} ml</span></div>
          <div class="data-item"><span class="label">Lote:</span> <span class="value">${report.lote || '-'}</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Resultados de Producción</div>
        <div class="grid">
          <div class="data-item full-width">
            <span class="label">TOTAL PAQUETES (PACKS):</span> 
            <span class="value highlight">${(report.paquetes || 0).toLocaleString()}</span>
          </div>
          <div class="data-item"><span class="label">Total Paletas:</span> <span class="value">${(report.paletasDeEsteParte || 0).toLocaleString()}</span></div>
          <div class="data-item"><span class="label">Botellas Producidas:</span> <span class="value">${(report.botellas || 0).toLocaleString()}</span></div>
          <div class="data-item"><span class="label">Tickets Impresos:</span> <span class="value">${(report.tickets || 0).toLocaleString()}</span></div>
          <div class="data-item"><span class="label">Parcial Actual:</span> <span class="value">${(report.parcialActual || 0).toLocaleString()}</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Lectura de Contadores</div>
        <div class="grid">
          <div class="data-item"><span class="label">Contador Inicial:</span> <span class="value">${(report.contInicial || 0).toLocaleString()}</span></div>
          <div class="data-item"><span class="label">Contador Final:</span> <span class="value">${(report.contFinal || 0).toLocaleString()}</span></div>
          <div class="data-item"><span class="label">Botellas Rotas:</span> <span class="value">${(report.botRotas || 0).toLocaleString()}</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Observaciones</div>
        ${report.observaciones ? `
          <div style="padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-style: italic; margin-bottom: 10px;">
            ${report.observaciones}
          </div>
        ` : ''}
        <div class="label" style="font-size: 12px; margin-bottom: 5px;">Anotaciones adicionales del Jefe de Turno:</div>
        <div class="manual-notes"></div>
      </div>

      <div class="footer">
        <div class="signature-box">
          Firma Jefe de Turno
        </div>
        <div class="signature-box">
          Recibido Expedición
        </div>
      </div>

      <script>
        window.onload = () => {
          window.print();
        };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};

export const printInternalReport = (report: ProductionReport) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const logicalDate = getLogicalDate(report);
  const formattedDate = logicalDate ? format(parseISO(logicalDate), 'dd/MM/yyyy') : '-';

  // Helper to get previous marcador for hourly production calculation
  const getPrevMarcador = (hourlyData: any[], hIndex: number, contInicial: number) => {
    for (let i = hIndex - 1; i >= 0; i--) {
      if (hourlyData[i]?.marcador > 0) {
        return hourlyData[i].marcador;
      }
    }
    return contInicial || 0;
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Parte de Producción Interno - ${report.planilla}</title>
      <style>
        @media print {
          @page { margin: 0.5cm; }
          .no-print { display: none; }
        }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          color: #333;
          line-height: 1.1;
          margin: 0;
          padding: 5px;
          font-size: 11px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #000;
          padding-bottom: 3px;
          margin-bottom: 8px;
        }
        .header h1 {
          margin: 0;
          font-size: 18px;
          text-transform: uppercase;
        }
        .header .info {
          text-align: right;
          font-size: 10px;
        }
        .section {
          margin-bottom: 10px;
        }
        .section-title {
          font-size: 11px;
          font-weight: bold;
          background: #eee;
          padding: 2px 6px;
          border: 1px solid #ccc;
          margin-bottom: 5px;
          text-transform: uppercase;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 5px 15px;
        }
        .data-item {
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid #eee;
          padding: 1px 0;
        }
        .label {
          color: #666;
          font-weight: 500;
        }
        .value {
          font-weight: bold;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 5px;
        }
        th, td {
          border: 1px solid #ccc;
          padding: 3px 5px;
          text-align: left;
        }
        th {
          background: #f5f5f5;
          font-size: 10px;
        }
        .text-right { text-align: right; }
        .badge {
          display: inline-block;
          padding: 1px 5px;
          background: #000;
          color: #fff;
          font-size: 9px;
          font-weight: bold;
          margin-top: 2px;
        }
        .signature-section {
          margin-top: 20px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 30px;
        }
        .sig-box {
          border-top: 1px solid #000;
          text-align: center;
          padding-top: 3px;
          font-size: 10px;
        }
        .downtime-timeline {
          font-size: 9px;
          color: #555;
          margin-top: 2px;
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .time-pill {
          background: #f0f0f0;
          padding: 0 4px;
          border-radius: 3px;
          border: 1px solid #ddd;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1>Parte Diario de Producción</h1>
          <div class="badge">COPIA INTERNA PRODUCCIÓN</div>
        </div>
        <div class="info">
          <div><strong>PLANILLA:</strong> ${report.planilla}</div>
          <div><strong>FECHA:</strong> ${formattedDate}</div>
          <div><strong>TURNO:</strong> ${report.turno}</div>
          <div><strong>SUPERVISOR:</strong> ${report.supervisor}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Datos del Producto</div>
        <div class="grid">
          <div class="data-item"><span class="label">Línea:</span> <span class="value">${report.linea}</span></div>
          <div class="data-item"><span class="label">Marca:</span> <span class="value">${report.marca}</span></div>
          <div class="data-item"><span class="label">Sabor:</span> <span class="value">${report.sabor}</span></div>
          <div class="data-item"><span class="label">Tamaño:</span> <span class="value">${report.tamano} ml</span></div>
          <div class="data-item"><span class="label">Lote:</span> <span class="value">${report.lote || '-'}</span></div>
          <div class="data-item"><span class="label">Velocidad:</span> <span class="value">${report.velocidad || 0} b/m</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Producción Horaria</div>
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th class="text-right">Marcador</th>
              <th class="text-right">Producción (u.)</th>
              <th class="text-right">Minutos Prod.</th>
              <th class="text-right">Eficiencia (%)</th>
            </tr>
          </thead>
          <tbody>
            ${(report.hourlyProduction || []).map((hour, idx) => {
              const prevMarcador = getPrevMarcador(report.hourlyProduction || [], idx, report.contInicial || 0);
              const produccion = hour.marcador > 0 ? Math.max(0, hour.marcador - prevMarcador) : 0;
              const minProd = hour.minProd || (report.velocidad ? Math.round((produccion / report.velocidad)) : 0);
              const efic = report.velocidad ? Math.round((produccion / (60 * report.velocidad)) * 100) : 0;
              
              return `
                <tr>
                  <td>${hour.hora} hs</td>
                  <td class="text-right">${hour.marcador > 0 ? hour.marcador.toLocaleString() : '-'}</td>
                  <td class="text-right">${produccion > 0 ? produccion.toLocaleString() : '-'}</td>
                  <td class="text-right">${hour.marcador > 0 ? minProd : '-'} min</td>
                  <td class="text-right">${hour.marcador > 0 ? efic : '-'}%</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="section" style="page-break-inside: avoid;">
        <div class="section-title">Novedades y Paradas</div>
        <table>
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Motivo / Razón y Detalle Horario</th>
              <th class="text-right">Total (min)</th>
            </tr>
          </thead>
          <tbody>
            ${(report.downtimes || []).filter(d => (d.totalMinutes || 0) > 0).map(dt => `
              <tr>
                <td style="width: 120px;"><strong>${dt.category}</strong></td>
                <td>
                  <div style="font-weight: 600;">${dt.reason}</div>
                  <div class="downtime-timeline">
                    ${dt.minutes?.map((m, i) => Number(m) > 0 ? `<span class="time-pill">${report.hourlyProduction?.[i]?.hora || '?'}: <b>${m}m</b></span>` : '').filter(Boolean).join('')}
                  </div>
                </td>
                <td class="text-right" style="width: 70px;"><strong>${Math.round(dt.totalMinutes || 0)} min</strong></td>
              </tr>
            `).join('')}
            ${(!report.downtimes || report.downtimes.every(d => (d.totalMinutes || 0) === 0)) ? '<tr><td colspan="3" style="text-align: center; font-style: italic;">Sin paradas registradas</td></tr>' : ''}
          </tbody>
        </table>
      </div>

      <div class="section" style="page-break-inside: avoid;">
        <div class="section-title">Insumos y Desperdicio</div>
        <div class="grid">
          <div class="data-item"><span class="label">Scrap Soplado:</span> <span class="value">${report.scrapSoplado || 0} u.</span></div>
          <div class="data-item"><span class="label">Scrap Etiquetado:</span> <span class="value">${report.scrapEtiquetado || 0} u.</span></div>
          <div class="data-item"><span class="label">Scrap Llenado:</span> <span class="value">${report.scrapLlenado || 0} u.</span></div>
          <div class="data-item"><span class="label">Scrap Horno:</span> <span class="value">${report.scrapHorno || 0} u.</span></div>
          <div class="data-item"><span class="label">Desp. Etiquetas:</span> <span class="value">${report.desperdicioEtiquetas || 0} kg</span></div>
          <div class="data-item"><span class="label">Desp. Tapas:</span> <span class="value">${report.desperdicioTapas || 0} kg</span></div>
          <div class="data-item"><span class="label">Desp. Film:</span> <span class="value">${report.desperdicioTermo || 0} kg</span></div>
          <div class="data-item"><span class="label">Desp. Sifones:</span> <span class="value">${report.desperdicioSifones || 0} u.</span></div>
        </div>
      </div>

      <div class="section" style="page-break-inside: avoid;">
        <div class="section-title">Resultados Finales</div>
        <div class="grid">
          <div class="data-item"><span class="label">Contador Inicial:</span> <span class="value">${(report.contInicial || 0).toLocaleString()}</span></div>
          <div class="data-item"><span class="label">Contador Final:</span> <span class="value">${(report.contFinal || 0).toLocaleString()}</span></div>
          <div class="data-item"><span class="label">Botellas Totales:</span> <span class="value">${(report.botellas || 0).toLocaleString()} u.</span></div>
          <div class="data-item"><span class="label">Botellas Rotas:</span> <span class="value">${(report.botRotas || 0).toLocaleString()} u.</span></div>
          <div class="data-item"><span class="label">Paquetes Totales:</span> <span class="value">${(report.paquetes || 0).toLocaleString()}</span></div>
          <div class="data-item"><span class="label">Eficiencia Bruta:</span> <span class="value">${report.eficBruta || 0}%</span></div>
          <div class="data-item"><span class="label">Consumo Jarabe:</span> <span class="value">${report.jarabeConsumido || 0} L</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Observaciones</div>
        <div style="min-height: 30px; border: 1px solid #ccc; padding: 5px;">
          ${report.observaciones || ''}
        </div>
      </div>

      <div class="signature-section">
        <div class="sig-box">Firma Supervisor / Jefe de Turno</div>
        <div class="sig-box">Firma Control de Producción</div>
      </div>

      <script>
        window.onload = () => {
          setTimeout(() => {
            window.print();
            window.close();
          }, 500);
        };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
};
