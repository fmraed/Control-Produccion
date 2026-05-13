import { useState, useEffect } from 'react';
import { Database, RefreshCw, AlertCircle, CheckCircle2, Search, AlertTriangle } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { collection, query, where, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { SQL_PRODUCT_MAPPING, BOTELLAS_POR_PACK } from '../constants';
import { getLogicalDate } from '../utils';

export function SQLIntegration() {
  const [loading, setLoading] = useState(false);
  const [productType, setProductType] = useState<'products' | 'syrups'>('products');
  const [periodType, setPeriodType] = useState<'daily' | 'monthly'>('daily');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [line, setLine] = useState('TODAS');
  const [shift, setShift] = useState('TODOS');
  const [results, setResults] = useState<any[] | null>(null);
  const [firestoreTotals, setFirestoreTotals] = useState<Record<string, { packs: number, bottles: number }>>({});
  const [sqlMappings, setSqlMappings] = useState<Record<string, string>>(SQL_PRODUCT_MAPPING);
  const [sqlSyrupMappings, setSqlSyrupMappings] = useState<Record<string, string>>({});
  const [syrupInitials, setSyrupInitials] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchMappings = async () => {
    try {
      const mappingRef = doc(db, 'config', 'sql_mappings');
      const syrupMappingRef = doc(db, 'config', 'sql_syrup_mappings');
      let initialsRef = null;
      if (productType === 'syrups' && periodType === 'monthly') {
        initialsRef = doc(db, 'config', `syrup_initials_${month}`);
      }
      
      const docPromises = [getDoc(mappingRef), getDoc(syrupMappingRef)];
      if (initialsRef) docPromises.push(getDoc(initialsRef));

      const [docSnap, syrupSnap, initialsSnap] = await Promise.all(docPromises);
      
      if (docSnap.exists()) {
        setSqlMappings(docSnap.data() as Record<string, string>);
      }
      if (syrupSnap.exists()) {
        setSqlSyrupMappings(syrupSnap.data() as Record<string, string>);
      }
      if (initialsSnap && initialsSnap.exists()) {
        setSyrupInitials(initialsSnap.data() as Record<string, number>);
      } else {
        setSyrupInitials({});
      }
    } catch (err) {
      console.error("Error fetching mappings:", err);
    }
  };

  const fetchFirestoreData = async () => {
    try {
      await fetchMappings();
      const collectionName = productType === 'products' ? 'production_reports' : 'elaboracion_reports';
      const reportsRef = collection(db, collectionName);
      let allDocs: any[] = [];
      
      if (periodType === 'monthly') {
        // Query un poco más amplio (hasta el día 2 del mes siguiente) para asegurar 
        // traer los partes del último día del mes cursados a la madrugada
        const startOfMonth = `${month}-01`;
        const nextMonthObj = new Date(`${month}-01T12:00:00Z`);
        nextMonthObj.setUTCMonth(nextMonthObj.getUTCMonth() + 1);
        const nextMonthStr = nextMonthObj.toISOString().split('T')[0].substring(0, 7);
        const endDateInclusive = `${nextMonthStr}-02`;

        const qMonth = query(
          reportsRef, 
          where('fecha', '>=', startOfMonth),
          where('fecha', '<=', endDateInclusive)
        );
        const snap = await getDocs(qMonth);
        allDocs = snap.docs;
      } else {
        const nextDay = format(addDays(new Date(date + 'T12:00:00'), 1), 'yyyy-MM-dd');
        const qCurrent = query(reportsRef, where('fecha', '==', date));
        const qNext = query(reportsRef, where('fecha', '==', nextDay));
        const [snapCurrent, snapNext] = await Promise.all([
          getDocs(qCurrent),
          getDocs(qNext)
        ]);
        allDocs = [...snapCurrent.docs, ...snapNext.docs];
      }

      // Combinar resultados y filtrar por fecha lógica y línea/turno
      const totals: Record<string, { packs: number, bottles: number }> = {};
      
      const lineNum = line !== 'TODAS' ? line.match(/\d+/)?.[0] : null;

      allDocs.forEach((doc) => {
        const data = doc.data() as any;
        const logicalDate = getLogicalDate(data);
        
        if (periodType === 'daily') {
          // Filtrar por fecha lógica
          if (logicalDate !== date) return;
          // Filtrar por turno si no es TODOS
          if (shift !== 'TODOS') {
            if (data.turno !== shift) return;
          }
        } else {
          // Para visualización mensual, validamos que pertenezca al mes
          if (!logicalDate.startsWith(month)) return;
        }

        // Filtrar por línea si no es TODAS
        if (line !== 'TODAS') {
          const reportLine = data.linea;
          if (reportLine !== (lineNum || line)) return;
        }

        // Filtrar por turno si no es TODOS
        if (periodType === 'daily' && shift !== 'TODOS') {
          if (data.turno !== shift) return;
        }

        if (productType === 'products') {
          // Increase granularity to Marca-Sabor-Tamano as requested
          const key = `${data.marca}-${data.sabor}-${data.tamano}`;
          const sqlCode = sqlMappings[key];
          if (sqlCode) {
            if (!totals[sqlCode]) {
              totals[sqlCode] = { packs: 0, bottles: 0 };
            }
            totals[sqlCode].packs += Number(data.paquetes) || 0;
            totals[sqlCode].bottles += Number(data.botellas) || 0;
          }
        } else {
          // Both `marca` and `sabor` should exist for this to work correctly
          if (!data.marca || !data.sabor) return;
          const key = `${data.marca}-${data.sabor}`;
          const sqlCode = sqlSyrupMappings[key];
          if (sqlCode) {
            if (!totals[sqlCode]) {
              totals[sqlCode] = { packs: 0, bottles: 0 };
            }
            // For syrups, we store liters in the "packs" property to reuse table rendering
            totals[sqlCode].packs += Number(data.jarabeConsumido) || 0;
          }
        }
      });
      
      setFirestoreTotals(totals);
    } catch (err) {
      console.error("Error fetching firestore data:", err);
    }
  };

  const getProductSizeFromCode = (code: string) => {
    const entry = Object.entries(sqlMappings).find(([_, val]) => val === code);
    if (!entry) return null;
    const [key] = entry;
    const size = parseInt(key.split('-')[1]);
    return size;
  };

  const handleUpdateInitial = async (sqlCode: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    const newInitials = { ...syrupInitials, [sqlCode]: numValue };
    setSyrupInitials(newInitials);
    
    // Throttle to avoid too many writes if typing fast? Or simply save directly on blur/change.
    // Actually, saving on change is fine for small apps, but let's just do it directly.
    try {
      await setDoc(doc(db, 'config', `syrup_initials_${month}`), { [sqlCode]: numValue }, { merge: true });
    } catch(e) {
      console.error('Error saving initial stock', e);
    }
  };

  const handleCheck = async () => {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      await fetchFirestoreData();
      const response = await fetch('/api/sql/check-production', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ date, line, shift, periodType, month, productType }),
      });

      const data = await response.json();

      if (!response.ok) {
        const detailMsg = data.details ? `: ${data.details}` : '';
        throw new Error(`${data.error}${detailMsg}`);
      }

      setResults(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Database className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-bold text-gray-900">Cruce con SQL Server</h2>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          Esta herramienta permite consultar la base de datos central (SQL Server) para verificar que los partes cargados en esta aplicación coincidan con los registros oficiales.
        </p>

        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => { setProductType('products'); setResults(null); }}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              productType === 'products' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Productos Terminados
          </button>
          <button
            onClick={() => { setProductType('syrups'); setResults(null); setPeriodType('monthly'); }}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              productType === 'syrups' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Jarabes
          </button>
        </div>

        <div className="flex gap-4 mb-6">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input 
              type="radio" 
              name="periodType" 
              value="daily" 
              checked={periodType === 'daily'} 
              onChange={() => { setPeriodType('daily'); setResults(null); }} 
              className="text-blue-600 focus:ring-blue-500"
            />
            <span className="font-medium text-gray-700">Por Día Operativo</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input 
              type="radio" 
              name="periodType" 
              value="monthly" 
              checked={periodType === 'monthly'} 
              onChange={() => { setPeriodType('monthly'); setResults(null); }} 
              className="text-blue-600 focus:ring-blue-500"
            />
            <span className="font-medium text-gray-700">Por Mes</span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{periodType === 'monthly' ? 'Mes a Consultar' : 'Fecha a Consultar'}</label>
            {periodType === 'monthly' ? (
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2"
              />
            ) : (
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Línea</label>
            <select
              value={line}
              onChange={(e) => setLine(e.target.value)}
              disabled={periodType === 'monthly' && productType === 'syrups'}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="TODAS">Todas las Líneas</option>
              <option value="LINEA TUCUMAN 1">Línea Tucumán 1</option>
              <option value="LINEA TUCUMAN 2">Línea Tucumán 2</option>
              <option value="LINEA TUCUMAN 3">Línea Tucumán 3</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Turno</label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              disabled={periodType === 'monthly'}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="TODOS">Día Completo (06-06)</option>
              <option value="Mañana">Mañana (06-14)</option>
              <option value="Tarde">Tarde (14-22)</option>
              <option value="Noche">Noche (22-06)</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleCheck}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg font-medium transition-colors h-[42px]"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Consultar SQL Server
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-bold">Error de Conexión</p>
              <p className="text-sm">{error}</p>
              <p className="text-xs mt-2 opacity-75">
                <strong>Tips de conexión:</strong><br/>
                • Verifique que el servidor permita conexiones externas.<br/>
                • Si usa una instancia con nombre, use el formato: <code>servidor\\instancia</code>.<br/>
                • Asegúrese de que el puerto 1433 esté abierto en su firewall.
              </p>
            </div>
          </div>
        )}

        {results && results.length === 0 && (
          <div className="p-8 text-center border-2 border-dashed border-gray-200 rounded-xl">
            <Database className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No se encontraron registros en SQL Server para esta fecha y línea.</p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Orden</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Código</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Artículo</th>
                  {productType === 'syrups' && periodType === 'monthly' && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock Inicial</th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cant. SQL</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cant. App</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Diferencia</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {(() => {
                  // Agrupar resultados de SQL para comparar totales
                  const groupedSql: Record<string, any> = {};
                  const activeMappingVals = productType === 'products' ? Object.values(sqlMappings) : Object.values(sqlSyrupMappings);

                  results.forEach(row => {
                    const code = row.codigo_abreviado;
                    // Only process rows that correspond to our current mapping
                    if (!activeMappingVals.includes(code)) return;
                    
                    const groupKey = code;
                    const displayDesc = row.descripcion_articulo;
                    
                    if (!groupedSql[groupKey]) {
                      groupedSql[groupKey] = {
                        ...row,
                        codigo_abreviado: groupKey,
                        descripcion_articulo: displayDesc,
                        nu_cantFabri: 0,
                        ordenes: [],
                      };
                    }
                    groupedSql[groupKey].nu_cantFabri += row.nu_cantFabri || 0;
                    groupedSql[groupKey].ordenes.push(row.nu_ordenProduccion);
                  });

                  return Object.values(groupedSql).map((row: any, i) => {
                    const sqlPacks = row.nu_cantFabri || 0;
                    
                    let initialValue = 0;
                    if (productType === 'syrups' && periodType === 'monthly') {
                      initialValue = typeof syrupInitials[row.codigo_abreviado] === 'number' ? syrupInitials[row.codigo_abreviado] : 0;
                    }
                    
                    let appPacks = 0;
                    let appBottles = 0;

                    const appData = firestoreTotals[row.codigo_abreviado] || { packs: 0, bottles: 0 };
                    appPacks = appData.packs;
                    appBottles = appData.bottles;

                    // Para productos terminados: Diferencia = Producción App - Producción SQL
                    // Para jarabes mensuales: Stock Final Teórico = Inicial + Producción SQL - Consumo App
                    let diffPacks = 0;
                    if (productType === 'syrups' && periodType === 'monthly') {
                      diffPacks = initialValue + sqlPacks - appPacks;
                    } else {
                      diffPacks = appPacks - sqlPacks;
                    }
                    
                    const hasError = productType === 'syrups' && periodType === 'monthly' ? diffPacks < 0 : Math.abs(diffPacks) > 0;

                    return (
                      <tr key={i} className={`hover:bg-gray-50 transition-colors ${hasError ? 'bg-red-50/50' : ''}`}>
                        <td className="px-4 py-3 text-sm font-mono text-gray-600">
                          <div className="max-w-[150px] overflow-hidden text-ellipsis" title={row.ordenes.join(', ')}>
                            {row.ordenes.join(', ')}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-500">{row.codigo_abreviado}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">{row.descripcion_articulo}</td>
                        {productType === 'syrups' && periodType === 'monthly' && (
                          <td className="px-2 py-2 whitespace-nowrap">
                            <input 
                              type="number"
                              className="w-24 rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-2 py-1"
                              value={initialValue || ''}
                              placeholder="0"
                              onChange={(e) => handleUpdateInitial(row.codigo_abreviado, e.target.value)}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <div className="font-mono font-bold text-blue-700">{sqlPacks.toLocaleString()} {productType === 'products' ? 'packs' : 'L'}</div>
                          {productType === 'syrups' && periodType === 'monthly' ? <div className="text-[10px] text-gray-400 uppercase tracking-wider">Prod. Nueva Total</div> : <div className="text-[10px] text-gray-400 uppercase tracking-wider">SQL Server (Total)</div>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <div className="font-mono font-bold text-purple-700">{appPacks.toLocaleString()} {productType === 'products' ? 'packs' : 'L'}</div>
                          <div className="text-[10px] text-gray-400 uppercase tracking-wider">App ({productType === 'syrups' ? 'Consumo' : `Total ${periodType === 'monthly' ? 'Mes' : shift === 'TODOS' ? 'Día' : 'Turno'}`})</div>
                          {productType === 'products' && <div className="text-[10px] text-purple-400 italic mt-0.5">{appBottles.toLocaleString()} botellas</div>}
                        </td>
                        <td className={`px-4 py-3 whitespace-nowrap text-sm font-mono font-bold ${hasError ? 'text-red-600' : 'text-green-600'}`}>
                          {diffPacks > 0 ? '+' : ''}{diffPacks.toLocaleString()} {productType === 'products' ? 'packs' : 'L'}
                          {productType === 'syrups' && periodType === 'monthly' && <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5 font-normal">Stock Final Teórico</div>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          {hasError ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold uppercase tracking-tight">
                              <AlertTriangle className="w-3 h-3" /> {productType === 'syrups' && periodType === 'monthly' ? 'Deficit' : 'Desvío'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold uppercase tracking-tight">
                              <CheckCircle2 className="w-3 h-3" /> {productType === 'syrups' && periodType === 'monthly' ? 'OK (Sobrante)' : 'OK'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
        <h3 className="text-blue-800 font-bold mb-2 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5" />
          Instrucciones de Configuración
        </h3>
        <ul className="text-sm text-blue-700 space-y-2 list-disc ml-5">
          <li>Vaya al menú de <strong>Settings (Ajustes)</strong> en AI Studio.</li>
          <li>Agregue las siguientes variables de entorno:
            <code className="block bg-blue-100 p-2 mt-1 rounded font-mono text-xs">
              SQL_SERVER_SERVER=tu_servidor.com<br/>
              SQL_SERVER_USER=tu_usuario<br/>
              SQL_SERVER_PASSWORD=tu_password<br/>
              SQL_SERVER_DATABASE=nombre_db
            </code>
          </li>
          <li>Si su servidor SQL está en una red privada, deberá habilitar el acceso para la IP de salida de Cloud Run o usar un túnel.</li>
        </ul>
      </div>
    </div>
  );
}
