# Laboratorio Epson virtual

Este laboratorio prueba la cola real de Supabase sin instalar BPrint.

Inicia dos impresoras Epson virtuales:

- Epson TM-T20IV, `127.0.0.1:9100`
- Epson TM-T88VII, `127.0.0.1:9101`

Desde PowerShell:

```powershell
Set-Location "F:\PROYECTOS\forRestaurants"
powershell.exe -ExecutionPolicy Bypass -File `
  .\tools\printing-lab\epson-print-lab.ps1 `
  -Username "TU_USUARIO_ADMIN"
```

El script solicita la contraseña de forma segura, inicia sesión con el mismo
protocolo del POS y usa la Edge Function autenticada para registrar o actualizar:

- los dos dispositivos virtuales;
- sus UUID públicos;
- sus credenciales temporales locales.

Los secretos locales quedan fuera del repositorio en:

```text
%LOCALAPPDATA%\PrintingLab\devices.json
```

Cada dispositivo que se crea debe después enlazarse desde Configuración del POS
al punto correspondiente. Copia el UUID mostrado por el script o léelo desde
`devices.json`.

Los tickets recibidos se guardan en:

```text
tools\printing-lab\output\<modelo>-<puerto>\
```

El script usa:

- `printing-device-provision` para el alta;
- `operate_printing_device` para latido, reclamo y confirmación;
- TCP crudo ESC/POS con bytes de inicialización y corte;
- los formatos y rutas configurados en el POS.

Detén los procesos con `Ctrl+C`. Para detener manualmente los receptores
individuales, ciérralos desde sus ventanas o usa sus PIDs específicos.
