import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import sql from "mssql";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // SQL Server Config
  const sqlConfig = {
    user: process.env.SQL_SERVER_USER,
    password: process.env.SQL_SERVER_PASSWORD,
    database: process.env.SQL_SERVER_DATABASE,
    server: process.env.SQL_SERVER_SERVER || 'localhost',
    port: parseInt(process.env.SQL_SERVER_PORT || '1433'),
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    },
    options: {
      encrypt: process.env.SQL_SERVER_ENCRYPT === 'true',
      trustServerCertificate: true // Change to false for production
    }
  };

  // API Route for SQL Cross-Check
  app.post("/api/sql/check-production", async (req, res) => {
    const { date, line, shift, periodType, month, productType } = req.body;

    if (periodType === 'monthly') {
      if (!month) {
        return res.status(400).json({ error: "El mes es requerido para consultas mensuales" });
      }
    } else {
      if (!date || !line) {
        return res.status(400).json({ error: "Fecha y Línea son requeridas" });
      }
    }

    if (!process.env.SQL_SERVER_SERVER || !process.env.SQL_SERVER_USER || !process.env.SQL_SERVER_PASSWORD) {
      const missing = [];
      if (!process.env.SQL_SERVER_SERVER) missing.push('SQL_SERVER_SERVER');
      if (!process.env.SQL_SERVER_USER) missing.push('SQL_SERVER_USER');
      if (!process.env.SQL_SERVER_PASSWORD) missing.push('SQL_SERVER_PASSWORD');
      if (!process.env.SQL_SERVER_DATABASE) missing.push('SQL_SERVER_DATABASE');
      
      return res.status(400).json({ 
        error: "Configuración incompleta", 
        details: `Faltan las siguientes variables de entorno: ${missing.join(', ')}. Configúrelas en el menú Settings de AI Studio.`
      });
    }

    try {
      let pool = await sql.connect(sqlConfig);
      
      let startDate: string;
      let endDate: string;

      if (periodType === 'monthly') {
        startDate = `${month}-01 06:00:00`;
        const nextMonthObj = new Date(`${month}-01T00:00:00Z`);
        nextMonthObj.setUTCMonth(nextMonthObj.getUTCMonth() + 1);
        const nextMonthFormated = nextMonthObj.toISOString().split('T')[0];
        endDate = `${nextMonthFormated} 06:00:00`;
      } else {
        const dateObj = new Date(date + 'T12:00:00');
        const isSaturday = dateObj.getDay() === 6;

        if (shift && shift !== 'TODOS') {
          // Lógica por turno específico
          if (shift === 'Mañana') {
            startDate = isSaturday ? `${date} 05:00:00` : `${date} 06:00:00`;
            endDate = `${date} 14:00:00`;
          } else if (shift === 'Tarde') {
            startDate = `${date} 14:00:00`;
            endDate = `${date} 22:00:00`;
          } else { // Noche
            startDate = `${date} 22:00:00`;
            const nextDayObj = new Date(dateObj);
            nextDayObj.setDate(nextDayObj.getDate() + 1);
            const nextDay = nextDayObj.toISOString().split('T')[0];
            // Sábado noche corta a las 05:00
            endDate = isSaturday ? `${nextDay} 05:00:00` : `${nextDay} 06:00:00`;
          }
        } else {
          // Día operativo completo (06:00 a 06:00, o 05:00 en sábados)
          startDate = isSaturday ? `${date} 05:00:00` : `${date} 06:00:00`;
          const nextDayObj = new Date(dateObj);
          nextDayObj.setDate(nextDayObj.getDate() + 1);
          const nextDay = nextDayObj.toISOString().split('T')[0];
          endDate = isSaturday ? `${nextDay} 05:00:00` : `${nextDay} 06:00:00`;
        }
      }

      const query = `
        SELECT 
            op.[nu_ordenProduccion],
            art.[co_codAbre] AS codigo_abreviado,
            art.[no_descripcion] AS descripcion_articulo,
            maq.[no_descripcion] AS linea,
            op.[fe_inicio],
            op.[fe_finReal],
            op.[nu_minutos],
            op.[nu_cantFabri]
        FROM [forDrink].[dbo].[pr_ordenProduccion] op
        LEFT JOIN [forDrink].[dbo].[fc_articulos] art
            ON op.[id_articulo] = art.[id_articulo] 
        LEFT JOIN [forDrink].[dbo].[pr_maquinarias] maq
            ON op.[id_equipo] = maq.[id_maquinaria]  
        WHERE op.[id_sucursal] = 2
            AND op.[id_estado] = 50
            ${productType === 'syrups' ? '' : 'AND art.[id_categoria] = 1'}
            AND (
                (op.[fe_inicio] >= @start AND op.[fe_inicio] < @end)
                OR 
                (op.[fe_finReal] > @start AND op.[fe_finReal] <= @end)
                OR
                (op.[fe_inicio] < @start AND op.[fe_finReal] > @end)
            )
            ${line === 'TODAS' || periodType === 'monthly' && productType === 'syrups' ? '' : 'AND maq.[no_descripcion] LIKE @lineFilter'}
      `;

      const request = pool.request()
        .input('start', sql.VarChar, startDate)
        .input('end', sql.VarChar, endDate);
      
      if (line !== 'TODAS' && !(periodType === 'monthly' && productType === 'syrups')) {
        request.input('lineFilter', sql.VarChar, `%${line}%`);
      }

      const result = await request.query(query);

      res.json({
        success: true,
        data: result.recordset,
        message: "Datos obtenidos de SQL Server correctamente."
      });
    } catch (err) {
      console.error("SQL Error:", err);
      res.status(500).json({ 
        error: "Error al conectar con SQL Server", 
        details: err instanceof Error ? err.message : String(err) 
      });
    }
  });

  // API Route for Stock Control
  app.post("/api/sql/stock", async (req, res) => {
    const { month } = req.body; // format 'yyyy-MM'

    if (!month) {
      return res.status(400).json({ error: "Mes es requerido" });
    }

    if (!process.env.SQL_SERVER_SERVER || !process.env.SQL_SERVER_USER || !process.env.SQL_SERVER_PASSWORD) {
      return res.status(400).json({ error: "Configuración SQL incompleta" });
    }

    try {
      let pool = await sql.connect(sqlConfig);
      
      const startOfMonthDate = `${month}-01 00:00:00`;
      
      // Simplified query using only the user-provided stock view
      const query = `
        SELECT 
            a.[co_codAbre] AS codigo,
            a.[no_descripcion] AS descripcion,
            s.[nu_actual] AS stock_actual,
            0 AS salida_acumulada,
            s.[nu_actual] AS stock_inicial
        FROM [forDrink].[dbo].[vw_articulos_stock_fason] s
        LEFT JOIN [forDrink].[dbo].[fc_articulos] a 
            ON s.id_articulo = a.id_articulo
        WHERE s.id_deposito = 27
          AND a.id_familia NOT IN (13, 17, 136, 137, 141, 142, 155, 244, 246)
      `;

      const pendingQuery = `
        SELECT 
            a.[co_codAbre] AS codigo,
            SUM(c.[nu_cantidadPendiente]) as cantidad_pendiente
        FROM [forDrink].[dbo].[pr_ca_control] c
        JOIN [forDrink].[dbo].[fc_articulos] a
            ON c.id_articulo = a.id_articulo
        WHERE c.id_sucursal = 2 AND c.id_estado = 10
        GROUP BY a.[co_codAbre]
      `;

      const result = await pool.request()
        .input('startOfMonth', sql.VarChar, startOfMonthDate)
        .query(query);

      const pendingResult = await pool.request()
        .query(pendingQuery);

      res.json({
        success: true,
        data: result.recordset,
        pendingData: pendingResult.recordset,
        message: "Datos de stock obtenidos correctamente."
      });
    } catch (err) {
      console.error("SQL Stock Error:", err);
      res.status(500).json({ 
        error: "Error al consultar stock en SQL",
        details: err instanceof Error ? err.message : String(err)
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
