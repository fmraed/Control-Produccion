import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { db } from '../firebase';
import { ProductionReport, ElaboracionReport } from '../types';
import { Calendar } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAppConfig } from '../hooks/useAppConfig';
import { WASTE_WEIGHTS, BOTELLAS_POR_PACK } from '../constants';
import { getLogicalDate } from '../utils';

export function HistoricalWasteReport() {
  const { config } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [elaboracionReports, setElaboracionReports] = useState<ElaboracionReport[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Default range: last 6 months
  const defaultEnd = new Date();
  const defaultStart = subMonths(defaultEnd, 5);
  
  const [startMonth, setStartMonth] = useState<string>(format(defaultStart, 'yyyy-MM'));
  const [endMonth, setEndMonth] = useState<string>(format(defaultEnd, 'yyyy-MM'));

  // Fetch data
  useEffect(() => {
    const startObj = parseISO(`${startMonth}-01`);
    const endObj = endOfMonth(parseISO(`${endMonth}-01`));
    
    // We add some buffer days for logical dates (night shifts etc)
    const startDate = new Date(startObj);
    startDate.setDate(startDate.getDate() - 2);
    const endDate = new Date(endObj);
    endDate.setDate(endDate.getDate() + 2);

    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    const qProd = query(
      collection(db, 'production_reports'), 
      where('fecha', '>=', startStr),
      where('fecha', '<=', endStr),
      orderBy('fecha', 'desc')
    );

    const qElab = query(
      collection(db, 'elaboracion_reports'), 
      where('fecha', '>=', startStr),
      where('fecha', '<=', endStr),
      orderBy('fecha', 'desc')
    );
    
    setLoading(true);

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
    });

    return () => {
      unsubProd();
      unsubElab();
    };
  }, [startMonth, endMonth]);

  // Aggregate data by month
  const monthlyData = useMemo(() => {
    const start = parseISO(`${startMonth}-01`);
    const end = parseISO(`${endMonth}-01`);
    
    // Generate list of months in range
    const monthsList: string[] = [];
    let current = start;
    while (current <= end) {
      monthsList.push(format(current, 'yyyy-MM'));
      current = addMonths(current, 1);
    }
    
    const result = monthsList.map(month => {
      // Filter reports for this month
      const monthProd = reports.filter(r => {
        const d = getLogicalDate(r);
        return d.startsWith(month);
      });
      const monthElab = elaboracionReports.filter(r => {
        const d = getLogicalDate(r);
        return d.startsWith(month);
      });

      // CO2
      const co2Teorico = monthProd.reduce((sum, r) => sum + (r.co2 || 0), 0);
      const co2Real = monthElab.reduce((sum, r) => sum + (r.co2Consumido || 0), 0);
      
      // Jarabe
      const jarabeTeorico = monthProd.reduce((sum, r) => sum + (r.jarabeConsumido || 0), 0);
      const jarabeReal = monthElab.reduce((sum, r) => sum + (r.jarabeConsumido || 0), 0);

      // Preformas
      const preformasTeorico = monthProd.reduce((sum, r) => sum + (r.botellas || 0), 0);
      const preformasDiferencia = monthProd.reduce((sum, r) => sum + (r.scrapSoplado || 0) + (r.scrapEtiquetado || 0) + (r.scrapLlenado || 0) + (r.scrapHorno || 0), 0);
      const preformasReal = preformasTeorico + preformasDiferencia;

      // Tapas
      let tapasTeorico = 0;
      let kgTapas = 0;
      const unitsNoSifonBySize: Record<number, number> = {};

      monthProd.forEach(r => {
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
      const sifonTeorico = monthProd.reduce((sum, r) => sum + (r.sabor === 'Soda Sifon' ? (r.botellas || 0) : 0), 0);
      const sifonDiferencia = monthProd.reduce((sum, r) => sum + (r.desperdicioSifones || 0), 0);
      const sifonReal = sifonTeorico + sifonDiferencia;
      
      // Etiquetas
      let etiqTeorico = 0;
      let kgEtiq = 0;
      const unitsEtiqBySize: Record<number, number> = {};

      monthProd.forEach(r => {
        if (r.sabor !== 'Soda Sifon') {
          etiqTeorico += (r.botellas || 0);
          const size = r.tamano || 0;
          unitsEtiqBySize[size] = (unitsEtiqBySize[size] || 0) + (r.botellas || 0);
        }
        kgEtiq += (r.desperdicioEtiquetas || 0);
      });
      
      let etiqDiferencia = 0;
      if (etiqTeorico > 0) {
        Object.entries(unitsEtiqBySize).forEach(([sizeStr, units]) => {
          const size = Number(sizeStr);
          const weight = config?.wasteWeights?.[size.toString()]?.etiq ?? WASTE_WEIGHTS[size]?.etiq ?? 0;
          if (weight > 0) {
            const proportion = units / etiqTeorico;
            const kgForSize = kgEtiq * proportion;
            etiqDiferencia += (kgForSize * 1000) / weight;
          }
        });
      }
      etiqDiferencia = Math.round(etiqDiferencia);
      const etiqReal = etiqTeorico + etiqDiferencia;

      // Termocontraible
      let termoTeorico = 0;
      let termoDiferencia = 0;

      monthProd.forEach(r => {
        const size = r.tamano || 0;
        const botellas = r.botellas || 0;
        if (botellas > 0 && r.sabor !== 'Soda Sifon') {
          const botellasPorPack = (config?.botellasPorPack ? (config.botellasPorPack[size] ?? config.botellasPorPack[size.toString()]) : null) || BOTELLAS_POR_PACK[size] || 6;
          const packs = botellas / botellasPorPack;
          const termoWeight = config?.wasteWeights?.[size.toString()]?.termo ?? WASTE_WEIGHTS[size]?.termo ?? 0;
          termoTeorico += packs * termoWeight;
        }
        termoDiferencia += (r.desperdicioTermo || 0);
      });
      const termoReal = termoTeorico + termoDiferencia;

      return {
        month,
        co2: { teorico: co2Teorico, real: co2Real, dif: co2Real - co2Teorico },
        jarabe: { teorico: jarabeTeorico, real: jarabeReal, dif: jarabeReal - jarabeTeorico },
        preformas: { teorico: preformasTeorico, real: preformasReal, dif: preformasDiferencia },
        tapas: { teorico: tapasTeorico, real: tapasReal, dif: tapasDiferencia },
        etiq: { teorico: etiqTeorico, real: etiqReal, dif: etiqDiferencia },
        sifon: { teorico: sifonTeorico, real: sifonReal, dif: sifonDiferencia },
        termo: { teorico: termoTeorico, real: termoReal, dif: termoDiferencia }
      };
    });
    
    return { monthsList, result };
  }, [reports, elaboracionReports, startMonth, endMonth, config]);

  type ResumenKey = 'co2' | 'jarabe' | 'preformas' | 'tapas' | 'etiq' | 'sifon' | 'termo';
  
  const renderResumenRow = (title: string, key: ResumenKey, unit: string) => {
    // Total calculation
    const totalTeorico = monthlyData.result.reduce((sum, d) => sum + (d[key].teorico || 0), 0);
    const totalDif = monthlyData.result.reduce((sum, d) => sum + (d[key].dif || 0), 0);
    const totalPct = totalTeorico > 0 ? (totalDif / totalTeorico) * 100 : 0;

    return (
      <tr className="hover:bg-gray-50 border-t border-gray-200">
        <td className="px-4 py-3 font-bold text-gray-900 border-r border-gray-200 sticky left-0 bg-white z-10 whitespace-nowrap">
          {title} <span className="text-xs text-gray-500 font-normal ml-1">[{unit}]</span>
        </td>
        
        {monthlyData.result.map(d => {
          const data = d[key];
          const pct = data.teorico > 0 ? (data.dif / data.teorico) * 100 : 0;
          return (
            <td key={d.month} className="px-0 py-0 border-r border-gray-200 min-w-[140px] align-top">
              <div className="grid grid-cols-2 h-full">
                <div className="px-2 py-3 text-center border-r border-gray-100 font-mono text-sm text-gray-700">
                  {data.dif > 0 ? data.dif.toLocaleString('es-AR') : '-'}
                </div>
                <div className={`px-2 py-3 text-center font-bold text-sm ${pct > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                  {data.teorico > 0 ? `${pct.toFixed(1)}%` : '-'}
                </div>
              </div>
            </td>
          );
        })}
        
        <td className="px-0 py-0 border-r border-gray-200 bg-blue-50/30 align-top">
          <div className="grid grid-cols-2 h-full">
            <div className="px-2 py-3 text-center border-r border-blue-100 font-bold font-mono text-blue-900 text-sm">
              {totalDif > 0 ? totalDif.toLocaleString('es-AR') : '-'}
            </div>
            <div className="px-2 py-3 text-center font-bold text-blue-800 text-sm">
              {totalTeorico > 0 ? `${totalPct.toFixed(1)}%` : '-'}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Resumen Histórico de Desperdicios</h2>
          <p className="text-sm text-gray-500 mt-1">Comparativa mensual de mermas y desperdicios</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input 
              type="month" 
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className="bg-transparent border-none text-sm font-medium focus:ring-0 p-0 text-gray-700"
            />
            <span className="text-gray-400 font-bold">a</span>
            <input 
              type="month" 
              value={endMonth}
              onChange={(e) => setEndMonth(e.target.value)}
              className="bg-transparent border-none text-sm font-medium focus:ring-0 p-0 text-gray-700"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-200">
                  <th className="px-4 py-4 text-left font-bold text-gray-700 border-r border-gray-200 sticky left-0 bg-gray-100 z-20 min-w-[180px]">
                    Material
                  </th>
                  {monthlyData.monthsList.map(month => (
                    <th key={month} className="px-0 py-0 border-r border-gray-200">
                      <div className="border-b border-gray-200 px-4 py-2 text-center font-bold text-gray-700 bg-gray-50">
                        {format(parseISO(`${month}-01`), 'MMMM yyyy', { locale: es }).toUpperCase()}
                      </div>
                      <div className="grid grid-cols-2 text-xs uppercase tracking-wider text-gray-500 bg-white">
                        <div className="px-2 py-2 text-center border-r border-gray-100 font-medium">Volumen</div>
                        <div className="px-2 py-2 text-center font-medium">% Prod</div>
                      </div>
                    </th>
                  ))}
                  <th className="px-0 py-0 border-r border-gray-200 bg-blue-50/50">
                    <div className="border-b border-blue-100 px-4 py-2 text-center font-bold text-blue-900 bg-blue-100/50">
                      TOTAL ACUMULADO
                    </div>
                    <div className="grid grid-cols-2 text-xs uppercase tracking-wider text-blue-700 bg-blue-50/30">
                      <div className="px-2 py-2 text-center border-r border-blue-100 font-medium">Volumen</div>
                      <div className="px-2 py-2 text-center font-medium">% Prod</div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {renderResumenRow('PREFORMAS', 'preformas', 'Unid.')}
                {renderResumenRow('TAPAS', 'tapas', 'Unid.')}
                {renderResumenRow('ETIQUETAS', 'etiq', 'Unid.')}
                {renderResumenRow('CABEZA SIFON', 'sifon', 'Unid.')}
                {renderResumenRow('TERMOCONTRAIBLE', 'termo', 'Kg')}
                {renderResumenRow('CO2', 'co2', 'Kg')}
                {renderResumenRow('JARABE', 'jarabe', 'Lts')}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
