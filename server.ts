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
    const { date, line } = req.body;

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
      
      // Consulta proporcionada por el usuario adaptada para filtrar por fecha y línea seleccionada
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
            AND art.[id_categoria] = 1
            AND CAST(op.[fe_inicio] AS DATE) = @date
            AND maq.[no_descripcion] LIKE @lineFilter
      `;

      const result = await pool.request()
        .input('date', sql.Date, date)
        .input('lineFilter', sql.VarChar, `%${line}%`)
        .query(query);

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
