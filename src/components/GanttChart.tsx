import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, parseISO, addDays, differenceInMinutes, isAfter, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';
import { LINEAS } from '../constants';
import { useAppConfig } from '../hooks/useAppConfig';

interface GanttChartProps {
  onBack: () => void;
}

const FLAVOR_COLORS: Record<string, string> = {
  'Manzana': 'bg-amber-600 text-white', // Marrón claro
  'Naranja': 'bg-orange-500 text-white',
  'Cola': 'bg-red-600 text-white', // Rojo
  'Lima Limon': 'bg-green-500 text-white',
  'Pomelo': 'bg-yellow-400 text-gray-900', // Amarillo
  'Agua Tónica': 'bg-black text-white', // Negro
  'Pomelo Blanco': 'bg-yellow-200 text-gray-900',
  'Citrus': 'bg-green-400 text-gray-900', // Verde Claro
  'Granadina': 'bg-purple-400 text-white', // Violeta Claro
  'Limonada': 'bg-green-800 text-white', // Verde Oscuro
  'Soda': 'bg-blue-800 text-white', // Azul Oscuro
  'Soda Sifon': 'bg-blue-800 text-white', // Azul Oscuro
  'Agua': 'bg-sky-400 text-gray-900', // Celeste
};

export function GanttChart({ onBack }: GanttChartProps) {
  const { availableLines } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [daysBack, setDaysBack] = useState(5);

  const filteredLines = availableLines;

  // Calculate the time range based on daysBack
  const { startDate, endDate, totalMinutes } = useMemo(() => {
    const end = endOfDay(new Date());
    const start = startOfDay(subDays(new Date(), daysBack - 1));
    const total = differenceInMinutes(end, start);
    return { startDate: start, endDate: end, totalMinutes: total };
  }, [daysBack]);

  useEffect(() => {
    // Fetch 1 extra day in the past to catch shifts that started before the window but end inside it
    const queryStartDateStr = format(subDays(startDate, 1), 'yyyy-MM-dd');
    
    // Query reports from the selected range + 1 extra day
    const q = query(
      collection(db, 'production_reports'),
      where('fecha', '>=', queryStartDateStr)
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
  }, [startDate]);

  const blocksByLine = useMemo(() => {
    const blocks: Record<string, any[]> = {};
    filteredLines.forEach(linea => blocks[linea] = []);

    reports.forEach(report => {
      if (!report.entraTurno || !report.saleTurno || !report.fecha) return;

      let start = parseISO(`${report.fecha}T${report.entraTurno}`);
      let end = parseISO(`${report.fecha}T${report.saleTurno}`);

      // Handle overnight shifts and the "next day date" rule
      // If a shift starts at or after 22:00, the 'fecha' is actually the next day.
      // So the physical start time was the day before 'fecha'.
      if (report.entraTurno >= '22:00') {
        start = subDays(start, 1);
        if (report.saleTurno >= '22:00') {
          // If it ends at e.g. 23:30, it's also on the previous day
          end = subDays(end, 1);
        }
      } else if (report.saleTurno < report.entraTurno) {
        // Normal overnight shift (e.g. 14:00 to 02:00, though rare)
        end = addDays(end, 1);
      }

      // Ensure block is within our 5-day window
      if (isAfter(start, endDate) || isBefore(end, startDate)) return;

      // Clamp to window
      const clampedStart = isBefore(start, startDate) ? startDate : start;
      const clampedEnd = isAfter(end, endDate) ? endDate : end;

      const leftPercent = (differenceInMinutes(clampedStart, startDate) / totalMinutes) * 100;
      const widthPercent = (differenceInMinutes(clampedEnd, clampedStart) / totalMinutes) * 100;

      if (blocks[report.linea]) {
        blocks[report.linea].push({
          id: report.id,
          sabor: report.sabor || 'Sin Sabor',
          tamano: report.tamano || '-',
          paquetes: report.paquetes || 0,
          left: leftPercent,
          width: widthPercent,
          start: clampedStart,
          end: clampedEnd,
          colorClass: FLAVOR_COLORS[report.sabor || ''] || 'bg-gray-400 text-white'
        });
      }
    });

    return blocks;
  }, [reports, startDate, endDate, totalMinutes]);

  // Generate day markers for the X-axis
  const dayMarkers = useMemo(() => {
    const markers = [];
    for (let i = 0; i < daysBack; i++) {
      const day = addDays(startDate, i);
      const leftPercent = (differenceInMinutes(day, startDate) / totalMinutes) * 100;
      markers.push({
        date: day,
        label: format(day, 'EEE dd/MM', { locale: es }),
        left: leftPercent
      });
    }
    return markers;
  }, [startDate, totalMinutes, daysBack]);

  const shiftMarkers = useMemo(() => {
    const markers = [];
    const shiftHours = [6, 14, 22];
    for (let i = 0; i < daysBack; i++) {
      const day = startOfDay(addDays(startDate, i));
      shiftHours.forEach(hour => {
        const markerTime = new Date(day);
        markerTime.setHours(hour, 0, 0, 0);
        
        if (isAfter(markerTime, startDate) && isBefore(markerTime, endDate)) {
          const leftPercent = (differenceInMinutes(markerTime, startDate) / totalMinutes) * 100;
          markers.push({
            hour,
            left: leftPercent
          });
        }
      });
    }
    return markers;
  }, [startDate, endDate, totalMinutes, daysBack]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
            title="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-gray-800 font-bold">
            <CalendarDays className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl">Gantt de Producción</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Ver últimos:</span>
          <select
            value={daysBack}
            onChange={(e) => setDaysBack(Number(e.target.value))}
            className="bg-transparent text-sm font-bold text-blue-600 focus:outline-none cursor-pointer"
          >
            <option value={3}>3 días</option>
            <option value={5}>5 días</option>
            <option value={7}>7 días</option>
            <option value={10}>10 días</option>
            <option value={15}>15 días</option>
            <option value={30}>30 días</option>
          </select>
        </div>
      </div>

      {/* Gantt Chart Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 overflow-x-auto">
        <div style={{ minWidth: `${Math.max(1000, daysBack * 200)}px` }}>
          
          {/* Timeline Header */}
          <div className="relative h-14 border-b border-gray-200 mb-4 ml-24">
            {dayMarkers.map((marker, i) => (
              <div 
                key={i} 
                className="absolute top-0 bottom-0 border-l border-gray-400 pl-2 text-sm font-bold text-gray-800 capitalize"
                style={{ left: `${marker.left}%` }}
              >
                {marker.label}
              </div>
            ))}
            {/* Hour Labels in Header */}
            {shiftMarkers.map((marker, i) => (
              <div 
                key={`h-${i}`} 
                className="absolute bottom-1 -translate-x-1/2 text-xs font-black text-blue-600 bg-blue-50 px-1 rounded border border-blue-100"
                style={{ left: `${marker.left}%` }}
              >
                {marker.hour}hs
              </div>
            ))}
          </div>

          {/* Rows for each Line */}
          <div className="space-y-4">
            {filteredLines.map(linea => (
              <div key={linea} className="flex items-center relative h-20 bg-gray-50 rounded-lg border border-gray-100">
                {/* Line Label */}
                <div className="w-24 flex-shrink-0 font-bold text-gray-700 text-center border-r border-gray-200 h-full flex items-center justify-center bg-white rounded-l-lg z-10">
                  Línea {linea}
                </div>

                {/* Gantt Area */}
                <div className="flex-1 relative h-full">
                  {/* Day Grid Lines */}
                  {dayMarkers.map((marker, i) => (
                    <div 
                      key={i} 
                      className="absolute top-0 bottom-0 border-l border-gray-300 z-0"
                      style={{ left: `${marker.left}%` }}
                    />
                  ))}

                  {/* Shift Markers (6, 14, 22) */}
                  {shiftMarkers.map((marker, i) => (
                    <div 
                      key={i} 
                      className="absolute top-0 bottom-0 border-l border-gray-200 border-dashed z-0"
                      style={{ left: `${marker.left}%` }}
                    />
                  ))}

                  {/* Production Blocks */}
                  {blocksByLine[linea].map((block, i) => (
                    <div
                      key={block.id || i}
                      className={`absolute top-1 bottom-1 rounded-md shadow-sm flex items-center justify-center overflow-hidden px-2 text-[10px] leading-tight font-bold border border-black/10 transition-all hover:z-20 hover:scale-[1.02] ${block.colorClass}`}
                      style={{ 
                        left: `${block.left}%`, 
                        width: `${block.width}%`,
                        minWidth: '20px'
                      }}
                      title={`${block.sabor} - ${block.tamano}cc\nInicio: ${format(block.start, 'dd/MM HH:mm')}\nFin: ${format(block.end, 'dd/MM HH:mm')}\nPacks: ${block.paquetes}`}
                    >
                      <span className="text-center">
                        {block.sabor}<br/>{block.tamano}cc ({block.paquetes}p)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          {/* Legend */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-600 mb-3">Leyenda de Sabores</h4>
            <div className="flex flex-wrap gap-3">
              {Object.entries(FLAVOR_COLORS).map(([sabor, colorClass]) => (
                <div key={sabor} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded ${colorClass} border border-black/10`}></div>
                  <span className="text-xs text-gray-600">{sabor}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
