import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { ElaboracionReport } from '../types';
import { Download, FileSpreadsheet, Loader2, Route } from 'lucide-react';
import { useAppConfig } from '../hooks/useAppConfig';

export function HistoricalElaboracionExporter() {
  const { availableLines } = useAppConfig();
  const [isExporting, setIsExporting] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedLine, setSelectedLine] = useState('');

  const handleExport = async () => {
    setIsExporting(true);
    try {
      let q = query(
        collection(db, 'elaboracion_reports'),
        orderBy('fecha', 'asc')
      );

      // We can't build composite queries arbitrarily without indexes, but we can filter client-side
      const snapshot = await getDocs(q);
      let reports = snapshot.docs.map(doc => doc.data() as ElaboracionReport);

      if (dateFrom) {
        reports = reports.filter(r => r.fecha >= dateFrom);
      }
      if (dateTo) {
        reports = reports.filter(r => r.fecha <= dateTo);
      }
      if (selectedLine) {
        reports = reports.filter(r => r.linea === selectedLine);
      }

      if (reports.length === 0) {
        alert("No se encontraron registros para los filtros seleccionados.");
        setIsExporting(false);
        return;
      }

      const rows = reports.map(r => ({
        Fecha: r.fecha,
        Turno: r.turno,
        Línea: r.linea,
        Químico: r.quimico,
        'Marca-Sabor': `${r.marca} ${r.sabor}`,
        Marca: r.marca,
        Sabor: r.sabor,
        Calibre: r.tamano,
        Lote: r.lote,
        Planilla: r.planilla,
        Inicio: r.horaInicio,
        Final: r.horaFin,
        'Cont Inicial': r.contInicial,
        'Cont Final': r.contFinal,
        'Jarabe Inicial': r.jarabeInicial,
        'Jarabe Final': r.jarabeFinal,
        'Co2b21': r.co2Inicial,
        'Co2b22': r.co2Final,
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Elaboracion");

      XLSX.writeFile(wb, `Exportacion_Elaboracion_${dateFrom || 'All'}_${dateTo || 'All'}.xlsx`);
    } catch (error) {
      console.error("Error exporting:", error);
      alert("Hubo un error al exportar los datos.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto pb-20">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-emerald-100 rounded-xl">
            <Route className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Exportar Elaboración</h2>
            <p className="text-sm text-gray-500 font-medium italic">Descarga un Excel con los Partes de Elaboración</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Desde (Opcional)</label>
            <input 
              type="date" 
              value={dateFrom} 
              onChange={e => setDateFrom(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm border p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Hasta (Opcional)</label>
            <input 
              type="date" 
              value={dateTo} 
              onChange={e => setDateTo(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm border p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Línea (Opcional)</label>
            <select 
              value={selectedLine} 
              onChange={e => setSelectedLine(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm border p-2"
            >
              <option value="">Todas las líneas</option>
              {availableLines.map(l => (
                <option key={l} value={l}>Línea {l}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleExport}
            disabled={isExporting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition"
          >
            {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            Exportar a Excel
          </button>
        </div>
      </div>
    </div>
  );
}
