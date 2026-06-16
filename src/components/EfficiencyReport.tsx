import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { Calendar, Activity } from 'lucide-react';
import { format, parseISO, getDaysInMonth, subHours, startOfWeek, isAfter, differenceInMinutes } from 'date-fns';
import { es } from 'date-fns/locale';
import { LINEAS, TAMANOS } from '../constants';
import { getLogicalDate, getHistoricalMonths } from '../utils';
import { useAppConfig } from '../hooks/useAppConfig';

type Frequency = 'daily' | 'weekly' | 'monthly';

export function EfficiencyReport() {
  const { availableLines, getFilteredSizes, shouldShowReport, config } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [hasInitializedDaily, setHasInitializedDaily] = useState(false);

  const filteredLines = availableLines;

  useEffect(() => {
    const [year, monthStr] = selectedMonth.split('-');
    
    const startDate = new Date(parseInt(year), parseInt(monthStr) - 2, 28);
    const startStr = format(startDate, 'yyyy-MM-dd');
    
    const endDate = new Date(parseInt(year), parseInt(monthStr), 5);
    const endStr = format(endDate, 'yyyy-MM-dd');

    const q = query(
      collection(db, 'production_reports'), 
      where('fecha', '>=', startStr),
      where('fecha', '<=', endStr),
      orderBy('fecha', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reportsData: ProductionReport[] = [];
      snapshot.forEach((doc) => {
        reportsData.push({ id: doc.id, ...doc.data() } as ProductionReport);
      });
      setReports(reportsData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching reports:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [selectedMonth]);

  const months = useMemo(() => {
    return getHistoricalMonths();
  }, []);

  const availableDates = useMemo(() => {
    const uniqueDates = new Set<string>();
    reports.forEach(r => {
      if (shouldShowReport(r)) {
        const logicalDate = getLogicalDate(r);
        if (logicalDate) {
          uniqueDates.add(logicalDate);
        }
      }
    });
    uniqueDates.add(format(new Date(), 'yyyy-MM-dd'));
    return Array.from(uniqueDates).sort().reverse();
  }, [reports, shouldShowReport]);

  // Reset hasInitializedDaily when not in daily frequency
  useEffect(() => {
    if (frequency !== 'daily') {
      setHasInitializedDaily(false);
    }
  }, [frequency]);

  // Set initial selectedDate to the most recent logical date with data when daily mode is active
  useEffect(() => {
    if (availableDates.length > 0 && frequency === 'daily' && !hasInitializedDaily) {
      // Find the latest date that actually has reports
      const latestWithData = reports.length > 0 ? getLogicalDate(reports.find(r => shouldShowReport(r)) || reports[0]) : format(new Date(), 'yyyy-MM-dd');
      if (latestWithData) {
        setSelectedDate(latestWithData);
        setHasInitializedDaily(true);
      }
    }
  }, [availableDates, frequency, reports, shouldShowReport, hasInitializedDaily]);

  const filteredReports = useMemo(() => {
    const now = new Date();
    if (frequency === 'daily') {
      return reports.filter(r => shouldShowReport(r) && getLogicalDate(r) === selectedDate);
    }
    if (frequency === 'weekly') {
      const monday = startOfWeek(now, { weekStartsOn: 1 });
      const mondayStr = format(monday, 'yyyy-MM-dd');
      return reports.filter(r => shouldShowReport(r) && getLogicalDate(r) >= mondayStr);
    }
    if (!selectedMonth) return reports.filter(r => shouldShowReport(r));
    return reports.filter(r => {
      if (!shouldShowReport(r)) return false;
      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [reports, selectedMonth, selectedDate, frequency, shouldShowReport]);

  const totalPossibleMinutes = useMemo(() => {
    const now = new Date();
    if (frequency === 'daily') return 24 * 60;
    if (frequency === 'weekly') {
      const monday = startOfWeek(now, { weekStartsOn: 1 });
      // If we are in the current week, calculate minutes elapsed
      // Otherwise, it should be 7 days (but we only support current week for now)
      return Math.max(0, differenceInMinutes(now, monday));
    }
    // Monthly
    if (!selectedMonth) return 30 * 24 * 60;
    const date = parseISO(`${selectedMonth}-01`);
    const days = getDaysInMonth(date);
    return days * 24 * 60;
  }, [selectedMonth, frequency]);

  // Structure: { [linea]: { [tamano]: Data, total: Data } }
  const efficiencyData = useMemo(() => {
    const data: Record<string, Record<number | 'total', any>> = {};
    const plantaTotal = {
      produccion: 0,
      marchaBruta: 0,
      marchaNeta: 0,
      paradaMecanica: 0,
      cambioFormato: 0,
      paradasOperativas: 0,
      paradasExcluidasTotales: 0,
    };

    const filteredSizes = getFilteredSizes();

    filteredLines.forEach(linea => {
      data[linea] = {
        total: {
          produccion: 0,
          marchaBruta: 0,
          marchaNeta: 0,
          paradaMecanica: 0,
          cambioFormato: 0,
          paradasOperativas: 0,
          paradasExcluidasTotales: 0,
        }
      };
      
      // Get all sizes that have data or are enabled for this line
      const sizesWithData = new Set<number>(getFilteredSizes(linea));
      filteredReports.forEach(r => {
        if (r.linea === linea && r.tamano) {
          sizesWithData.add(r.tamano);
        }
      });

      Array.from(sizesWithData).forEach(tamano => {
        data[linea][tamano] = {
          produccion: 0,
          marchaBruta: 0,
          marchaNeta: 0,
          paradaMecanica: 0,
          cambioFormato: 0,
          paradasOperativas: 0,
          paradasExcluidasTotales: 0,
        };
      });
    });

    filteredReports.forEach(report => {
      const linea = report.linea;
      const tamano = report.tamano;
      
      if (linea && tamano && data[linea] && data[linea][tamano]) {
        const produccion = report.paquetes || 0;
        let marchaBruta = report.tiempoTurno || 0;
        const marchaNeta = (report.botellas && report.velocidad) ? (report.botellas / report.velocidad) : 0;
        
        let paradaMecanica = 0;
        let cambioFormato = 0;
        let paradasOperativas = 0;
        let paradasExcluidasTotales = 0;

        report.downtimes?.forEach(dt => {
          // Check if this downtime should be excluded
          const isExcluded = config?.efficiencyExcludedDowntimes?.some(excluded =>
            (dt.category?.toLowerCase() || '') === excluded.toLowerCase() ||
            (dt.reason?.toLowerCase() || '') === excluded.toLowerCase()
          );
          
          if (isExcluded) {
            paradasExcluidasTotales += (dt.totalMinutes || 0);
            return;
          }

          const mins = dt.totalMinutes || 0;
          if (dt.category === 'PARADAS DE LINEA' || dt.category === 'Paradas de Línea' || dt.category === 'Mecánica' || (dt.category === 'PARADAS LINEA')) {
            paradaMecanica += mins;
          }
          if (dt.reason === 'CAMBIO DE SABOR/ FORMATO' || dt.reason === 'CAMBIO DE SABOR' || dt.reason === 'CAMBIO DE FORMATO') {
            cambioFormato += mins;
          }
          if (dt.category === 'PARADAS OPERATIVAS' || dt.category === 'Operativas' || dt.category === 'TIEMPO NO ASIGNADO' || dt.category === 'Operativa') {
            paradasOperativas += mins;
          }
        });

        // Add to specific size
        data[linea][tamano].produccion += produccion;
        data[linea][tamano].marchaBruta += marchaBruta;
        data[linea][tamano].marchaNeta += marchaNeta;
        data[linea][tamano].paradaMecanica += paradaMecanica;
        data[linea][tamano].cambioFormato += cambioFormato;
        data[linea][tamano].paradasOperativas += paradasOperativas;
        data[linea][tamano].paradasExcluidasTotales += paradasExcluidasTotales;

        // Add to line total
        data[linea].total.produccion += produccion;
        data[linea].total.marchaBruta += marchaBruta;
        data[linea].total.marchaNeta += marchaNeta;
        data[linea].total.paradaMecanica += paradaMecanica;
        data[linea].total.cambioFormato += cambioFormato;
        data[linea].total.paradasOperativas += paradasOperativas;
        data[linea].total.paradasExcluidasTotales += paradasExcluidasTotales;

        // Add to planta total
        plantaTotal.produccion += produccion;
        plantaTotal.marchaBruta += marchaBruta;
        plantaTotal.marchaNeta += marchaNeta;
        plantaTotal.paradaMecanica += paradaMecanica;
        plantaTotal.cambioFormato += cambioFormato;
        plantaTotal.paradasOperativas += paradasOperativas;
        plantaTotal.paradasExcluidasTotales += paradasExcluidasTotales;
      }
    });

    return { data, plantaTotal };
  }, [filteredReports, filteredLines, getFilteredSizes]);

  const calculateMetrics = (d: any, isPlanta = false) => {
    const paradasAjenas = d.paradasExcluidasTotales || 0;
    const marchaBrutaCalculo = typeof d.marchaBruta === 'number' ? d.marchaBruta - paradasAjenas : 0;
    
    // Operativa = Marcha Neta / (Bruta - Ajenas) * 100
    const efOperativa = marchaBrutaCalculo > 0 ? (d.marchaNeta / marchaBrutaCalculo) * 100 : 0;
    
    // Mecánica = ((Marcha Bruta - Parada Mecánica - Ajenas) / (Marcha Bruta - Ajenas)) * 100
    const efMecanica = marchaBrutaCalculo > 0 ? ((d.marchaBruta - d.paradaMecanica - paradasAjenas) / marchaBrutaCalculo) * 100 : 0;
    
    // Linea = Marcha Neta / (Marcha Bruta - Ajenas + Cambio de Formato) * 100
    const efLinea = (marchaBrutaCalculo + d.cambioFormato) > 0 ? (d.marchaNeta / (marchaBrutaCalculo + d.cambioFormato)) * 100 : 0;
    
    const divisor = isPlanta ? (totalPossibleMinutes * filteredLines.length) : totalPossibleMinutes;
    const utilizacion = divisor > 0 ? (d.marchaBruta / divisor) * 100 : 0;
    const real = d.marchaBruta > 0 ? (d.produccion / d.marchaBruta) * 480 : 0;

    return {
      efOperativa,
      efMecanica,
      efLinea,
      utilizacion,
      real
    };
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Define which sizes to show per line based on the user's image
  const renderRow = (label: string, d: any, isTotal = false, isPlanta = false, lineColorClass = '') => {
    const metrics = calculateMetrics(d, isPlanta);
    const hasData = d.marchaBruta > 0 || d.produccion > 0;
    
    let bgClass = 'hover:bg-gray-50';
    if (isPlanta) bgClass = 'bg-gray-100 font-bold border-t-2 border-gray-400';
    else if (isTotal) bgClass = 'bg-gray-50 font-semibold border-t border-gray-300';

    return (
      <tr key={label} className={bgClass}>
        <td className={`px-4 py-2 text-sm border-r border-gray-200 ${isTotal && !isPlanta ? lineColorClass : ''} ${isPlanta ? 'text-blue-800' : 'text-gray-900'}`}>
          {label}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? d.produccion.toLocaleString('es-AR') : '0'}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? Math.round(d.marchaBruta).toLocaleString('es-AR') : '0'}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? Math.round(d.marchaNeta).toLocaleString('es-AR') : '0'}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? Math.round(d.paradaMecanica).toLocaleString('es-AR') : '0'}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? Math.round(d.cambioFormato).toLocaleString('es-AR') : '0'}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? Math.round(d.paradasOperativas).toLocaleString('es-AR') : '0'}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r-4 border-gray-300 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? Math.round(d.paradasExcluidasTotales || 0).toLocaleString('es-AR') : '0'}
        </td>
        
        {/* Eficiencias */}
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? `${Math.round(metrics.efOperativa)}%` : '-'}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? `${Math.round(metrics.efMecanica)}%` : '-'}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? `${Math.round(metrics.efLinea)}%` : '-'}
        </td>
        <td className={`px-4 py-2 text-center text-sm border-r-4 border-gray-300 ${hasData ? (isPlanta ? 'text-blue-600' : (isTotal ? lineColorClass : 'text-gray-900')) : 'text-gray-300'}`}>
          {hasData ? `${Math.round(metrics.utilizacion)}%` : '-'}
        </td>

        {/* Real */}
        <td className={`px-4 py-2 text-center text-sm border-r border-gray-200 ${hasData ? (isPlanta ? 'text-gray-900' : (isTotal ? 'text-gray-900' : 'text-red-600 font-medium')) : 'text-gray-300'}`}>
          {hasData ? Math.round(metrics.real).toLocaleString('es-AR') : '-'}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header & Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-gray-700 font-medium">
          <Activity className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg">
            Eficiencias - {frequency === 'daily' ? 'Últimas 24 Horas' : frequency === 'weekly' ? 'Acumulado Semanal' : 'Acumulado Mensual'}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 uppercase font-bold">Frecuencia:</span>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
              className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border p-2 bg-gray-50"
            >
              <option value="daily">Diario (3 Turnos)</option>
              <option value="weekly">Semanal (Lunes)</option>
              <option value="monthly">Mensual</option>
            </select>
          </div>

          {frequency === 'daily' && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border p-2 min-w-[160px]"
              >
                {availableDates.map(d => (
                  <option key={d} value={d}>
                    {format(parseISO(d), "dd 'de' MMMM yyyy", { locale: es })}
                  </option>
                ))}
              </select>
            </div>
          )}

          {frequency === 'monthly' && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border p-2 min-w-[160px]"
              >
                {months.map(m => (
                  <option key={m} value={m}>
                    {format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  Línea - Calibre
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  PRODUCCIÓN<br/>[ Paquetes ]
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  Min.<br/>Marcha<br/>Bruta
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  Min.<br/>Marcha<br/>Neta
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  Min.<br/>Parada<br/>Mecánica
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  Min.<br/>Cambio de<br/>Formato/Sabor
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  Min.<br/>Paradas<br/>Operativas
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r-4 border-gray-300 align-bottom">
                  Min.<br/>Paradas<br/>Ajenas
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  Eficiencia<br/>OPERATIVA
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  Eficiencia<br/>MECANICA
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  Eficiencia<br/>LINEA
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r-4 border-gray-300 align-bottom">
                  UTILIZACION<br/>LINEA
                </th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200 align-bottom">
                  PAQUETES PROMEDIO<br/>POR TURNO<br/><br/>Real
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredLines.map(linea => (
                <React.Fragment key={linea}>
                  {/* Sizes for this line */}
                  {Object.keys(efficiencyData.data[linea] || {})
                    .filter(k => k !== 'total')
                    .map(Number)
                    .sort((a, b) => a - b)
                    .map(size => renderRow(`L${linea} - ${size.toLocaleString('es-AR')}`, efficiencyData.data[linea][size]))
                  }
                  <tr className="h-2 bg-gray-200"><td colSpan={13}></td></tr>
                </React.Fragment>
              ))}

              {/* Totals per Line */}
              {filteredLines.map(linea => renderRow(`L${linea}`, efficiencyData.data[linea]?.total, true, false, 'text-purple-700'))}
              
              {/* Planta Total */}
              {renderRow('PLANTA', efficiencyData.plantaTotal, true, true)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
