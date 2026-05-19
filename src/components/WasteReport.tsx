import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport, ElaboracionReport } from '../types';
import { FileText, Calendar, Filter, Trash2, BarChart3, Wind } from 'lucide-react';
import { format, parseISO, getDaysInMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { SABORES, TAMANOS, LINEAS } from '../constants';
import { useAppConfig } from '../hooks/useAppConfig';
import { getLogicalDate } from '../utils';

export function WasteReport() {
  const { config, getFilteredSizes, availableLines, availableBrands, shouldShowReport } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [elaboracionReports, setElaboracionReports] = useState<ElaboracionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [activeTab, setActiveTab] = useState<'general' | 'co2' | 'jarabe' | 'resumen'>('general');

  useEffect(() => {
    const qProd = query(collection(db, 'production_reports'), orderBy('fecha', 'desc'));
    const qElab = query(collection(db, 'elaboracion_reports'), orderBy('fecha', 'desc'));
    
    const unsubProd = onSnapshot(qProd, (snapshot) => {
      const reportsData: ProductionReport[] = [];
      snapshot.forEach((doc) => {
        reportsData.push({ id: doc.id, ...doc.data() } as ProductionReport);
      });
      setReports(reportsData);
    }, (err) => {
      console.error("Error fetching production reports:", err);
    });

    const unsubElab = onSnapshot(qElab, (snapshot) => {
      const elabData: ElaboracionReport[] = [];
      snapshot.forEach((doc) => {
        elabData.push({ id: doc.id, ...doc.data() } as ElaboracionReport);
      });
      setElaboracionReports(elabData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching elaboracion reports:", err);
      setLoading(false);
    });

    return () => {
      unsubProd();
      unsubElab();
    };
  }, []);

  const months = useMemo(() => {
    const uniqueMonths = new Set<string>();
    const addMonth = (r: ProductionReport | ElaboracionReport) => {
      // For ProductionReport, we check historical filter
      if ('origin' in r && !shouldShowReport(r as ProductionReport)) return;
      
      const logicalDate = getLogicalDate(r);
      if (logicalDate) {
        const date = parseISO(logicalDate);
        uniqueMonths.add(format(date, 'yyyy-MM'));
      }
    };
    reports.forEach(addMonth);
    elaboracionReports.forEach(addMonth);
    uniqueMonths.add(format(new Date(), 'yyyy-MM'));
    return Array.from(uniqueMonths).sort().reverse();
  }, [reports, elaboracionReports, shouldShowReport]);

  const filteredReports = useMemo(() => {
    if (!selectedMonth) return reports.filter(r => shouldShowReport(r));
    return reports.filter(r => {
      if (!shouldShowReport(r)) return false;
      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [reports, selectedMonth, shouldShowReport]);

  const filteredElabReports = useMemo(() => {
    if (!selectedMonth) return elaboracionReports;
    return elaboracionReports.filter(r => {
      const logicalDate = getLogicalDate(r);
      return logicalDate && logicalDate.startsWith(selectedMonth);
    });
  }, [elaboracionReports, selectedMonth]);

  // Calculations
  const wasteData = useMemo(() => {
    const filteredLines = availableLines;
    
    // Filter sizes: only show if they have at least one local (non-external) enabled product
    const initialFilteredSizes = getFilteredSizes();
    const filteredSizes = initialFilteredSizes.filter(size => {
      const sizeStr = size.toString();
      
      // Check if ANY enabled brand has ANY enabled flavor for this size that is NOT external
      return availableBrands.some(brand => {
        const brandActive = config?.activeProducts?.[brand];
        const hasBrandConfig = brandActive && Object.keys(brandActive).length > 0;
        const brandCombos = config?.brandFlavorCombinations?.[brand] || [];

        const hasSizeConfig = brandActive && sizeStr in brandActive;
        const flavors = hasSizeConfig 
          ? (brandActive as any)[sizeStr] 
          : (hasBrandConfig ? [] : (brandCombos || []));
        
        const externalForSize = config?.externalProducts?.[brand]?.[sizeStr] || [];
        
        return flavors.some((sabor: string) => 
          config?.enabledFlavors?.[sabor] !== false && !externalForSize.includes(sabor)
        );
      });
    });

    // 1. Scrap Preformas by Line and Caliber
    const scrapByLineAndSize: Record<string, Record<number, number>> = {};
    const prodByLineAndSize: Record<string, Record<number, number>> = {};
    filteredLines.forEach(l => {
      scrapByLineAndSize[l] = {};
      prodByLineAndSize[l] = {};
      filteredSizes.forEach(s => {
        scrapByLineAndSize[l][s] = 0;
        prodByLineAndSize[l][s] = 0;
      });
    });

    // 2. Totals for weighting
    let totalUnitsProduced = 0;
    let totalUnitsProducedNoSifon = 0;
    let totalUnitsSodaSifon = 0;
    let totalPacksProduced = 0;
    
    const unitsProducedBySize: Record<number, number> = {};
    const unitsProducedNoSifonBySize: Record<number, number> = {};
    filteredSizes.forEach(s => {
      unitsProducedBySize[s] = 0;
      unitsProducedNoSifonBySize[s] = 0;
    });

    // 3. Total weights and direct units of waste
    let totalKgTapas = 0;
    let totalKgEtiquetas = 0;
    let totalKgTermo = 0;
    let totalWasteSifones = 0;

    filteredReports.forEach(r => {
      const size = r.tamano || 0;
      const line = r.linea || '';
      const units = r.botellas || 0;
      const packs = r.paquetes || 0;
      const isSifon = r.sabor === 'Soda Sifon';

      // Scrap Preformas (Soplado + Etiquetado + Llenado + Horno)
      const scrap = (r.scrapSoplado || 0) + (r.scrapEtiquetado || 0) + (r.scrapLlenado || 0) + (r.scrapHorno || 0);
      if (scrapByLineAndSize[line] && scrapByLineAndSize[line][size] !== undefined) {
        scrapByLineAndSize[line][size] += scrap;
        prodByLineAndSize[line][size] += units;
      }

      // Totals for weighting
      if (size && unitsProducedBySize[size] !== undefined) {
        unitsProducedBySize[size] += units;
        totalUnitsProduced += units;
        if (!isSifon) {
          totalUnitsProducedNoSifon += units;
          unitsProducedNoSifonBySize[size] += units;
        } else {
          totalUnitsSodaSifon += units;
        }
        totalPacksProduced += packs;
      }

      // Waste values
      totalKgTapas += (r.desperdicioTapas || 0);
      totalKgEtiquetas += (r.desperdicioEtiquetas || 0);
      totalKgTermo += (r.desperdicioTermo || 0);
      totalWasteSifones += (r.desperdicioSifones || 0);
    });

    // 4. Calculate weighted waste units
    let totalWasteTapas = 0;
    let totalWasteEtiquetas = 0;
    let totalWasteTermo = 0;

    filteredSizes.forEach(size => {
      // For labels and thermo, we use total production weighting
      const ponderadorGeneral = totalUnitsProduced > 0 ? unitsProducedBySize[size] / totalUnitsProduced : 0;
      // For caps, we weight by production that uses caps (no sifon)
      const ponderadorTapas = totalUnitsProducedNoSifon > 0 ? unitsProducedNoSifonBySize[size] / totalUnitsProducedNoSifon : 0;
      
      const weights = config?.wasteWeights?.[size.toString()];
      if (!weights) return;

      const kgTapasSize = totalKgTapas * ponderadorTapas;
      const kgEtiquetasSize = totalKgEtiquetas * ponderadorGeneral;
      const kgTermoSize = totalKgTermo * ponderadorGeneral;

      const tapasUnits = weights.tapa > 0 ? (kgTapasSize * 1000) / weights.tapa : 0;
      const etiquetasUnits = weights.etiq > 0 ? (kgEtiquetasSize * 1000) / weights.etiq : 0;
      const termoPacks = weights.termo > 0 ? kgTermoSize / weights.termo : 0;

      totalWasteTapas += tapasUnits;
      totalWasteEtiquetas += etiquetasUnits;
      totalWasteTermo += termoPacks;
    });

    return {
      scrapByLineAndSize,
      prodByLineAndSize,
      totalWasteTapas: Math.round(totalWasteTapas),
      totalWasteEtiquetas: Math.round(totalWasteEtiquetas),
      totalWasteTermo: Math.round(totalWasteTermo),
      totalWasteSifones,
      totalKgTapas,
      totalKgEtiquetas,
      totalKgTermo,
      totalUnitsProduced,
      totalUnitsProducedNoSifon,
      totalUnitsSodaSifon,
      totalPacksProduced,
      filteredLines,
      filteredSizes
    };
  }, [filteredReports, availableLines, availableBrands, getFilteredSizes, config]);

  const co2Data = useMemo(() => {
    // Group production reports by date and shift
    const prodByDateShift: Record<string, number> = {};
    filteredReports.forEach(r => {
      const logicalDate = getLogicalDate(r);
      const key = `${logicalDate}_${r.turno}`;
      prodByDateShift[key] = (prodByDateShift[key] || 0) + (r.co2 || 0);
    });

    // Group elaboracion reports by date and shift
    const elabByDateShift: Record<string, number> = {};
    filteredElabReports.forEach(r => {
      const logicalDate = getLogicalDate(r);
      const key = `${logicalDate}_${r.turno}`;
      elabByDateShift[key] = (elabByDateShift[key] || 0) + (r.co2Consumido || 0);
    });

    // Create a combined list of all date/shift combinations present in either
    const allKeys = Array.from(new Set([...Object.keys(prodByDateShift), ...Object.keys(elabByDateShift)]));
    
    const shiftOrder: Record<string, number> = {
      'Noche': 1,
      'Tarde': 2,
      'Mañana': 3
    };
    
    const details = allKeys.map(key => {
      const [fecha, turno] = key.split('_');
      const teorico = prodByDateShift[key] || 0;
      const real = elabByDateShift[key] || 0;
      const desperdicio = real - teorico;
      const porcentaje = teorico > 0 ? (desperdicio / teorico) * 100 : 0;
      
      return {
        fecha,
        turno,
        teorico,
        real,
        desperdicio,
        porcentaje
      };
    }).sort((a, b) => {
      // 1. Ordenar por fecha descendente (más reciente primero)
      const dateCompare = b.fecha.localeCompare(a.fecha);
      if (dateCompare !== 0) return dateCompare;
      
      // 2. Ordenar por turno: Noche (1), Tarde (2), Mañana (3)
      return (shiftOrder[a.turno] || 99) - (shiftOrder[b.turno] || 99);
    });

    const totalTeorico = details.reduce((sum, d) => sum + d.teorico, 0);
    const totalReal = details.reduce((sum, d) => sum + d.real, 0);
    const totalDesperdicio = totalReal - totalTeorico;
    const totalPorcentaje = totalTeorico > 0 ? (totalDesperdicio / totalTeorico) * 100 : 0;

    return {
      details,
      totalTeorico,
      totalReal,
      totalDesperdicio,
      totalPorcentaje
    };
  }, [filteredReports, filteredElabReports]);

  const jarabeData = useMemo(() => {
    // Group production reports by date and shift
    const prodByDateShift: Record<string, number> = {};
    filteredReports.forEach(r => {
      const logicalDate = getLogicalDate(r);
      const key = `${logicalDate}_${r.turno}`;
      prodByDateShift[key] = (prodByDateShift[key] || 0) + (r.jarabeConsumido || 0);
    });

    // Group elaboracion reports by date and shift
    const elabByDateShift: Record<string, number> = {};
    filteredElabReports.forEach(r => {
      const logicalDate = getLogicalDate(r);
      const key = `${logicalDate}_${r.turno}`;
      elabByDateShift[key] = (elabByDateShift[key] || 0) + (r.jarabeConsumido || 0);
    });

    // Create a combined list of all date/shift combinations present in either
    const allKeys = Array.from(new Set([...Object.keys(prodByDateShift), ...Object.keys(elabByDateShift)]));
    
    const shiftOrder: Record<string, number> = {
      'Noche': 1,
      'Tarde': 2,
      'Mañana': 3
    };
    
    const details = allKeys.map(key => {
      const [fecha, turno] = key.split('_');
      const teorico = prodByDateShift[key] || 0;
      const real = elabByDateShift[key] || 0;
      const desperdicio = real - teorico;
      const porcentaje = teorico > 0 ? (desperdicio / teorico) * 100 : 0;
      
      return {
        fecha,
        turno,
        teorico,
        real,
        desperdicio,
        porcentaje
      };
    }).sort((a, b) => {
      // 1. Ordenar por fecha descendente (más reciente primero)
      const dateCompare = b.fecha.localeCompare(a.fecha);
      if (dateCompare !== 0) return dateCompare;
      
      // 2. Ordenar por turno: Noche (1), Tarde (2), Mañana (3)
      return (shiftOrder[a.turno] || 99) - (shiftOrder[b.turno] || 99);
    });

    const totalTeorico = details.reduce((sum, d) => sum + d.teorico, 0);
    const totalReal = details.reduce((sum, d) => sum + d.real, 0);
    const totalDesperdicio = totalReal - totalTeorico;
    const totalPorcentaje = totalTeorico > 0 ? (totalDesperdicio / totalTeorico) * 100 : 0;

    return {
      details,
      totalTeorico,
      totalReal,
      totalDesperdicio,
      totalPorcentaje
    };
  }, [filteredReports, filteredElabReports]);

  const resumenData = useMemo(() => {
    if (!selectedMonth) return [];
    
    const daysInMonth = getDaysInMonth(parseISO(`${selectedMonth}-01`));
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const dailyData = days.map(day => {
      const dateStr = `${selectedMonth}-${day.toString().padStart(2, '0')}`;
      const dayReports = filteredReports.filter(r => {
        const d = getLogicalDate(r);
        return d === dateStr;
      });
      const dayElabReports = filteredElabReports.filter(r => {
        const d = getLogicalDate(r);
        return d === dateStr;
      });

      // CO2
      const co2Teorico = dayReports.reduce((sum, r) => sum + (r.co2 || 0), 0);
      const co2Real = dayElabReports.reduce((sum, r) => sum + (r.co2Consumido || 0), 0);
      
      // Jarabe
      const jarabeTeorico = dayReports.reduce((sum, r) => sum + (r.jarabeConsumido || 0), 0);
      const jarabeReal = dayElabReports.reduce((sum, r) => sum + (r.jarabeConsumido || 0), 0);

      // Preformas
      const preformasTeorico = dayReports.reduce((sum, r) => sum + (r.botellas || 0), 0);
      const preformasDiferencia = dayReports.reduce((sum, r) => sum + (r.scrapSoplado || 0) + (r.scrapEtiquetado || 0) + (r.scrapLlenado || 0) + (r.scrapHorno || 0), 0);
      const preformasReal = preformasTeorico + preformasDiferencia;

      // Tapas
      let tapasTeorico = 0;
      let kgTapas = 0;
      const unitsNoSifonBySize: Record<number, number> = {};
      dayReports.forEach(r => {
        if (r.sabor !== 'Soda Sifon') {
          tapasTeorico += (r.botellas || 0);
          const size = r.tamano || 0;
          unitsNoSifonBySize[size] = (unitsNoSifonBySize[size] || 0) + (r.botellas || 0);
        }
        kgTapas += (r.desperdicioTapas || 0);
      });
      
      let tapasDiferencia = 0;
      if (tapasTeorico > 0) {
        Object.entries(unitsNoSifonBySize).forEach(([sizeStr, units]) => {
          const size = Number(sizeStr);
          const weight = config?.wasteWeights?.[size.toString()]?.tapa || 0;
          if (weight > 0) {
            const proportion = units / tapasTeorico;
            const kgForSize = kgTapas * proportion;
            tapasDiferencia += (kgForSize * 1000) / weight;
          }
        });
      }
      tapasDiferencia = Math.round(tapasDiferencia);
      const tapasReal = tapasTeorico + tapasDiferencia;

      // Cabeza Sifon
      const sifonTeorico = dayReports.reduce((sum, r) => sum + (r.sabor === 'Soda Sifon' ? (r.botellas || 0) : 0), 0);
      const sifonDiferencia = dayReports.reduce((sum, r) => sum + (r.desperdicioSifones || 0), 0);
      const sifonReal = sifonTeorico + sifonDiferencia;

      return {
        day,
        dateStr,
        co2: { teorico: co2Teorico, real: co2Real, dif: co2Real - co2Teorico },
        jarabe: { teorico: jarabeTeorico, real: jarabeReal, dif: jarabeReal - jarabeTeorico },
        preformas: { teorico: preformasTeorico, real: preformasReal, dif: preformasDiferencia },
        tapas: { teorico: tapasTeorico, real: tapasReal, dif: tapasDiferencia },
        sifon: { teorico: sifonTeorico, real: sifonReal, dif: sifonDiferencia }
      };
    });

    return dailyData;
  }, [filteredReports, filteredElabReports, selectedMonth]);

  type ResumenKey = 'co2' | 'jarabe' | 'preformas' | 'tapas' | 'sifon';

  const renderResumenRow = (title: string, key: ResumenKey, unit: string) => {
    const totalTeorico = resumenData.reduce((sum, d) => sum + (d[key].teorico || 0), 0);
    const totalReal = resumenData.reduce((sum, d) => sum + (d[key].real || 0), 0);
    const totalDif = resumenData.reduce((sum, d) => sum + (d[key].dif || 0), 0);
    const totalPct = totalTeorico > 0 ? (totalDif / totalTeorico) * 100 : 0;

    return (
      <>
        <tr className="hover:bg-gray-50 border-t-2 border-gray-300">
          <td className="px-2 py-1 font-bold text-gray-900 border-r border-gray-200 sticky left-0 bg-white z-10 text-center align-middle" rowSpan={4}>
            {title}
          </td>
          <td className="px-2 py-1 text-left text-gray-600 border-r border-gray-200 font-bold whitespace-nowrap">
            % Desperdicio
          </td>
          <td className="px-2 py-1 text-center font-bold text-blue-600 border-r border-gray-200 bg-blue-50/30">
            {totalTeorico > 0 ? `${totalPct.toFixed(1)}%` : '-'}
          </td>
          {resumenData.map(d => {
            const data = d[key];
            const pct = data.teorico > 0 ? (data.dif / data.teorico) * 100 : 0;
            return (
              <td key={d.day} className="px-2 py-1 text-center font-bold border-r border-gray-200">
                {data.teorico > 0 ? `${pct.toFixed(1)}%` : '-'}
              </td>
            );
          })}
        </tr>
        <tr className="hover:bg-gray-50">
          <td className="px-2 py-1 text-left text-gray-600 border-r border-gray-200 whitespace-nowrap">
            Consumo Teorico [{unit}]
          </td>
          <td className="px-2 py-1 text-center font-bold text-blue-600 border-r border-gray-200 bg-blue-50/30">
            {totalTeorico ? totalTeorico.toLocaleString('es-AR') : '0'}
          </td>
          {resumenData.map(d => {
            const data = d[key];
            return (
              <td key={d.day} className="px-2 py-1 text-center border-r border-gray-200">
                {data.teorico ? data.teorico.toLocaleString('es-AR') : '0'}
              </td>
            );
          })}
        </tr>
        <tr className="hover:bg-gray-50">
          <td className="px-2 py-1 text-left text-gray-600 border-r border-gray-200 whitespace-nowrap">
            Consumos Real [{unit}]
          </td>
          <td className="px-2 py-1 text-center font-bold text-blue-600 border-r border-gray-200 bg-blue-50/30">
            {totalReal ? totalReal.toLocaleString('es-AR') : '0'}
          </td>
          {resumenData.map(d => {
            const data = d[key];
            return (
              <td key={d.day} className="px-2 py-1 text-center border-r border-gray-200">
                {data.real ? data.real.toLocaleString('es-AR') : '0'}
              </td>
            );
          })}
        </tr>
        <tr className="hover:bg-gray-50">
          <td className="px-2 py-1 text-left text-gray-600 border-r border-gray-200 whitespace-nowrap">
            Diferencia [{unit}]
          </td>
          <td className="px-2 py-1 text-center font-bold text-blue-600 border-r border-gray-200 bg-blue-50/30">
            {totalDif ? totalDif.toLocaleString('es-AR') : '0'}
          </td>
          {resumenData.map(d => {
            const data = d[key];
            return (
              <td key={d.day} className="px-2 py-1 text-center border-r border-gray-200">
                {data.dif ? data.dif.toLocaleString('es-AR') : '0'}
              </td>
            );
          })}
        </tr>
      </>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header & Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-gray-700 font-medium">
            <Trash2 className="w-5 h-5 text-red-600" />
            <h2 className="text-lg">Acumulado de Desperdicio</h2>
          </div>
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('general')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'general' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('co2')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'co2' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              CO2
            </button>
            <button
              onClick={() => setActiveTab('jarabe')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'jarabe' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Jarabe
            </button>
            <button
              onClick={() => setActiveTab('resumen')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'resumen' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Resumen
            </button>
          </div>
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

      {activeTab === 'general' ? (
        <>
          {/* Scrap de Preformas Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Scrap de Preformas (%)</h3>
          <p className="text-xs text-gray-500 mt-1">Porcentaje de Scrap sobre la producción total por calibre</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Línea</th>
                {wasteData.filteredSizes.map(size => (
                  <th key={size} className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200">
                    {size.toLocaleString('es-AR')}
                  </th>
                ))}
                <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase">Total Línea</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {wasteData.filteredLines.map(line => {
                let lineScrap = 0;
                let lineProd = 0;
                return (
                  <tr key={line} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-sm font-bold text-gray-900 border-r border-gray-200">Línea {line}</td>
                    {wasteData.filteredSizes.map(size => {
                      const scrap = wasteData.scrapByLineAndSize[line][size];
                      const prod = wasteData.prodByLineAndSize[line][size];
                      lineScrap += scrap;
                      lineProd += prod;
                      const pct = prod > 0 ? (scrap / prod) * 100 : 0;
                      return (
                        <td key={size} className="px-4 py-3 text-center text-sm border-r border-gray-200">
                          <div className="flex flex-col">
                            <span className={pct > 0 ? 'font-bold text-red-600' : 'text-gray-300'}>
                              {pct > 0 ? `${pct.toFixed(2)}%` : '-'}
                            </span>
                            {scrap > 0 && <span className="text-[10px] text-gray-400">({scrap.toLocaleString('es-AR')} u.)</span>}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-6 py-3 text-center text-sm font-bold text-blue-600 bg-blue-50/30">
                      {lineProd > 0 ? `${((lineScrap / lineProd) * 100).toFixed(2)}%` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-bold">
                <td className="px-6 py-3 text-sm text-gray-900 border-r border-gray-200">TOTALES</td>
                {wasteData.filteredSizes.map(size => {
                  let sizeScrap = 0;
                  let sizeProd = 0;
                  wasteData.filteredLines.forEach(l => { 
                    sizeScrap += wasteData.scrapByLineAndSize[l][size]; 
                    sizeProd += wasteData.prodByLineAndSize[l][size];
                  });
                  const pct = sizeProd > 0 ? (sizeScrap / sizeProd) * 100 : 0;
                  return (
                    <td key={size} className="px-4 py-3 text-center text-sm text-gray-900 border-r border-gray-200">
                      {pct > 0 ? `${pct.toFixed(2)}%` : '-'}
                    </td>
                  );
                })}
                <td className="px-6 py-3 text-center text-sm text-blue-800">
                  {(() => {
                    let totalScrap = 0;
                    let totalProd = 0;
                    wasteData.filteredLines.forEach(l => { 
                      wasteData.filteredSizes.forEach(s => { 
                        totalScrap += wasteData.scrapByLineAndSize[l][s]; 
                        totalProd += wasteData.prodByLineAndSize[l][s];
                      }); 
                    });
                    return totalProd > 0 ? `${((totalScrap / totalProd) * 100).toFixed(2)}%` : '-';
                  })()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Calculated Waste Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Desperdicio por Insumo</h3>
            <p className="text-xs text-gray-500 mt-1">Resumen mensual de descartes calculados</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-100 text-sm">
              <span className="font-bold">Total Tapas:</span> {wasteData.totalUnitsProducedNoSifon.toLocaleString('es-AR')}
            </div>
            <div className="bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg border border-orange-100 text-sm">
              <span className="font-bold">Total Cabezales:</span> {wasteData.totalUnitsSodaSifon.toLocaleString('es-AR')}
            </div>
            <div className="bg-green-50 text-green-700 px-3 py-1.5 rounded-lg border border-green-100 text-sm">
              <span className="font-bold">Total Botellas:</span> {wasteData.totalUnitsProduced.toLocaleString('es-AR')}
            </div>
            <div className="bg-purple-50 text-purple-700 px-3 py-1.5 rounded-lg border border-purple-100 text-sm">
              <span className="font-bold">Total Packs:</span> {wasteData.totalPacksProduced.toLocaleString('es-AR')}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Insumo</th>
                <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200">KG Ingresados / U. Directas</th>
                <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Total Unidades/Paños</th>
                <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase">% Desperdicio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900 border-r border-gray-200">Tapas</td>
                <td className="px-6 py-4 text-center border-r border-gray-200">{wasteData.totalKgTapas.toFixed(2)} kg</td>
                <td className="px-6 py-4 text-center border-r border-gray-200 font-bold text-orange-600">{wasteData.totalWasteTapas.toLocaleString('es-AR')} u.</td>
                <td className="px-6 py-4 text-center font-bold text-red-600 bg-red-50/20">
                  {wasteData.totalUnitsProducedNoSifon > 0 ? `${((wasteData.totalWasteTapas / wasteData.totalUnitsProducedNoSifon) * 100).toFixed(2)}%` : '-'}
                </td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900 border-r border-gray-200">Cabezales (Sifones)</td>
                <td className="px-6 py-4 text-center border-r border-gray-200">{wasteData.totalWasteSifones.toLocaleString('es-AR')} u.</td>
                <td className="px-6 py-4 text-center border-r border-gray-200 font-bold text-orange-600">{wasteData.totalWasteSifones.toLocaleString('es-AR')} u.</td>
                <td className="px-6 py-4 text-center font-bold text-red-600 bg-red-50/20">
                  {wasteData.totalUnitsSodaSifon > 0 ? `${((wasteData.totalWasteSifones / wasteData.totalUnitsSodaSifon) * 100).toFixed(2)}%` : '-'}
                </td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900 border-r border-gray-200">Etiquetas</td>
                <td className="px-6 py-4 text-center border-r border-gray-200">{wasteData.totalKgEtiquetas.toFixed(2)} kg</td>
                <td className="px-6 py-4 text-center border-r border-gray-200 font-bold text-blue-600">{wasteData.totalWasteEtiquetas.toLocaleString('es-AR')} u.</td>
                <td className="px-6 py-4 text-center font-bold text-red-600 bg-red-50/20">
                  {wasteData.totalUnitsProduced > 0 ? `${((wasteData.totalWasteEtiquetas / wasteData.totalUnitsProduced) * 100).toFixed(2)}%` : '-'}
                </td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900 border-r border-gray-200">Termo</td>
                <td className="px-6 py-4 text-center border-r border-gray-200">{wasteData.totalKgTermo.toFixed(2)} kg</td>
                <td className="px-6 py-4 text-center border-r border-gray-200 font-bold text-purple-600">{wasteData.totalWasteTermo.toLocaleString('es-AR')} paños</td>
                <td className="px-6 py-4 text-center font-bold text-red-600 bg-red-50/20">
                  {wasteData.totalPacksProduced > 0 ? `${((wasteData.totalWasteTermo / wasteData.totalPacksProduced) * 100).toFixed(2)}%` : '-'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* CO2 Summary Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Wind className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-bold text-gray-800">Resumen CO2</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
            <p className="text-xs text-blue-600 font-bold uppercase mb-1">CO2 Teórico Total</p>
            <p className="text-2xl font-bold text-blue-900">{co2Data.totalTeorico.toLocaleString('es-AR')} kg</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg border border-green-100">
            <p className="text-xs text-green-600 font-bold uppercase mb-1">CO2 Real Total</p>
            <p className="text-2xl font-bold text-green-900">{co2Data.totalReal.toLocaleString('es-AR')} kg</p>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
            <p className="text-xs text-orange-600 font-bold uppercase mb-1">Desperdicio Total</p>
            <p className="text-2xl font-bold text-orange-900">{co2Data.totalDesperdicio.toLocaleString('es-AR')} kg</p>
          </div>
          <div className="bg-red-50 p-4 rounded-lg border border-red-100">
            <p className="text-xs text-red-600 font-bold uppercase mb-1">% Desperdicio Total</p>
            <p className="text-2xl font-bold text-red-900">{co2Data.totalPorcentaje.toFixed(2)}%</p>
          </div>
        </div>
      </div>

      {/* Jarabe Summary Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-orange-500" />
          <h3 className="text-lg font-bold text-gray-800">Resumen Jarabe</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
            <p className="text-xs text-blue-600 font-bold uppercase mb-1">Jarabe Teórico Total</p>
            <p className="text-2xl font-bold text-blue-900">{jarabeData.totalTeorico.toLocaleString('es-AR')} L</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg border border-green-100">
            <p className="text-xs text-green-600 font-bold uppercase mb-1">Jarabe Real Total</p>
            <p className="text-2xl font-bold text-green-900">{jarabeData.totalReal.toLocaleString('es-AR')} L</p>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
            <p className="text-xs text-orange-600 font-bold uppercase mb-1">Desperdicio Total</p>
            <p className="text-2xl font-bold text-orange-900">{jarabeData.totalDesperdicio.toLocaleString('es-AR')} L</p>
          </div>
          <div className="bg-red-50 p-4 rounded-lg border border-red-100">
            <p className="text-xs text-red-600 font-bold uppercase mb-1">% Desperdicio Total</p>
            <p className="text-2xl font-bold text-red-900">{jarabeData.totalPorcentaje.toFixed(2)}%</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <h4 className="text-sm font-bold text-blue-800 mb-2">Lógica de Cálculo</h4>
          <ul className="text-xs text-blue-700 space-y-1 list-disc pl-4">
            <li>El Scrap de Preformas se muestra como porcentaje sobre la producción de cada calibre.</li>
            <li>En <strong>Tapas</strong> se usa el <em>Total Tapas</em> (excluye Soda Sifón).</li>
            <li>En <strong>Cabezales</strong> se usa el <em>Total Cabezales</em> (solo Soda Sifón).</li>
            <li>En <strong>Etiquetas</strong> se usa el <em>Total Botellas</em> (producción total).</li>
            <li>En <strong>Termo</strong> se usa el <em>Total Packs</em> (paquetes totales).</li>
            <li>El % de desperdicio de insumos se calcula como: <code className="bg-blue-100 px-1 rounded">Desperdicio / Producción</code>.</li>
          </ul>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <h4 className="text-sm font-bold text-gray-800 mb-2">Tabla de Referencia</h4>
          <div className="grid grid-cols-4 gap-2 text-[10px] text-gray-600">
            <div className="font-bold">Calibre</div>
            <div className="font-bold">g Etiq</div>
            <div className="font-bold">g Tapa</div>
            <div className="font-bold">k Termo</div>
            {wasteData.filteredSizes.map(s => (
              <div key={s} className="contents">
                <div>{s}</div>
                <div>{config?.wasteWeights?.[s.toString()]?.etiq || '-'}</div>
                <div>{config?.wasteWeights?.[s.toString()]?.tapa || '-'}</div>
                <div>{config?.wasteWeights?.[s.toString()]?.termo || '-'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
        </>
      ) : activeTab === 'co2' ? (
        <div className="space-y-6">
          {/* CO2 Detailed Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Detalle de Desperdicio CO2</h3>
              <p className="text-xs text-gray-500 mt-1">Cruce de CO2 Teórico (Producción) vs CO2 Real (Elaboración)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Fecha</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Turno</th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200">CO2 Teórico (kg)</th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200">CO2 Real (kg)</th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Desperdicio (kg)</th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase">% Desperdicio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 text-sm">
                  {co2Data.details.length > 0 ? (
                    co2Data.details.map((d, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-6 py-3 border-r border-gray-200">{format(parseISO(d.fecha), 'dd/MM/yyyy')}</td>
                        <td className="px-6 py-3 border-r border-gray-200 font-medium">{d.turno}</td>
                        <td className="px-6 py-3 text-center border-r border-gray-200">{d.teorico.toLocaleString('es-AR')}</td>
                        <td className="px-6 py-3 text-center border-r border-gray-200">{d.real.toLocaleString('es-AR')}</td>
                        <td className={`px-6 py-3 text-center border-r border-gray-200 font-bold ${d.desperdicio > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                          {d.desperdicio.toLocaleString('es-AR')}
                        </td>
                        <td className={`px-6 py-3 text-center font-bold ${d.porcentaje > 5 ? 'text-red-600 bg-red-50/20' : 'text-gray-700'}`}>
                          {d.porcentaje.toFixed(2)}%
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        No hay datos de CO2 para el periodo seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
                {co2Data.details.length > 0 && (
                  <tfoot className="bg-gray-100 font-bold">
                    <tr>
                      <td colSpan={2} className="px-6 py-3 text-sm text-gray-900 border-r border-gray-200 text-right">TOTALES</td>
                      <td className="px-6 py-3 text-center border-r border-gray-200">{co2Data.totalTeorico.toLocaleString('es-AR')}</td>
                      <td className="px-6 py-3 text-center border-r border-gray-200">{co2Data.totalReal.toLocaleString('es-AR')}</td>
                      <td className="px-6 py-3 text-center border-r border-gray-200 text-orange-800">{co2Data.totalDesperdicio.toLocaleString('es-AR')}</td>
                      <td className="px-6 py-3 text-center text-red-800">{co2Data.totalPorcentaje.toFixed(2)}%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'jarabe' ? (
        <div className="space-y-6">
          {/* Jarabe Detailed Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Detalle de Desperdicio Jarabe</h3>
              <p className="text-xs text-gray-500 mt-1">Cruce de Jarabe Teórico (Producción) vs Jarabe Real (Elaboración)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Fecha</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Turno</th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Jarabe Teórico (L)</th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Jarabe Real (L)</th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase border-r border-gray-200">Desperdicio (L)</th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase">% Desperdicio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 text-sm">
                  {jarabeData.details.length > 0 ? (
                    jarabeData.details.map((d, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-6 py-3 border-r border-gray-200">{format(parseISO(d.fecha), 'dd/MM/yyyy')}</td>
                        <td className="px-6 py-3 border-r border-gray-200 font-medium">{d.turno}</td>
                        <td className="px-6 py-3 text-center border-r border-gray-200">{d.teorico.toLocaleString('es-AR')}</td>
                        <td className="px-6 py-3 text-center border-r border-gray-200">{d.real.toLocaleString('es-AR')}</td>
                        <td className={`px-6 py-3 text-center border-r border-gray-200 font-bold ${d.desperdicio > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                          {d.desperdicio.toLocaleString('es-AR')}
                        </td>
                        <td className={`px-6 py-3 text-center font-bold ${d.porcentaje > 5 ? 'text-red-600 bg-red-50/20' : 'text-gray-700'}`}>
                          {d.porcentaje.toFixed(2)}%
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        No hay datos de Jarabe para el periodo seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
                {jarabeData.details.length > 0 && (
                  <tfoot className="bg-gray-100 font-bold">
                    <tr>
                      <td colSpan={2} className="px-6 py-3 text-sm text-gray-900 border-r border-gray-200 text-right">TOTALES</td>
                      <td className="px-6 py-3 text-center border-r border-gray-200">{jarabeData.totalTeorico.toLocaleString('es-AR')}</td>
                      <td className="px-6 py-3 text-center border-r border-gray-200">{jarabeData.totalReal.toLocaleString('es-AR')}</td>
                      <td className="px-6 py-3 text-center border-r border-gray-200 text-orange-800">{jarabeData.totalDesperdicio.toLocaleString('es-AR')}</td>
                      <td className="px-6 py-3 text-center text-red-800">{jarabeData.totalPorcentaje.toFixed(2)}%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'resumen' ? (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Resumen de Desperdicios</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-2 py-2 text-left font-bold text-gray-600 border-r border-gray-200 sticky left-0 bg-gray-50 z-10" colSpan={2}>
                      Material
                    </th>
                    <th className="px-2 py-2 text-center font-bold text-blue-800 border-r border-gray-200 bg-blue-50 min-w-[100px]">
                      ACUMULADO MENSUAL
                    </th>
                    {resumenData.map(d => (
                      <th key={d.day} className="px-2 py-2 text-center font-bold text-gray-600 border-r border-gray-200 min-w-[60px]">
                        {d.day.toString().padStart(2, '0')}-{format(parseISO(`${selectedMonth}-01`), 'MMM', { locale: es })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {renderResumenRow('CO2', 'co2', 'Kg.')}
                  {renderResumenRow('JARABE', 'jarabe', 'Lt.')}
                  {renderResumenRow('PREFORMAS', 'preformas', 'Unid.')}
                  {renderResumenRow('TAPAS', 'tapas', 'Unid.')}
                  {renderResumenRow('CABEZA DE SIFON', 'sifon', 'Unid.')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
