import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport } from '../types';
import { FileText, Calendar, Filter, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import { SABORES, TAMANOS } from '../constants';
import { useAppConfig } from '../hooks/useAppConfig';
import { getLogicalDate } from '../utils';

export function ConsolidatedReport() {
  const { config, getFilteredFlavors, getFilteredSizes, availableBrands, shouldShowReport } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));

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
    // Ensure current month is always there if not present
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

  // Consolidated data structure
  // { [marca|sabor]: { [tamano]: { packs: number, extraBot: number } } }
  const consolidatedData = useMemo(() => {
    const data: Record<string, Record<number, { packs: number, extraBot: number }>> = {};
    const totalsBySize: Record<number, number> = {};
    let grandTotalPacks = 0;
    let grandTotalExtraBot = 0;
    const uniqueCombinations = new Set<string>();
    const sizesWithData = new Set<number>();

    const enabledSizes = getFilteredSizes();
    const enabledBrands = availableBrands;

    // 1. Collect sizes and combinations from reports in the selected month
    filteredReports.forEach(report => {
      const tamano = Number(report.tamano);
      const botellas = Number(report.botellas || 0);
      
      if (!isNaN(tamano) && botellas > 0) {
        sizesWithData.add(tamano);
      }
      
      if (report.marca && report.sabor && botellas > 0) {
        uniqueCombinations.add(`${report.marca}|${report.sabor}`);
      }
    });

    // 2. Add enabled (active) items
    // Sizes and Combinations filtered by local production
    enabledBrands.forEach(marca => {
      const brandActive = config?.activeProducts?.[marca];
      const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
      const brandCombos = config?.brandFlavorCombinations?.[marca] || [];

      enabledSizes.forEach(size => {
        const sizeStr = size.toString();
        const hasSizeConfig = brandActive && sizeStr in brandActive;
        const flavors = hasSizeConfig ? (brandActive as any)[sizeStr] : (hasBrandConfig ? [] : brandCombos);
        
        const externalForSize = config?.externalProducts?.[marca]?.[sizeStr] || [];
        
        flavors.forEach((sabor: string) => {
          if (config?.enabledFlavors?.[sabor] !== false && !externalForSize.includes(sabor)) {
            uniqueCombinations.add(`${marca}|${sabor}`);
            sizesWithData.add(size);
          }
        });
      });
    });

    const finalSizes = Array.from(sizesWithData).sort((a, b) => b - a);

    // Initialize totals
    finalSizes.forEach(tamano => {
      totalsBySize[tamano] = 0;
    });

    const sortedCombinations = Array.from(uniqueCombinations).sort((a, b) => {
      const [marcaA, saborA] = a.split('|');
      const [marcaB, saborB] = b.split('|');
      if (marcaA !== marcaB) return marcaA.localeCompare(marcaB);
      return saborA.localeCompare(saborB);
    });

    // Initialize data for all combinations
    sortedCombinations.forEach(key => {
      data[key] = {};
      finalSizes.forEach(tamano => {
        data[key][tamano] = { packs: 0, extraBot: 0 };
      });
    });

    filteredReports.forEach(report => {
      const key = `${report.marca || 'Torasso'}|${report.sabor}`;
      const tamano = Number(report.tamano);
      
      // Double check it's not an external product (though it shouldn't be reported anyway)
      const isExternal = (config?.externalProducts?.[report.marca]?.[tamano.toString()] || []).includes(report.sabor);
      
      if (tamano && data[key] && data[key][tamano] && !isExternal) {
        const botellas = report.botellas || 0;
        const botellasPorPack = config?.botellasPorPack?.[tamano] || 1;
        const packs = Math.floor(botellas / botellasPorPack);
        const extra = botellas % botellasPorPack;

        data[key][tamano].packs += packs;
        data[key][tamano].extraBot += extra;
        totalsBySize[tamano] += packs;
        grandTotalPacks += packs;
        grandTotalExtraBot += extra;
      }
    });

    return { data, totalsBySize, sortedCombinations, filteredSizes: finalSizes, grandTotalPacks, grandTotalExtraBot };
  }, [filteredReports, getFilteredFlavors, getFilteredSizes, availableBrands]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const sortedTamanos = [3000, 2250, 2000, 1000, 1500, 500];

  return (
    <div className="space-y-6">
      {/* Header & Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-gray-700 font-medium">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg">Consolidado de Producción</h2>
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
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider border-r border-gray-200 sticky left-0 bg-gray-50 z-10">
                  Sabor
                </th>
                <th className="px-2 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wider border-r border-gray-200">
                  Paquetes x
                </th>
                <th className="px-2 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wider border-r border-gray-200">
                  Bot
                </th>
                {consolidatedData.filteredSizes.map(tamano => (
                  <th key={tamano} colSpan={3} className="px-2 py-2 text-center text-xs font-bold text-gray-600 uppercase tracking-wider border-r border-gray-200">
                    <div className="border-b border-gray-200 pb-1 mb-1">{tamano.toString()} cc</div>
                    <div className="grid grid-cols-3 gap-1 text-[10px]">
                      <span>Packs</span>
                      <span>Bot +</span>
                      <span>%</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {consolidatedData.sortedCombinations.map((key) => {
                const [marca, sabor] = key.split('|');
                const hasProduction = consolidatedData.filteredSizes.some(t => consolidatedData.data[key][t].packs > 0);
                
                return (
                   <tr key={key} className={`hover:bg-blue-50/30 transition-colors ${!hasProduction ? 'opacity-40' : ''}`}>
                    <td className="px-4 py-2 text-sm font-medium text-gray-900 border-r border-gray-200 sticky left-0 bg-white z-10">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase font-bold">{marca}</span>
                        <span>{sabor}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center text-xs text-gray-500 border-r border-gray-200 italic">
                      paquetes x
                    </td>
                    <td className="px-2 py-2 text-center text-sm font-semibold text-gray-700 border-r border-gray-200">
                      {/* We take the bottles per pack for the first size that has production, or default to 6 */}
                      {(() => {
                        const firstSizeWithProd = consolidatedData.filteredSizes.find(t => consolidatedData.data[key][t].packs > 0);
                        return config?.botellasPorPack?.[firstSizeWithProd || 3000] || 6;
                      })()}
                    </td>
                    {consolidatedData.filteredSizes.map(tamano => {
                      const cell = consolidatedData.data[key][tamano];
                      const totalForSize = consolidatedData.totalsBySize[tamano] || 0;
                      const percentage = totalForSize > 0 ? (cell.packs / totalForSize) * 100 : 0;
                      const isActive = getFilteredFlavors(marca, tamano, false).includes(sabor);

                      return (
                        <td key={tamano} colSpan={3} className={`px-0 py-0 border-r border-gray-300 ${isActive ? '' : 'bg-gray-300/80 relative'}`}>
                          {!isActive && (
                            <div className="absolute inset-0 opacity-[0.1] pointer-events-none bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,#000_10px,#000_20px)]"></div>
                          )}
                          <div className={`grid grid-cols-3 h-full items-center text-center divide-x divide-gray-200 ${isActive ? '' : 'opacity-30'}`}>
                            <span className={`py-2 text-sm ${cell.packs > 0 ? 'font-bold text-blue-700' : (isActive ? 'text-gray-200' : 'text-gray-800 font-black')}`}>
                              {cell.packs > 0 ? cell.packs.toLocaleString('es-AR') : '-'}
                            </span>
                            <span className={`py-2 text-xs ${cell.extraBot > 0 ? 'text-orange-600 font-medium' : 'text-transparent'}`}>
                              {cell.extraBot > 0 ? cell.extraBot : ''}
                            </span>
                            <span className={`py-2 text-[10px] ${percentage > 0 ? 'text-green-600 font-medium' : 'text-transparent'}`}>
                              {percentage > 0 ? `${Math.round(percentage)}%` : ''}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 sticky left-0 bg-gray-100 z-10">
                  TOTALES
                </td>
                <td className="border-r border-gray-200"></td>
                <td className="border-r border-gray-200"></td>
                {consolidatedData.filteredSizes.map(tamano => (
                  <td key={tamano} colSpan={3} className="px-2 py-3 text-center text-sm text-blue-800 border-r border-gray-200">
                    {consolidatedData.totalsBySize[tamano].toLocaleString('es-AR')}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Grand Total Section */}
      <div className="bg-blue-50 rounded-xl shadow-sm border border-blue-200 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-blue-900">Total General de Producción</h3>
          <p className="text-sm text-blue-700">Suma de todos los sabores y calibres en el periodo seleccionado</p>
        </div>
        <div className="flex items-center gap-6 bg-white px-6 py-4 rounded-lg shadow-sm border border-blue-100">
          <div className="text-center">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Packs Totales</div>
            <div className="text-4xl font-black text-blue-700">{consolidatedData.grandTotalPacks.toLocaleString('es-AR')}</div>
          </div>
          <div className="w-px h-12 bg-gray-200"></div>
          <div className="text-center">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Botellas Sueltas</div>
            <div className="text-3xl font-bold text-orange-600">{consolidatedData.grandTotalExtraBot.toLocaleString('es-AR')}</div>
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-400 italic">
        * Los porcentajes (%) se calculan sobre el total de paquetes producidos para cada calibre en el periodo seleccionado.
      </div>
    </div>
  );
}
