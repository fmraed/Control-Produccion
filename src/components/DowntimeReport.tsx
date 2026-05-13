import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { FileText, Calendar, Filter, Clock, BarChart2, ChevronDown, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { REPORT_DOWNTIME_CATEGORIES, LINEAS, TAMANOS } from '../constants';
import { useAppConfig } from '../hooks/useAppConfig';
import { getLogicalDate } from '../utils';

const SPLIT_REASONS_MAP: Record<string, string[]> = {
  'REFRIGERIO/ INICIO Y FIN DE TURNO': ['REFRIGERIO', 'INICIO Y FIN DE TURNO'],
  'CAMBIO DE SABOR/ FORMATO': ['CAMBIO DE SABOR', 'CAMBIO DE FORMATO']
};

interface DowntimeReportProps {
  onViewPareto: (linea: string, month: string) => void;
}

export function DowntimeReport({ onViewPareto }: DowntimeReportProps) {
  const { availableLines, getFilteredSizes, shouldShowReport } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [expandedReasons, setExpandedReasons] = useState<Record<string, boolean>>({});

  const filteredLines = availableLines;

  const toggleReason = (reason: string) => {
    setExpandedReasons(prev => ({ ...prev, [reason]: !prev[reason] }));
  };

  useEffect(() => {
    const q = query(collection(db, 'production_reports'), orderBy('fecha', 'desc'));
    
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
  }, []);

  const months = useMemo(() => {
    const uniqueMonths = new Set<string>();
    reports.forEach(r => {
      if (shouldShowReport(r)) {
        const logicalDate = getLogicalDate(r);
        if (logicalDate) {
          const date = parseISO(logicalDate);
          uniqueMonths.add(format(date, 'yyyy-MM'));
        }
      }
    });
    uniqueMonths.add(format(new Date(), 'yyyy-MM'));
    return Array.from(uniqueMonths).sort().reverse();
  }, [reports, shouldShowReport]);

  const filteredReports = useMemo(() => {
    if (!selectedMonth) return reports.filter(r => shouldShowReport(r));
    return reports.filter(r => {
      if (!shouldShowReport(r)) return false;
      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [reports, selectedMonth, shouldShowReport]);

  // Dynamically determine which formats (sizes) exist for each line in the filtered data
  // while ensuring the requested ones are present.
  const formatosPorLinea = useMemo(() => {
    const filteredLines = availableLines;
    const filteredSizes = getFilteredSizes();
    const result: Record<string, number[]> = {};

    filteredLines.forEach(linea => {
      // Get sizes enabled for this line
      const enabledSizesForLine = getFilteredSizes(linea);
      const sizesSet = new Set<number>(enabledSizesForLine);

      // Also add sizes found in reports for this line
      filteredReports.forEach(r => {
        if (r.linea === linea && r.tamano) {
          sizesSet.add(r.tamano);
        }
      });

      result[linea] = Array.from(sizesSet).sort((a, b) => a - b);
    });

    return result;
  }, [filteredReports, availableLines, getFilteredSizes]);

  // Aggregate downtime data
  const aggregatedData = useMemo(() => {
    const data: Record<string, { total: number, byLine: Record<string, number>, byLineFormat: Record<string, Record<number, number>> }> = {};

    // Initialize data structure
    const initReason = (r: string) => {
      data[r] = {
        total: 0,
        byLine: { '1': 0, '2': 0, '3': 0 },
        byLineFormat: { '1': {}, '2': {}, '3': {} }
      };
      Object.keys(formatosPorLinea).forEach(l => {
        if (!data[r].byLineFormat[l]) data[r].byLineFormat[l] = {};
        formatosPorLinea[l].forEach(s => {
          data[r].byLineFormat[l][s] = 0;
        });
      });
    };

    REPORT_DOWNTIME_CATEGORIES.forEach(cat => {
      cat.reasons.forEach(reason => {
        initReason(reason);
        if (SPLIT_REASONS_MAP[reason]) {
          SPLIT_REASONS_MAP[reason].forEach(subReason => initReason(subReason));
        }
      });
    });

    filteredReports.forEach(report => {
      const line = report.linea;
      const size = report.tamano;

      report.downtimes?.forEach(dt => {
        const originalReason = dt.reason;
        const minutes = dt.totalMinutes || 0;

        if (minutes === 0) return;

        let combinedReason = originalReason;
        
        // Map split reasons back to combined reasons for the report
        if (originalReason === 'REFRIGERIO' || originalReason === 'INICIO Y FIN DE TURNO') {
          combinedReason = 'REFRIGERIO/ INICIO Y FIN DE TURNO';
        } else if (originalReason === 'CAMBIO DE SABOR' || originalReason === 'CAMBIO DE FORMATO') {
          combinedReason = 'CAMBIO DE SABOR/ FORMATO';
        }

        const addMinutes = (targetReason: string) => {
          if (data[targetReason]) {
            data[targetReason].total += minutes;
            if (line && data[targetReason].byLine[line] !== undefined) {
              data[targetReason].byLine[line] += minutes;
            }
            if (line && size && data[targetReason].byLineFormat[line]?.[size] !== undefined) {
              data[targetReason].byLineFormat[line][size] += minutes;
            }
          }
        };

        addMinutes(combinedReason);
        if (combinedReason !== originalReason) {
          addMinutes(originalReason);
        }
      });
    });

    return data;
  }, [filteredReports, formatosPorLinea]);

  // Calculate totals for the footer
  const totals = useMemo(() => {
    let totalPlanta = 0;
    const filteredLines = availableLines;
    const byLine: Record<string, number> = {};
    const byLineFormat: Record<string, Record<number, number>> = {};

    filteredLines.forEach(l => {
      byLine[l] = 0;
      byLineFormat[l] = {};
      if (formatosPorLinea[l]) {
        formatosPorLinea[l].forEach(s => {
          byLineFormat[l][s] = 0;
        });
      }
    });

    REPORT_DOWNTIME_CATEGORIES.forEach(cat => {
      cat.reasons.forEach(reason => {
        const reasonData = aggregatedData[reason];
        if (reasonData) {
          totalPlanta += reasonData.total;
          Object.keys(reasonData.byLine).forEach(l => {
            if (byLine[l] !== undefined) {
              byLine[l] += reasonData.byLine[l];
            }
          });
          Object.keys(reasonData.byLineFormat).forEach(l => {
            if (byLineFormat[l]) {
              Object.keys(reasonData.byLineFormat[l]).forEach(s => {
                const size = parseInt(s, 10);
                if (byLineFormat[l][size] !== undefined) {
                  byLineFormat[l][size] += reasonData.byLineFormat[l][size];
                }
              });
            }
          });
        }
      });
    });

    return { totalPlanta, byLine, byLineFormat };
  }, [aggregatedData, formatosPorLinea, availableLines]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Calculate total format columns for colspan
  const totalFormatCols = Object.values(formatosPorLinea).reduce((sum, formats: any) => sum + formats.length, 0);

  return (
    <div className="space-y-6">
      {/* Header & Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-gray-700 font-medium">
          <Clock className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg">Resumen de Paradas de Línea</h2>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2 min-w-[180px]"
          >
            {months.map(m => (
              <option key={m} value={m}>
                {format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: es }).replace(/^\w/, c => c.toUpperCase())}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              {/* Row 1: Main Headers */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <th colSpan={2} className="px-4 py-2 border-r border-gray-200"></th>
                <th className="px-4 py-2 text-center font-bold text-gray-700 border-r border-gray-200 bg-gray-100" rowSpan={2}>
                  TOTAL<br/>PLANTA
                </th>
                <th colSpan={filteredLines.length} className="px-4 py-2 text-center font-bold text-gray-700 border-r border-gray-200 bg-gray-100">
                  PARADAS ACUMULADAS POR LINEA
                </th>
                <th colSpan={totalFormatCols} className="px-4 py-2 text-center font-bold text-gray-700 bg-gray-100">
                  PARADAS ACUMULADAS POR LINEA Y POR FORMATO
                </th>
              </tr>
              {/* Row 2: Line Headers */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <th colSpan={2} className="px-4 py-2 border-r border-gray-200 text-center text-xs text-gray-500">[Min.]</th>
                {filteredLines.map(line => (
                  <th key={line} className={`px-4 py-2 text-center font-bold border-r border-gray-200 ${line === '1' ? 'bg-green-100 text-green-800' : line === '2' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    L{line}
                  </th>
                ))}
                
                {filteredLines.map(line => (
                  <th key={`format-header-${line}`} colSpan={formatosPorLinea[line]?.length || 0} className={`px-4 py-2 text-center font-bold border-r border-gray-200 ${line === '1' ? 'bg-green-50 text-green-800' : line === '2' ? 'bg-blue-50 text-blue-800' : 'bg-yellow-50 text-yellow-800'}`}>
                    L{line}
                  </th>
                ))}
              </tr>
              {/* Row 3: Format Headers */}
              <tr className="bg-gray-50 border-b-2 border-gray-300">
                <th className="px-4 py-2 text-left font-bold text-gray-600 border-r border-gray-200">CATEGORÍA</th>
                <th className="px-4 py-2 text-left font-bold text-gray-600 border-r border-gray-200">MOTIVO</th>
                <th className="px-4 py-2 border-r border-gray-200 bg-gray-100"></th>
                {filteredLines.map(line => (
                  <th key={`line-empty-${line}`} className={`px-4 py-2 border-r border-gray-200 ${line === '1' ? 'bg-green-100' : line === '2' ? 'bg-blue-100' : 'bg-yellow-100'}`}></th>
                ))}
                
                {filteredLines.map(line => (
                  formatosPorLinea[line]?.map(size => (
                    <th key={`size-${line}-${size}`} className={`px-2 py-2 text-center text-xs font-bold border-r border-gray-200 ${line === '1' ? 'bg-green-50/50 text-green-700' : line === '2' ? 'bg-blue-50/50 text-blue-700' : 'bg-yellow-50/50 text-yellow-700'}`}>
                      {size.toLocaleString('es-AR')} cc
                    </th>
                  ))
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {REPORT_DOWNTIME_CATEGORIES.map((category, catIndex) => {
                let categoryRowSpan = category.reasons.length;
                category.reasons.forEach(r => {
                  if (expandedReasons[r] && SPLIT_REASONS_MAP[r]) {
                    categoryRowSpan += SPLIT_REASONS_MAP[r].length;
                  }
                });

                return category.reasons.map((reason, reasonIndex) => {
                  const data = aggregatedData[reason];
                  const hasSubReasons = !!SPLIT_REASONS_MAP[reason];
                  const isExpanded = expandedReasons[reason];

                  const renderRow = (r: string, d: any, isSubRow = false) => (
                    <tr key={r} className={isSubRow ? "bg-gray-50/50" : "hover:bg-gray-50"}>
                      {reasonIndex === 0 && !isSubRow && (
                        <td rowSpan={categoryRowSpan} className="px-4 py-2 text-xs font-bold text-gray-700 uppercase border-r border-gray-200 align-middle bg-white">
                          {category.name}
                        </td>
                      )}
                      <td className={`px-4 py-2 text-xs text-gray-800 border-r border-gray-200 ${isSubRow ? 'pl-8 text-gray-600' : ''}`}>
                        {hasSubReasons && !isSubRow ? (
                          <button 
                            onClick={() => toggleReason(r)}
                            className="flex items-center gap-1 hover:text-blue-600 transition-colors text-left w-full font-medium"
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            {r}
                          </button>
                        ) : (
                          <span>{isSubRow ? `↳ ${r}` : r}</span>
                        )}
                      </td>
                      <td className={`px-4 py-2 text-center border-r border-gray-200 bg-gray-50 ${d.total !== 0 ? 'font-bold text-gray-900' : 'text-gray-300'}`}>
                        {d.total !== 0 ? Math.round(d.total) : 0}
                      </td>
                      {filteredLines.map(line => (
                        <td key={line} className={`px-4 py-2 text-center border-r border-gray-200 ${d.byLine[line] !== 0 ? 'font-medium ' + (line === '1' ? 'text-green-700' : line === '2' ? 'text-blue-700' : 'text-yellow-700') : 'text-gray-300'}`}>
                          {d.byLine[line] !== 0 ? Math.round(d.byLine[line]) : 0}
                        </td>
                      ))}
                      
                      {filteredLines.map(line => (
                        formatosPorLinea[line]?.map(size => {
                          const val = d.byLineFormat[line]?.[size] || 0;
                          return (
                            <td key={`val-${line}-${size}`} className={`px-2 py-2 text-center border-r border-gray-200 ${val !== 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                              {val !== 0 ? Math.round(val) : 0}
                            </td>
                          );
                        })
                      ))}
                    </tr>
                  );

                  return (
                    <React.Fragment key={reason}>
                      {renderRow(reason, data, false)}
                      {isExpanded && hasSubReasons && SPLIT_REASONS_MAP[reason].map(subReason => (
                        renderRow(subReason, aggregatedData[subReason], true)
                      ))}
                    </React.Fragment>
                  );
                });
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-gray-300">
                <td colSpan={2} className="px-4 py-3 text-right font-bold text-gray-900 border-r border-gray-200">
                  TOTALES
                </td>
                <td className="px-4 py-3 text-center font-bold text-gray-900 border-r border-gray-200">
                  {Math.round(totals.totalPlanta)}
                </td>
                {filteredLines.map(line => (
                  <td key={line} className={`px-4 py-3 text-center font-bold border-r border-gray-200 ${line === '1' ? 'text-green-800' : line === '2' ? 'text-blue-800' : 'text-yellow-800'}`}>
                    {Math.round(totals.byLine[line] || 0)}
                  </td>
                ))}
                
                {filteredLines.map(line => (
                  formatosPorLinea[line]?.map(size => {
                    const val = totals.byLineFormat[line]?.[size] || 0;
                    return (
                      <td key={`total-${line}-${size}`} className="px-2 py-3 text-center font-bold text-gray-800 border-r border-gray-200">
                        {val !== 0 ? Math.round(val) : 0}
                      </td>
                    );
                  })
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Pareto Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <button
          onClick={() => onViewPareto('1', selectedMonth)}
          className="flex items-center justify-center gap-2 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 py-3 px-4 rounded-xl transition-colors font-medium"
        >
          <BarChart2 className="w-5 h-5" />
          Ver Pareto Línea 1
        </button>
        <button
          onClick={() => onViewPareto('2', selectedMonth)}
          className="flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 py-3 px-4 rounded-xl transition-colors font-medium"
        >
          <BarChart2 className="w-5 h-5" />
          Ver Pareto Línea 2
        </button>
        <button
          onClick={() => onViewPareto('3', selectedMonth)}
          className="flex items-center justify-center gap-2 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border border-yellow-200 py-3 px-4 rounded-xl transition-colors font-medium"
        >
          <BarChart2 className="w-5 h-5" />
          Ver Pareto Línea 3
        </button>
      </div>
    </div>
  );
}
