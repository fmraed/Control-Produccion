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
