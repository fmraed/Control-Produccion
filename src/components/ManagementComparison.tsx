import { useState, useMemo, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppConfig } from '../hooks/useAppConfig';
import { ArrowUp, ArrowDown, Activity, Droplets, Target, Wind, Factory } from 'lucide-react';
import { ProductionReport, ElaboracionReport } from '../types';

interface MetricComparison {
  label: string;
  previous: number;
  current: number;
  unit: string;
  format?: 'number' | 'percent' | 'float';
  inverse?: boolean; // If true, lower is better
  hideDiff?: boolean;
}

export function ManagementComparison() {
  const { config, shouldShowReport } = useAppConfig();
  const [reports, setReports] = useState<ProductionReport[]>([]);
  const [elaboraciones, setElaboraciones] = useState<ElaboracionReport[]>([]);
  const [loading, setLoading] = useState(true);

  const [previousStartDate, setPreviousStartDate] = useState<string>('');
  const [currentEndDate, setCurrentEndDate] = useState<string>('');

  // Acceso a la fecha de cambio de gestión
  const managementStartDate = config?.managementSettings?.managementStartDate || null;

  useEffect(() => {
    const q1 = query(collection(db, 'production_reports'), orderBy('fecha', 'desc'));
    const q2 = query(collection(db, 'elaboracion_reports'), orderBy('fecha', 'desc'));
    
    let loaded1 = false;
    let loaded2 = false;

    const unsub1 = onSnapshot(q1, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ProductionReport[];
      setReports(data);
      loaded1 = true;
      if (loaded1 && loaded2) setLoading(false);
    });

    const unsub2 = onSnapshot(q2, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ElaboracionReport[];
      setElaboraciones(data);
      loaded2 = true;
      if (loaded1 && loaded2) setLoading(false);
    });

    return () => { unsub1(); unsub2(); };
  }, []);

  const { previousReports, currentReports, previousElab, currentElab } = useMemo(() => {
    if (!managementStartDate) return { previousReports: [], currentReports: [], previousElab: [], currentElab: [] };

    const validReports = reports.filter(r => shouldShowReport(r, true));
    
    return {
      previousReports: validReports.filter(r => r.fecha < managementStartDate && (!previousStartDate || r.fecha >= previousStartDate)),
      currentReports: validReports.filter(r => r.fecha >= managementStartDate && (!currentEndDate || r.fecha <= currentEndDate)),
      previousElab: elaboraciones.filter(r => r.fecha < managementStartDate && (!previousStartDate || r.fecha >= previousStartDate)),
      currentElab: elaboraciones.filter(r => r.fecha >= managementStartDate && (!currentEndDate || r.fecha <= currentEndDate))
    };
  }, [reports, elaboraciones, managementStartDate, previousStartDate, currentEndDate, shouldShowReport]);

  const calculateMetrics = (datasetRaw: ProductionReport[], elabDataset: ElaboracionReport[]) => {
    if (datasetRaw.length === 0) return null;

    let packs = 0;
    let botellas = 0;
    
    // Efficiency
    let totalBruta = 0;
    let totalNeta = 0;
    let totalParadasMec = 0;
    
    // Line/Calibre metrics
    const typeMetrics: Record<string, { count: number; effAcum: number }> = {};
    
    // Waste
    let desperdicioTapas = 0;
    
    // CO2 and Jarabe logic
    let co2Real = 0;
    let co2Teorico = 0;
    let jarabeReal = 0;
    let jarabeTeorico = 0;

    datasetRaw.forEach(r => {
      packs += Number(r.paquetes) || 0;
      botellas += Number(r.botellas) || 0;

      const bruta = Number(r.tiempoTurno) || 0;
      const neta = (r.botellas && r.velocidad) ? (r.botellas / r.velocidad) : 0;
      
      let paradaMec = 0;
      if (r.downtimes) {
        r.downtimes.forEach(dt => {
          const mins = dt.totalMinutes || 0;
          if (dt.category === 'PARADAS DE LINEA' || dt.category === 'Paradas de Línea' || dt.category === 'Mecánica' || (dt.category === 'PARADAS LINEA')) {
            paradaMec += mins;
          }
        });
      }

      totalBruta += bruta;
      totalNeta += neta;
      totalParadasMec += paradaMec;
      desperdicioTapas += Number(r.desperdicioTapas) || 0;

      // Group EFF by Line-Calibre
      if (r.linea && r.tamano) {
        const key = `Línea ${r.linea} - ${r.tamano}ml`;
        const effOperativa = Math.min((bruta > 0 ? (neta / bruta) * 100 : 0), 100);
        
        if (!typeMetrics[key]) typeMetrics[key] = { count: 0, effAcum: 0 };
        typeMetrics[key].count += 1;
        typeMetrics[key].effAcum += effOperativa;
      }

      // CO2 Teorico: 7.2g per liter approx (very simplified)
      const liters = (r.botellas || 0) * ((Number(r.tamano) || 0) / 1000);
      co2Teorico += liters > 0 ? liters * 0.0075 : 0; // kg CO2 Teorico approx
      
      // Jarabe Teorico
      if (config?.saboresSinJarabe && r.sabor && !config.saboresSinJarabe.includes(r.sabor)) {
        jarabeTeorico += liters / 6; // approx 1 part syrup, 5 parts water = 1/6 yield
      } // Not exactly perfect but gives a proportional theoretical baseline
    });

    elabDataset.forEach(e => {
      // Sum real consumption
      co2Real += Number(e.co2Consumido) || 0;
      jarabeReal += Number(e.jarabeConsumido) || 0;
    });

    const shiftCount = datasetRaw.length;
    
    const efOperativa = totalBruta > 0 ? (totalNeta / totalBruta) * 100 : 0;
    const efMecanica = totalBruta > 0 ? ((totalBruta - totalParadasMec) / totalBruta) * 100 : 0;
    
    const lineEfficiencies = Object.entries(typeMetrics)
      .map(([key, val]) => ({ key, eff: val.effAcum / val.count }))
      .sort((a, b) => b.eff - a.eff)
      .slice(0, 5); // top 5 lines/sizes

    return {
      packsPerShift: shiftCount > 0 ? packs / shiftCount : 0,
      totalPacks: packs,
      totalBotellas: botellas,
      efOperativa,
      efMecanica,
      lineEfficiencies,
      desperdicioTapas,
      scarcityCO2: co2Teorico > 0 && co2Real > 0 ? ((co2Real - co2Teorico) / co2Teorico) * 100 : 0,
      scarcityJarabe: jarabeTeorico > 0 && jarabeReal > 0 ? ((jarabeReal - jarabeTeorico) / jarabeTeorico) * 100 : 0,
      shiftCount
    };
  };

  const currentStats = useMemo(() => calculateMetrics(currentReports, currentElab), [currentReports, currentElab]);
  const previousStats = useMemo(() => calculateMetrics(previousReports, previousElab), [previousReports, previousElab]);

  if (!managementStartDate) {
    return (
      <div className="p-8 text-center bg-white rounded-xl border border-gray-200">
        <Target className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-700 mb-2">Comparación de Gestión no configurada</h2>
        <p className="text-gray-500 mb-6 max-w-md mx-auto">
          Para ver esta comparación, debes definir la "Fecha de Inicio de Gestión Actual" en el Panel de Configuración {' > '} Corte de Gestión.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Cargando datos...</div>;
  }

  const formatValue = (val: number, format: 'number' | 'percent' | 'float') => {
    if (format === 'percent') return `${val.toFixed(1)}%`;
    if (format === 'float') return val.toFixed(2);
    return Math.round(val).toLocaleString('es-AR');
  };

  const MetricRow = ({ comparison, highlight }: { comparison: MetricComparison, highlight?: boolean, key?: string | number }) => {
    const { label, previous, current, unit, format = 'number', inverse, hideDiff } = comparison;
    
    const diff = current - previous;
    const percentDiff = previous !== 0 ? (diff / Math.abs(previous)) * 100 : 0;
    
    let colorClass = 'text-gray-500';
    let bgClass = 'bg-gray-100';
    let Icon = ArrowUp; // Placeholder
    
    if (diff !== 0) {
      const isPositiveChange = diff > 0;
      const isGood = inverse ? !isPositiveChange : isPositiveChange;
      colorClass = isGood ? 'text-green-600' : 'text-red-600';
      bgClass = isGood ? 'bg-green-100' : 'bg-red-100';
      Icon = isPositiveChange ? ArrowUp : ArrowDown;
    }

    return (
      <div className={`grid grid-cols-4 items-center p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors last:border-0 ${highlight ? 'bg-blue-50/20' : ''}`}>
        <div className="col-span-1 text-sm font-semibold text-gray-700">
          {label}
        </div>
        <div className="text-center font-medium text-gray-600">
          {formatValue(previous, format)} <span className="text-[10px] text-gray-400 font-normal">{unit}</span>
        </div>
        <div className="text-center font-bold text-blue-900 bg-blue-50/50 py-2 rounded-lg border border-blue-50">
          {formatValue(current, format)} <span className="text-[10px] text-blue-400 font-normal">{unit}</span>
        </div>
        <div className="flex flex-col items-center justify-center">
          {hideDiff ? (
            <span className="text-gray-400 text-xs">-</span>
          ) : previous !== 0 && current !== 0 ? (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${bgClass} ${colorClass} font-bold text-sm shadow-sm`}>
              <Icon className="w-4 h-4" />
              {Math.abs(percentDiff).toFixed(1)}%
            </div>
          ) : (
            <span className="text-gray-400 text-xs">-</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Comparativa de Gestión</h1>
          <p className="text-sm text-gray-500">Gestión Anterior vs Gestión Actual configurada en {managementStartDate.split('-').reverse().join('/')}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-4 bg-gray-50 border-b border-gray-200 p-4">
          <div className="text-left font-black text-gray-500 text-xs uppercase tracking-widest pl-2">Métrica de Performance</div>
          <div className="text-center font-black text-gray-500 text-xs uppercase tracking-widest flex flex-col items-center justify-center">
            Gestión Anterior<br/>
            <span className="font-normal text-[10px] text-gray-400 mb-1">({previousStats?.shiftCount || 0} turnos)</span>
            <input
              type="date"
              value={previousStartDate}
              onChange={(e) => setPreviousStartDate(e.target.value)}
              max={managementStartDate}
              className="mt-1 text-xs px-2 py-1 border border-gray-300 rounded font-normal bg-white"
              title="Desde esta fecha"
            />
          </div>
          <div className="text-center font-black text-blue-600 text-xs uppercase tracking-widest flex flex-col items-center justify-center">
            Gestión Actual<br/>
            <span className="font-normal text-[10px] text-blue-400 mb-1">({currentStats?.shiftCount || 0} turnos)</span>
            <input
              type="date"
              value={currentEndDate}
              onChange={(e) => setCurrentEndDate(e.target.value)}
              min={managementStartDate}
              className="mt-1 text-xs px-2 py-1 border border-blue-200 rounded font-normal bg-blue-50 text-blue-800"
              title="Hasta esta fecha"
            />
          </div>
          <div className="text-center font-black text-gray-500 text-xs uppercase tracking-widest">Diferencia Relativa</div>
        </div>

        {/* Content */}
        {currentStats && previousStats ? (
          <div>
            <div className="bg-slate-100 py-2 px-4 text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-4 h-4" /> Producción General
            </div>
            <MetricRow comparison={{ label: "Packs Totales Producidos", previous: previousStats.totalPacks, current: currentStats.totalPacks, unit: "packs", hideDiff: true }} />
            <MetricRow comparison={{ label: "Productividad Promedio", previous: previousStats.packsPerShift, current: currentStats.packsPerShift, unit: "packs/turno", format: "float" }} />

            <div className="bg-slate-100 py-2 px-4 text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mt-4 border-t border-slate-200">
              <Target className="w-4 h-4" /> Desempeño y Eficiencia Principal
            </div>
            <MetricRow comparison={{ label: "Eficiencia Operativa (OEE)", previous: previousStats.efOperativa, current: currentStats.efOperativa, unit: "%", format: "percent" }} />
            <MetricRow comparison={{ label: "Eficiencia Mecánica", previous: previousStats.efMecanica, current: currentStats.efMecanica, unit: "%", format: "percent" }} />

            <div className="bg-slate-100 py-2 px-4 text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mt-4 border-t border-slate-200">
              <Droplets className="w-4 h-4" /> Mermas y Desperdicios Clave (Insumos)
            </div>
            <MetricRow comparison={{ label: "Desviación Jarabe (Real vs Teórico)", previous: previousStats.scarcityJarabe, current: currentStats.scarcityJarabe, unit: "%", format: "percent", inverse: true }} highlight={true} />
            <MetricRow comparison={{ label: "Desviación CO2", previous: previousStats.scarcityCO2, current: currentStats.scarcityCO2, unit: "%", format: "percent", inverse: true }} />

            <div className="bg-slate-100 py-2 px-4 text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mt-4 border-t border-slate-200">
              <Factory className="w-4 h-4" /> Desglose: Eficiencia Operativa por Tipo (Línea + Calibre)
            </div>
            {currentStats.lineEfficiencies.map((eff, i) => {
              const previousEff = previousStats.lineEfficiencies.find(e => e.key === eff.key);
              return (
                <MetricRow key={eff.key} comparison={{ 
                  label: eff.key, 
                  previous: previousEff?.eff || 0, 
                  current: eff.eff, 
                  unit: "%", 
                  format: "percent" 
                }} />
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">No hay suficientes datos procesados.</div>
        )}
      </div>
    </div>
  );
}

