import { useState, useEffect } from 'react';
import { Database, RefreshCw, AlertCircle, CheckCircle2, Search, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { SQL_PRODUCT_MAPPING, BOTELLAS_POR_PACK } from '../constants';

export function SQLIntegration() {
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [line, setLine] = useState('TODAS');
  const [results, setResults] = useState<any[] | null>(null);
  const [firestoreTotals, setFirestoreTotals] = useState<Record<string, { packs: number, bottles: number }>>({});
  const [sqlMappings, setSqlMappings] = useState<Record<string, string>>(SQL_PRODUCT_MAPPING);
  const [error, setError] = useState<string | null>(null);

  const fetchMappings = async () => {
    try {
      const mappingRef = doc(db, 'config', 'sql_mappings');
      const docSnap = await getDoc(mappingRef);
      if (docSnap.exists()) {
        setSqlMappings(docSnap.data() as Record<string, string>);
      }
    } catch (err) {
      console.error("Error fetching mappings:", err);
    }
  };

  const fetchFirestoreData = async () => {
    try {
      await fetchMappings();
      const reportsRef = collection(db, 'production_reports');
      
      let q;
      if (line === 'TODAS') {
        q = query(reportsRef, where('fecha', '==', date));
      } else {
        // Extraer solo el número de la línea (ej: "1" de "LINEA TUCUMAN 1")
        const lineNum = line.match(/\d+/)?.[0];
        q = query(
          reportsRef, 
          where('fecha', '==', date),
          where('linea', '==', lineNum || line)
        );
      }
      
      const querySnapshot = await getDocs(q);
      const totals: Record<string, { packs: number, bottles: number }> = {};
      
      querySnapshot.forEach((doc) => {
        const data = doc.data() as any;
        const key = `${data.sabor}-${data.tamano}`;
        const sqlCode = sqlMappings[key];
        if (sqlCode) {
          if (!totals[sqlCode]) {
            totals[sqlCode] = { packs: 0, bottles: 0 };
          }
          totals[sqlCode].packs += Number(data.paquetes) || 0;
          totals[sqlCode].bottles += Number(data.botellas) || 0;
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
        body: JSON.stringify({ date, line }),
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha a Consultar</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Línea</label>
            <select
              value={line}
              onChange={(e) => setLine(e.target.value)}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2"
            >
              <option value="TODAS">Todas las Líneas</option>
              <option value="LINEA TUCUMAN 1">Línea Tucumán 1</option>
              <option value="LINEA TUCUMAN 2">Línea Tucumán 2</option>
              <option value="LINEA TUCUMAN 3">Línea Tucumán 3</option>
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cant. SQL</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cant. App</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Diferencia</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {results.map((row, i) => {
                  const sqlCode = row.codigo_abreviado;
                  const sqlPacks = row.nu_cantFabri || 0;
                  
                  const appData = firestoreTotals[sqlCode] || { packs: 0, bottles: 0 };
                  const appPacks = appData.packs;
                  const appBottles = appData.bottles;

                  const diffPacks = appPacks - sqlPacks;
                  const hasError = Math.abs(diffPacks) > 0;

                  return (
                    <tr key={i} className={`hover:bg-gray-50 transition-colors ${hasError ? 'bg-red-50/50' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-600">{row.nu_ordenProduccion}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-500">{sqlCode}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">{row.descripcion_articulo}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="font-mono font-bold text-blue-700">{sqlPacks.toLocaleString()} packs</div>
                        <div className="text-[10px] text-gray-400 uppercase tracking-wider">SQL Server</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="font-mono font-bold text-purple-700">{appPacks.toLocaleString()} packs</div>
                        <div className="text-[10px] text-gray-400 uppercase tracking-wider">App (Partes)</div>
                        <div className="text-[10px] text-purple-400 italic mt-0.5">{appBottles.toLocaleString()} botellas</div>
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap text-sm font-mono font-bold ${diffPacks === 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {diffPacks > 0 ? `+${diffPacks.toLocaleString()}` : diffPacks.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {diffPacks === 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold uppercase tracking-tight">
                            <CheckCircle2 className="w-3 h-3" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold uppercase tracking-tight">
                            <AlertTriangle className="w-3 h-3" /> Desvío
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
