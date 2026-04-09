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
  const [firestoreTotals, setFirestoreTotals] = useState<Record<string, number>>({});
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
        q = query(
          reportsRef, 
          where('fecha', '==', date),
          where('linea', '==', line.replace('LINEA ', ''))
        );
      }
      
      const querySnapshot = await getDocs(q);
      const totals: Record<string, number> = {};
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const key = `${data.sabor}-${data.tamano}`;
        const sqlCode = sqlMappings[key];
        if (sqlCode) {
          totals[sqlCode] = (totals[sqlCode] || 0) + (data.totalBotellas || 0);
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
              <option value="LINEA 1">Línea 1</option>
              <option value="LINEA 2">Línea 2</option>
              <option value="LINEA 3">Línea 3</option>
              <option value="LINEA 4">Línea 4</option>
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
                  
                  // Convertir packs de SQL a botellas para comparar
                  const size = getProductSizeFromCode(sqlCode);
                  const bottlesPerPack = size ? (BOTELLAS_POR_PACK[size] || 6) : 6;
                  const sqlCantBottles = sqlPacks * bottlesPerPack;
                  
                  const appCantBottles = firestoreTotals[sqlCode] || 0;
                  const diff = appCantBottles - sqlCantBottles;
                  const hasError = Math.abs(diff) > 0;

                  return (
                    <tr key={i} className={hasError ? 'bg-red-50' : ''}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{row.nu_ordenProduccion}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{sqlCode}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{row.descripcion_articulo}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="font-bold text-blue-600">{sqlCantBottles.toLocaleString()} bot.</div>
                        <div className="text-xs text-gray-500">({sqlPacks.toLocaleString()} packs)</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-purple-600">
                        {appCantBottles.toLocaleString()} bot.
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap text-sm font-bold ${diff === 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {diff === 0 ? (
                          <span className="flex items-center gap-1 text-green-600 font-medium">
                            <CheckCircle2 className="w-4 h-4" /> Coincide
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600 font-medium">
                            <AlertTriangle className="w-4 h-4" /> Desvío
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
