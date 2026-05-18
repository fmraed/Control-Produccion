import React, { useState } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { Download, FileSpreadsheet, Calendar, Search, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';

export function HistoricalExporter() {
  const [startDate, setStartDate] = useState(format(startOfDay(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfDay(new Date()), 'yyyy-MM-dd'));
  const [isExporting, setIsExporting] = useState(false);
  const [reportsCount, setReportsCount] = useState<number | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // Query reports in the date range, ordered by date descending
      const q = query(
        collection(db, 'production_reports'),
        where('fecha', '>=', startDate),
        where('fecha', '<=', endDate),
        orderBy('fecha', 'desc')
      );

      const querySnapshot = await getDocs(q);
      const reports: ProductionReport[] = [];
      querySnapshot.forEach((doc) => {
        reports.push({ id: doc.id, ...doc.data() } as ProductionReport);
      });

      if (reports.length === 0) {
        alert('No se encontraron reportes en el rango seleccionado.');
        setIsExporting(false);
        return;
      }

      // Column mapping to match the historical Excel format strictly
      const excelData = reports.map(r => {
        // Get official system reasons from constants or manually list them here to ensure order
        const SYSTEM_REASONS = [
          'SOPLADORA', 'TRANSPORTES NEUMATICOS', 'CARBONATADOR', 'RINSER', 'LLENADORA',
          'CAPSULADORA', 'CODIFICADOR', 'TRANSPORTES DE BOTELLAS', 'ETIQUETADORA',
          'EMPACADORA', 'TRANSPORTE DE PALLETS', 'PALLETIZADORA/ CARGA MANUAL',
          'CALIDAD', 'FALTA DE PERSONAL', 'REFRIGERIO/ INICIO Y FIN DE TURNO',
          'FALTA DE MONTACARGAS', 'SIN PROGRAMA', 'MANTENIMIENTO PROGRAMADO',
          'CAMBIO DE SABOR/ FORMATO', 'FALTA DE ENERGIA', 'COMPRESORES', 'FRIO',
          'AGUA', 'FALTA DE JARABE', 'LUBRICACION', 'GAS CARBONICO / NITROGENO',
          'FALTA DE MAT. PRIMAS/INSUMOS', 'OTRAS AJENAS A LINEA', 'SIN REGISTRAR'
        ];

        const stopData: { [key: string]: number } = {};
        SYSTEM_REASONS.forEach(reason => {
          stopData[reason] = 0;
        });

        r.downtimes?.forEach(d => {
          const reason = d.reason?.toUpperCase() || 'SIN REGISTRAR';
          // Find closest match or aggregate in "OTRAS AJENAS A LINEA" if not found
          if (SYSTEM_REASONS.includes(reason)) {
            stopData[reason] += d.totalMinutes;
          } else {
            // Flexible matching for minor differences
            const match = SYSTEM_REASONS.find(sr => reason.includes(sr) || sr.includes(reason));
            if (match) stopData[match] += d.totalMinutes;
            else stopData['OTRAS AJENAS A LINEA'] += d.totalMinutes;
          }
        });

        const botsPerPack = r.tamano === 500 ? 12 : 6;
        const totalProducedPacks = r.paquetes || 0;
        const totalProducedBottles = r.botellas || 0;
        const leftoverBottles = totalProducedBottles - (totalProducedPacks * botsPerPack);

        // Production per hour (numbered: 1ª hora, 2ª hora, etc.) - Using bottles instead of minutes
        const hourlyProductionData: { [key: string]: number } = {};
        const shiftHours = r.hourlyProduction || [];
        for (let i = 0; i < 12; i++) {
           const label = `${i + 1}ª hora`;
           // botMin stores the bottles produced in that hour in the system
           hourlyProductionData[label] = i < shiftHours.length ? (shiftHours[i].botMin || 0) : 0;
        }

        return {
          'Fecha': r.fecha,
          'Planilla': r.planilla,
          'Entra Turno': r.entraTurno || '',
          'Sale Turno': r.saleTurno || '',
          'Lote': r.lote || '',
          'Línea': r.linea,
          'Marca': r.marca,
          'Sabor': r.sabor || '',
          'Tamaño': r.tamano || 0,
          'Contador Inicial': r.contInicial || 0,
          'Contador Final': r.contFinal || 0,
          'Botellas': totalProducedBottles,
          'Botellas Rotas': r.botRotas || 0,
          'Paquetes': totalProducedPacks,
          'Botellas sobrantes': leftoverBottles > 0 ? leftoverBottles : 0,
          'Botellas por Pack': botsPerPack,
          'Supervisor': r.supervisor,
          'Paletas de este Parte': r.paletasDeEsteParte || 0,
          'Tickets (Total Paletas)': r.tickets || 0,
          'Parcial Anterior': r.parcialAnterior || 0,
          'Ajuste Parcial': r.ajusteParcial || 0,
          'Paquetes Sobrantes (Parcial Actual)': r.parcialActual || 0,
          'Separadores': r.totalSeparadores || 0,
          'Velocidad Nominal': r.velocidad || 0,
          'Tiempo Turno': r.tiempoTurno || 0,
          'Eficiencia': r.eficBruta || 0,
          'Turno': r.turno,
          'CO2': r.co2 || 0,
          'Observaciones': r.observaciones || '',
          ...stopData,
          ...hourlyProductionData,
          // Wastes at the end
          'Scrap Soplado': r.scrapSoplado || 0,
          'Scrap Etiquetado': r.scrapEtiquetado || 0,
          'Scrap Llenado': r.scrapLlenado || 0,
          'Scrap Horno': r.scrapHorno || 0,
          'Desperdicio Etiquetas': r.desperdicioEtiquetas || 0,
          'Desperdicio Tapas': r.desperdicioTapas || 0,
          'Desperdicio Sifones': r.desperdicioSifones || 0,
          'Desperdicio Termo': r.desperdicioTermo || 0
        };
      });

      // Create Worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      
      // Auto-size columns (rough approach)
      const max_width = excelData.reduce((w, r) => Math.max(w, Object.keys(r).length), 0);
      ws['!cols'] = Array(max_width).fill({ wch: 15 });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Producción");

      // Generate file and download
      const fileName = `Export_Histórico_${startDate}_a_${endDate}.xlsx`;
      XLSX.writeFile(wb, fileName);
      
      setReportsCount(reports.length);
    } catch (error) {
      console.error("Error exporting reports:", error);
      alert('Hubo un error al exportar los datos. Revisa la consola.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-20">
      {/* Introduction Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-emerald-100 rounded-xl">
            <Download className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Exportador de Datos a Excel</h2>
            <p className="text-sm text-gray-500 font-medium italic">Descarga los reportes del sistema en el formato compatible con el archivo histórico</p>
          </div>
        </div>
      </div>

      {/* Configuration Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Calendar className="w-3 h-3" />
              Fecha Desde
            </label>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-emerald-500 transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Calendar className="w-3 h-3" />
              Fecha Hasta
            </label>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-emerald-500 transition-all"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 flex flex-col items-center gap-4">
          <button 
            onClick={handleExport}
            disabled={isExporting}
            className="w-full sm:w-auto px-10 py-4 bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-6 h-6" />
            )}
            {isExporting ? 'Procesando...' : 'Generar Archivo Excel'}
          </button>

          {reportsCount !== null && (
            <div className="flex items-center gap-2 text-emerald-600 animate-in fade-in zoom-in duration-300">
               <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
               <span className="text-xs font-bold uppercase tracking-tight">¡Se exportaron {reportsCount} reportes con éxito!</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 flex items-start gap-4">
        <div className="p-2 bg-white rounded-lg">
          <Search className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="text-left">
          <h4 className="text-xs font-black text-emerald-800 uppercase tracking-wider mb-1">Nota sobre paradas (Downtime)</h4>
          <p className="text-[10px] text-emerald-600/80 leading-relaxed font-medium">
            El exportador agrupa automáticamente los eventos de parada en columnas fijas (Mecánica, Eléctrica, Falta de Materiales, etc.) basándose en las categorías y motivos registrados en cada parte de producción. Esto mantiene la compatibilidad con el sistema de análisis histórico.
          </p>
        </div>
      </div>
    </div>
  );
}
