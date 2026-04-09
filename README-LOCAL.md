# Instrucciones para Correr la App en la Oficina

Este documento te guiará para ejecutar esta aplicación localmente en tu PC de la empresa, lo que permitirá que se conecte a tu SQL Server sin problemas de Firewall.

## Requisitos Previos
1. **Instalar Node.js:** Descarga e instala la versión "LTS" desde [nodejs.org](https://nodejs.org/).
2. **Acceso a SQL Server:** Asegúrate de tener a mano el usuario y contraseña de SQL Server (Autenticación de SQL).

## Pasos para la Instalación

1. **Descomprimir:** Extrae el contenido del archivo ZIP en una carpeta de tu PC (ej: `C:\Apps\ForDrink`).
2. **Abrir Terminal:** 
   - Abre la carpeta donde extrajiste los archivos.
   - En la barra de direcciones de la carpeta (arriba), escribe `cmd` y presiona Enter. Se abrirá una ventana negra.
3. **Instalar Librerías:** En la ventana negra, escribe el siguiente comando y espera a que termine:
   ```bash
   npm install
   ```
4. **Configurar Conexión:** 
   - Crea un archivo nuevo en la carpeta llamado `.env` (puedes usar el Bloc de Notas).
   - Pega el siguiente contenido y complétalo con tus datos:
     ```env
     SQL_SERVER_SERVER=TU_IP_O_NOMBRE_SERVIDOR
     SQL_SERVER_USER=tu_usuario
     SQL_SERVER_PASSWORD=tu_password
     SQL_SERVER_DATABASE=forDrink
     # Si el puerto no es 1433, descomenta la siguiente línea:
     # SQL_SERVER_PORT=1433
     ```
5. **Iniciar la Aplicación:** Escribe el siguiente comando:
   ```bash
   npm run dev
   ```

## Cómo usarla
Una vez que veas un mensaje que dice `Server running on http://localhost:3000`:
1. Abre tu navegador (Chrome, Edge, etc.).
2. Entra a `http://localhost:3000`.
3. ¡Listo! La app ahora podrá consultar tu SQL Server local directamente.

---
**Nota sobre Firebase:** La aplicación seguirá guardando los partes diarios en la nube (Firebase), pero las consultas de "Cruce SQL" se harán localmente a tu servidor.
